import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

import type { Logger } from "@hifi/core";

/**
 * The loopback model proxy from ADR-002, and the budget enforcement point from
 * ADR-008.
 *
 * It holds the unsealed customer key and hands the agent a per-job token, so
 * the key never enters an environment that repo-owned processes can read. It
 * also sees every request and response, which makes token accounting an
 * observation rather than something the agent reports about itself, and gives
 * the per-job budget somewhere to be enforced mid-run.
 *
 * It is a pass-through, never a translator: the path is preserved and the body
 * is forwarded as-is apart from budget clamping. ADR-006 explains why.
 */

const MIN_USEFUL_TOKENS = 256;
const CLAMP_BELOW = 8192;
const UPSTREAM_TIMEOUT_MS = 180_000;

export interface ProxyUsage {
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  calls: number;
}

export interface ModelProxyOptions {
  /** e.g. https://api.openai.com/v1 */
  upstreamBaseUrl: string;
  /** The customer's key. Never logged, never handed downstream. */
  apiKey: string;
  /** Per-job ceiling on input plus output tokens. */
  tokenCeiling: number;
  /**
   * Provider quirk, off by default. OpenAI's newer models reject `max_tokens`
   * and require `max_completion_tokens`, while most OpenAI-compatible servers
   * accept only the older spelling. So this is opt-in per provider rather than
   * a blanket rewrite: renaming everywhere would break the compatible ones.
   */
  renameMaxTokens?: boolean;
  logger?: Logger;
}

export interface ModelProxy {
  /** What the agent is told to call. */
  baseUrl: string;
  /** Per-job bearer token. Not a customer credential. */
  token: string;
  usage(): ProxyUsage;
  exceeded(): boolean;
  close(): Promise<void>;
}

interface UsageFields {
  input?: number;
  output?: number;
  cacheRead?: number;
}

/** Understands the OpenAI chat shape and the Responses shape. */
export function extractUsage(payload: unknown): UsageFields | null {
  if (typeof payload !== "object" || payload === null) return null;
  const usage = (payload as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return null;
  const u = usage as Record<string, unknown>;

  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;

  const details = u.prompt_tokens_details as Record<string, unknown> | undefined;
  const inputDetails = u.input_tokens_details as Record<string, unknown> | undefined;

  const fields: UsageFields = {
    input: num(u.prompt_tokens) ?? num(u.input_tokens),
    output: num(u.completion_tokens) ?? num(u.output_tokens),
    cacheRead: num(details?.cached_tokens) ?? num(inputDetails?.cached_tokens),
  };
  return fields.input === undefined && fields.output === undefined ? null : fields;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

export async function startModelProxy(options: ModelProxyOptions): Promise<ModelProxy> {
  const token = randomBytes(24).toString("base64url");
  const usage: ProxyUsage = { tokensIn: 0, tokensOut: 0, tokensCacheRead: 0, calls: 0 };
  const log = options.logger;

  const spent = () => usage.tokensIn + usage.tokensOut;
  const remaining = () => Math.max(0, options.tokenCeiling - spent());

  function record(fields: UsageFields): void {
    usage.tokensIn += fields.input ?? 0;
    usage.tokensOut += fields.output ?? 0;
    usage.tokensCacheRead += fields.cacheRead ?? 0;
    usage.calls += 1;
  }

  /**
   * Bounds the overshoot ADR-008 admits to. A call's cost is only known once it
   * returns, so the budget can be passed by at most the requests in flight;
   * capping the output each one may produce keeps that bound small.
   */
  function applyQuirks(body: Record<string, unknown>): Record<string, unknown> {
    if (!options.renameMaxTokens) return body;
    if (body.max_tokens === undefined || body.max_completion_tokens !== undefined) return body;
    const { max_tokens: value, ...rest } = body;
    return { ...rest, max_completion_tokens: value };
  }

  function clampBudget(body: Record<string, unknown>): Record<string, unknown> {
    const left = remaining();
    const asked = body.max_completion_tokens ?? body.max_tokens;
    const askedNumber = typeof asked === "number" ? asked : null;

    if (askedNumber !== null && askedNumber > left) {
      return body.max_completion_tokens !== undefined
        ? { ...body, max_completion_tokens: left }
        : { ...body, max_tokens: left };
    }
    if (askedNumber === null && left < CLAMP_BELOW) {
      return { ...body, max_completion_tokens: left };
    }
    return body;
  }

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      log?.error({ err }, "model proxy failed");
      if (!res.headersSent) {
        sendJson(res, 502, { error: { message: "model proxy failure", type: "hifi_proxy" } });
      } else {
        res.end();
      }
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // The agent's per-job token. Anything else on this loopback port is refused.
    const provided = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (provided !== token) {
      sendJson(res, 401, { error: { message: "unauthorized", type: "hifi_proxy" } });
      return;
    }

    if (remaining() <= MIN_USEFUL_TOKENS) {
      log?.warn({ spent: spent(), ceiling: options.tokenCeiling }, "job token budget exhausted");
      sendJson(res, 402, {
        error: {
          message: `HiFi job budget exhausted: ${spent()} of ${options.tokenCeiling} tokens used`,
          type: "hifi_budget_exhausted",
        },
      });
      return;
    }

    const raw = await readBody(req);
    let forwardBody: Buffer | undefined = raw.length > 0 ? raw : undefined;

    if (forwardBody) {
      try {
        const parsed = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
        let next = clampBudget(applyQuirks(parsed));
        // Streaming responses omit usage unless it is asked for, and metering
        // is not optional here.
        if (next.stream === true) {
          next = {
            ...next,
            stream_options: {
              ...(typeof next.stream_options === "object" && next.stream_options !== null
                ? (next.stream_options as Record<string, unknown>)
                : {}),
              include_usage: true,
            },
          };
        }
        forwardBody = Buffer.from(JSON.stringify(next));
      } catch {
        // Not JSON. Forward untouched rather than guess.
      }
    }

    const target = `${options.upstreamBaseUrl.replace(/\/$/, "")}${req.url ?? "/"}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    req.on("close", () => controller.abort());

    try {
      const upstream = await fetch(target, {
        method: req.method ?? "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": req.headers["content-type"] ?? "application/json",
          accept: req.headers.accept ?? "application/json",
        },
        body: forwardBody,
        signal: controller.signal,
      });

      const headers: Record<string, string> = {};
      for (const [k, v] of upstream.headers) {
        if (["content-length", "content-encoding", "transfer-encoding", "connection"].includes(k)) {
          continue;
        }
        headers[k] = v;
      }
      res.writeHead(upstream.status, headers);

      const isStream = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");
      if (!upstream.body) {
        res.end();
        return;
      }

      if (!isStream) {
        const text = Buffer.from(await upstream.arrayBuffer());
        try {
          const found = extractUsage(JSON.parse(text.toString("utf8")));
          if (found) record(found);
        } catch {
          // Non-JSON body, nothing to meter.
        }
        res.end(text);
        return;
      }

      // Server-sent events: forward every chunk untouched, and read usage out of
      // the final data frames as they pass.
      let pending = "";
      for await (const chunk of upstream.body) {
        const buf = Buffer.from(chunk);
        res.write(buf);
        pending += buf.toString("utf8");
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]" || data.length === 0) continue;
          try {
            const found = extractUsage(JSON.parse(data));
            if (found) record(found);
          } catch {
            // Partial or non-JSON frame.
          }
        }
      }
      res.end();
    } finally {
      clearTimeout(timer);
    }
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    token,
    usage: () => ({ ...usage }),
    exceeded: () => remaining() <= MIN_USEFUL_TOKENS,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
