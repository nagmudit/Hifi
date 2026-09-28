import { containsSecret } from "@hifi/crypto";

/**
 * The environment for every subprocess HiFi starts.
 *
 * The worker's own environment holds the customer's model key, and in local
 * development everything in `.env`. The subprocesses it starts run code the
 * customer's repository controls: the agent and every shell command it runs,
 * the dependency install and its postinstall hooks, the test suite, and the dev
 * server. Inheriting the parent environment hands all of that the key, which
 * is exactly what ADR-002's proxy exists to prevent.
 *
 * So a child gets an allowlist of ordinary system variables, and nothing else
 * unless the caller names it. Security model control S-14.
 */

/**
 * Non-secret variables programs need in order to run at all. Compared
 * case-insensitively, because Windows environment names are.
 */
const ALLOWED = new Set(
  [
    // Finding programs and libraries.
    "PATH",
    "PATHEXT",
    // Home and user profile, which tools use to find their own config.
    "HOME",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    // Windows needs these or some programs, Node included, fail oddly.
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "COMSPEC",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "COMMONPROGRAMFILES",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "OS",
    // Scratch space.
    "TEMP",
    "TMP",
    "TMPDIR",
    // Locale and terminal behaviour.
    "LANG",
    "LC_ALL",
    "TZ",
    "TERM",
  ].map((name) => name.toUpperCase()),
);

export interface ChildEnvOptions {
  /**
   * Variables the caller deliberately passes. These are trusted by definition,
   * so they skip the secret check: git genuinely needs its auth header. Only
   * pass here what the specific program must have.
   */
  extra?: Record<string, string>;
  /** Defaults to the live process environment; injectable for tests. */
  source?: NodeJS.ProcessEnv;
}

export function childEnv(options: ChildEnvOptions = {}): NodeJS.ProcessEnv {
  const source = options.source ?? process.env;
  const env: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (!ALLOWED.has(name.toUpperCase())) continue;
    // Defence in depth: an allowed name carrying something shaped like a key is
    // dropped rather than trusted. Nobody's PATH should look like an API key.
    if (containsSecret(value)) continue;
    env[name] = value;
  }

  return { ...env, ...(options.extra ?? {}) };
}

/** The names a child will receive, for tests and for logging what was passed. */
export function childEnvNames(options: ChildEnvOptions = {}): string[] {
  return Object.keys(childEnv(options)).sort();
}
