/** Defaults that every milestone reads from one place. */

/** Hard wall-clock ceiling for one job. The watchdog enforces it. */
export const JOB_WALL_CLOCK_MS = 20 * 60 * 1000;

/** How long a job may sit parked waiting for a human answer. */
export const CLARIFICATION_TIMEOUT_MS = 60 * 60 * 1000;

/** How long the detached watcher waits for a preview deployment. */
export const PREVIEW_WINDOW_MS = 10 * 60 * 1000;

/** Agent turn ceiling, before the run is cut off as a runaway. */
export const MAX_AGENT_TURNS = 60;

/** One repair attempt after a red test suite, and no more. */
export const MAX_TEST_REPAIR_ATTEMPTS = 1;

/** A worker must heartbeat at least this often or be presumed dead. */
export const HEARTBEAT_INTERVAL_MS = 15 * 1000;
export const HEARTBEAT_GRACE_MS = 90 * 1000;

export const BRANCH_PREFIX = "hifi";

// BullMQ rejects a colon in a queue name: it builds its own Redis key prefixes.
export const QUEUE_NAME = "hifi-jobs";

/** Files whose change implies a visual diff worth screenshotting. */
export const VISUAL_FILE_PATTERNS: readonly string[] = [
  "**/*.css",
  "**/*.scss",
  "**/*.sass",
  "**/*.less",
  "**/*.tsx",
  "**/*.jsx",
  "**/*.vue",
  "**/*.svelte",
  "**/tailwind.config.*",
];

// Secret prefix lists live in @hifi/crypto, next to the redactor that uses
// them, because crypto is a leaf package that core depends on.
export { SECRET_PREFIXES, REJECTED_KEY_PREFIXES } from "@hifi/crypto";
