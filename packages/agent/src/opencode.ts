import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  AGENT_SYSTEM_PREAMBLE,
  type AgentEngine,
  type AgentEvent,
  type AgentResult,
  type AgentRunInput,
} from "./types.js";

/**
 * The first AgentEngine implementation.
 *
 * Four things here were learned by running the CLI rather than reading about
 * it, and each one is load-bearing:
 *
 *  - stdin must be closed. With an open pipe the process hangs forever after
 *    init, producing no output and no error.
 *  - `--dir` must be passed explicitly. Without it the session resolves against
 *    the wrong project and the configured provider is not found.
 *  - the binary is a native executable, not a script, so it is spawned directly
 *    rather than through the shell wrapper, which Windows refuses anyway.
 *  - the config file it needs is written into the working tree, so it has to be
 *    removed afterwards or it lands in the commit.
 */

const CONFIG_FILE = "opencode.json";
const PROVIDER_ID = "hifi";
const KILL_GRACE_MS = 5_000;

export interface OpenCodeOptions {
  /** Absolute path to the opencode executable. The worker owns the dependency. */
  binPath?: string;
}

export function resolveOpenCodeBin(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN;
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve("opencode-ai/package.json");
    const bin = process.platform === "win32" ? "opencode.exe" : "opencode";
    return path.join(path.dirname(pkg), "bin", bin);
  } catch {
    return "opencode";
  }
}

interface OpenCodePart {
  type?: string;
  text?: string;
  tool?: string;
  state?: {
    status?: string;
    title?: string;
    input?: Record<string, unknown>;
  };
  tokens?: {
    input?: number;
    output?: number;
    cache?: { read?: number; write?: number };
  };
}

interface OpenCodeEvent {
  type?: string;
  part?: OpenCodePart;
  error?: { name?: string; data?: { message?: string } };
}

/** Tools whose input names a file we can report as touched. */
const FILE_TOOL_KEYS = ["filePath", "file_path", "path", "file"];

function fileFromTool(part: OpenCodePart): string | null {
  const input = part.state?.input;
  if (!input) return null;
  for (const key of FILE_TOOL_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

export class OpenCodeEngine implements AgentEngine {
  readonly name = "opencode";
  private readonly binPath: string;

  constructor(options: OpenCodeOptions = {}) {
    this.binPath = resolveOpenCodeBin(options.binPath);
  }

  async run(input: AgentRunInput): Promise<AgentResult> {
    const configPath = path.join(input.cwd, CONFIG_FILE);
    await writeFile(configPath, this.buildConfig(input), "utf8");

    try {
      return await this.spawnRun(input);
    } finally {
      // Otherwise the agent's own config is staged into the customer's commit.
      await rm(configPath, { force: true });
    }
  }

  private buildConfig(input: AgentRunInput): string {
    return JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        provider: {
          [PROVIDER_ID]: {
            npm: "@ai-sdk/openai-compatible",
            name: "HiFi",
            options: {
              // The loopback proxy, never the provider and never the real key.
              baseURL: input.access.baseUrl,
              apiKey: input.access.token,
            },
            models: { [input.model.model]: { name: input.model.model } },
          },
        },
      },
      null,
      2,
    );
  }

  private spawnRun(input: AgentRunInput): Promise<AgentResult> {
    const prompt = `${AGENT_SYSTEM_PREAMBLE}\n\n---\n\nThe request:\n\n${input.prompt}`;
    const args = [
      "run",
      "--format",
      "json",
      "--auto",
      "--dir",
      input.cwd,
      "--model",
      `${PROVIDER_ID}/${input.model.model}`,
      "--log-level",
      "ERROR",
      prompt,
    ];

    return new Promise<AgentResult>((resolve) => {
      const child = spawn(this.binPath, args, {
        cwd: input.cwd,
        // stdin closed: an open pipe makes the process hang after init.
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        env: { ...process.env },
      });

      const texts: string[] = [];
      const changed = new Set<string>();
      let turns = 0;
      let tokensIn = 0;
      let tokensOut = 0;
      let failure: string | null = null;
      let stopped: "timeout" | "max_turns" | "aborted" | null = null;
      let stderrTail = "";
      let buffer = "";

      const emit = (event: AgentEvent) => {
        try {
          input.onEvent(event);
        } catch {
          // A failing listener must never take down the run.
        }
      };

      const stop = (reason: "timeout" | "max_turns" | "aborted") => {
        if (stopped) return;
        stopped = reason;
        child.kill();
        setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
      };

      const timer = setTimeout(() => stop("timeout"), input.timeoutMs);
      const onAbort = () => stop("aborted");
      input.signal?.addEventListener("abort", onAbort, { once: true });

      const handle = (event: OpenCodeEvent): void => {
        const part = event.part ?? {};
        switch (event.type) {
          case "text": {
            if (part.text) {
              texts.push(part.text);
              emit({ type: "message", role: "assistant", text: part.text });
            }
            break;
          }
          case "tool_use": {
            const name = part.tool ?? "tool";
            emit({ type: "tool_call", name, summary: part.state?.title ?? name });
            const file = fileFromTool(part);
            if (file) {
              changed.add(file);
              emit({ type: "file_changed", path: file });
            }
            break;
          }
          case "step_finish": {
            turns += 1;
            // The agent's own count. Authoritative usage comes from the proxy;
            // this only drives the live view.
            tokensIn += part.tokens?.input ?? 0;
            tokensOut += part.tokens?.output ?? 0;
            emit({
              type: "usage",
              tokensIn: part.tokens?.input ?? 0,
              tokensOut: part.tokens?.output ?? 0,
            });
            if (turns >= input.maxTurns) stop("max_turns");
            break;
          }
          case "error": {
            failure = event.error?.data?.message ?? event.error?.name ?? "agent error";
            emit({ type: "log", level: "error", text: failure });
            break;
          }
          default:
            break;
        }
      };

      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("{")) continue;
          try {
            handle(JSON.parse(trimmed) as OpenCodeEvent);
          } catch {
            // A partial or malformed line is not worth failing the run over.
          }
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2000);
      });

      child.on("error", (err) => {
        failure = `could not start the agent: ${err.message}`;
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);

        const summary = texts.length > 0 ? (texts[texts.length - 1] as string) : "";

        if (stopped === "timeout") {
          resolve(this.errorResult(changed, summary, turns, tokensIn, tokensOut, "the agent ran out of time"));
          return;
        }
        if (stopped === "aborted") {
          resolve(this.errorResult(changed, summary, turns, tokensIn, tokensOut, "the run was cancelled"));
          return;
        }
        if (stopped === "max_turns") {
          resolve(
            this.errorResult(changed, summary, turns, tokensIn, tokensOut, `the agent hit its ${input.maxTurns} turn limit`),
          );
          return;
        }
        if (failure !== null || code !== 0) {
          resolve(
            this.errorResult(
              changed,
              summary,
              turns,
              tokensIn,
              tokensOut,
              failure ?? `the agent exited with code ${String(code)}: ${stderrTail.slice(-300)}`,
            ),
          );
          return;
        }

        resolve({
          outcome: changed.size > 0 ? "edited" : "no_changes",
          changedFiles: [...changed],
          summary,
          turns,
          tokensIn,
          tokensOut,
        });
      });
    });
  }

  private errorResult(
    changed: Set<string>,
    summary: string,
    turns: number,
    tokensIn: number,
    tokensOut: number,
    error: string,
  ): AgentResult {
    return {
      outcome: "error",
      changedFiles: [...changed],
      summary,
      turns,
      tokensIn,
      tokensOut,
      error,
    };
  }
}
