import type { JobStatus } from "@hifi/db";

/**
 * Worker to bot, over Redis pub/sub.
 *
 * The worker never calls Discord directly. It runs the customer's install
 * scripts and test suite, so a bot token in that environment would be readable
 * by any postinstall hook in their dependency tree. ADR-002 makes the same
 * argument about the model key.
 */
export const STATUS_CHANNEL = "hifi:job-status";

export interface StatusUpdate {
  jobId: string;
  status: JobStatus;
  detail?: string;
}
