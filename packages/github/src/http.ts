import { HifiError } from "@hifi/core";
import { FailureCode } from "@hifi/db";

export const GITHUB_API = "https://api.github.com";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_ATTEMPTS = 3;
const MAX_ERROR_BODY = 300;

export interface GitHubRequest {
  path: string;
  auth: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  timeoutMs?: number;
  attempts?: number;
}

/** Transient by nature. Everything else fails on the first response. */
function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 30_000);
    }
  }
  const base = Math.min(1000 * 2 ** attempt, 8000);
  // Jitter, so a fleet of workers does not retry in lockstep.
  return Math.round(base * (0.5 + Math.random() / 2));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Every GitHub call goes through here, so every GitHub call has a timeout and a
 * bounded retry with jitter. Error messages carry the endpoint and the status
 * and never the request headers, which is where the token lives.
 */
export async function githubRequest<T>(req: GitHubRequest): Promise<T> {
  const method = req.method ?? "GET";
  const url = req.path.startsWith("http") ? req.path : `${GITHUB_API}${req.path}`;
  const attempts = req.attempts ?? DEFAULT_ATTEMPTS;
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError: HifiError | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: req.auth,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "hifi",
          ...(req.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: controller.signal,
      });

      if (res.ok) {
        if (res.status === 204) return undefined as T;
        return (await res.json()) as T;
      }

      const detail = (await res.text()).slice(0, MAX_ERROR_BODY);
      lastError = new HifiError(
        FailureCode.github_error,
        `GitHub ${method} ${req.path} failed: ${res.status} ${detail}`,
        { context: { status: res.status, path: req.path } },
      );

      if (!isRetryable(res.status) || attempt === attempts - 1) throw lastError;
      await sleep(backoffMs(attempt, res.headers.get("retry-after")));
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof HifiError) {
        if (attempt === attempts - 1) throw err;
        continue;
      }
      // Network failure or abort.
      const reason = err instanceof Error ? err.message : String(err);
      lastError = new HifiError(
        FailureCode.github_error,
        `GitHub ${method} ${req.path} failed: ${reason}`,
        { cause: err, context: { path: req.path } },
      );
      if (attempt === attempts - 1) throw lastError;
      await sleep(backoffMs(attempt, null));
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  throw (
    lastError ??
    new HifiError(FailureCode.github_error, `GitHub ${method} ${req.path} failed`)
  );
}
