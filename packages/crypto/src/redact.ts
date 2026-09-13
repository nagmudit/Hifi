/**
 * Last line of defence against a secret reaching a log sink. This is not the
 * control that keeps credentials safe; it is the one that catches the mistake
 * when an earlier control fails.
 */

/** Key prefixes we scrub on sight. Extend this list, never shorten it. */
export const SECRET_PREFIXES: readonly string[] = [
  "sk-ant-",
  "sk-or-",
  "sk-proj-",
  "sk-",
  "ghs_",
  "ghp_",
  "ghu_",
  "gho_",
  "github_pat_",
  "xoxb-",
  "xoxp-",
  "AKIA",
  "-----BEGIN",
];

/**
 * Anthropic subscription OAuth tokens. Rejected outright at onboarding: a
 * third-party integration must use a Console API key, and a Pro, Max, or Team
 * token is refused by the API regardless.
 */
export const REJECTED_KEY_PREFIXES: readonly string[] = ["sk-ant-oat"];

const REDACTED = "[redacted]";
const MAX_DEPTH = 8;

const SECRET_PATTERN = new RegExp(
  `(${SECRET_PREFIXES.map(escapeRegExp).join("|")})[A-Za-z0-9_\\-]{8,}`,
  "g",
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactString(value: string): string {
  let out = value.replace(SECRET_PATTERN, (match) => {
    const prefix = SECRET_PREFIXES.find((p) => match.startsWith(p)) ?? "";
    return `${prefix}${REDACTED}`;
  });
  // Private keys are multi-line; once the header is seen, drop the rest.
  if (out.includes("-----BEGIN")) {
    out = out.replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, REDACTED);
  }
  return out;
}

/** True if the string contains anything that looks like a live credential. */
export function containsSecret(value: string): boolean {
  SECRET_PATTERN.lastIndex = 0;
  return SECRET_PATTERN.test(value);
}

/** Deep-walks any log payload. Cycles and depth are bounded. */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;

  if (value instanceof Error) {
    const clone: Record<string, unknown> = {
      name: value.name,
      message: redactString(value.message),
    };
    if (value.stack) clone.stack = redactString(value.stack);
    return clone;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, depth + 1));
  }

  if (value instanceof Uint8Array || value instanceof Date) return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = redactSecrets(item, depth + 1);
  }
  return out;
}

/** Onboarding guard. Returns null when the key shape is acceptable. */
export function rejectionReason(apiKey: string): string | null {
  const trimmed = apiKey.trim();
  if (trimmed.length === 0) return "The key is empty.";
  for (const prefix of REJECTED_KEY_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return "That is a Claude subscription token, which the Anthropic API rejects for third-party integrations. Use a Console API key from console.anthropic.com instead.";
    }
  }
  return null;
}
