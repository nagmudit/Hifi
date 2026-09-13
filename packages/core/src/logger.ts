import { redactSecrets } from "@hifi/crypto";
import pino, { type Logger } from "pino";

/**
 * Structured JSON logging. Two rules:
 *   - every line inside a job carries its jobId, via child loggers
 *   - every line passes through the secret redactor on the way out
 *
 * The redactor is a last line of defence, not the primary control. The primary
 * control is that secrets are never handed to anything that logs.
 */
export function createLogger(
  bindings: Record<string, unknown> = {},
): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { service: process.env.HIFI_SERVICE ?? "hifi", ...bindings },
    formatters: {
      level: (label) => ({ level: label }),
      log: (obj) => redactSecrets(obj) as Record<string, unknown>,
    },
    redact: {
      paths: [
        "apiKey",
        "token",
        "password",
        "secret",
        "authorization",
        "*.apiKey",
        "*.token",
        "req.headers.authorization",
        "req.headers.cookie",
      ],
      censor: "[redacted]",
    },
  });
}

export type { Logger };
