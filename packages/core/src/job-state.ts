import { JobStatus } from "@hifi/db";

/**
 * The job state machine, as data.
 *
 * Two rules hold everywhere in the product:
 *   1. Only the worker advances a job. The bot process may create a job in
 *      `queued` and may request cancellation, but never writes another status.
 *   2. Every accepted transition writes a JobEvent, which is what drives the
 *      Discord status message and the dashboard timeline.
 *
 * There is deliberately no `awaiting_preview`. A job finishes when the pull
 * request is open; a detached watcher edits the Discord message if and when the
 * deployment webhook arrives.
 */
export const JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> =
  Object.freeze({
    [JobStatus.queued]: [
      JobStatus.claimed,
      JobStatus.cancelled,
      JobStatus.failed,
    ],
    [JobStatus.claimed]: [
      JobStatus.preparing,
      JobStatus.cancelled,
      JobStatus.failed,
      JobStatus.timed_out,
    ],
    [JobStatus.preparing]: [
      JobStatus.planning,
      JobStatus.cancelled,
      JobStatus.failed,
      JobStatus.timed_out,
    ],
    [JobStatus.planning]: [
      JobStatus.editing,
      JobStatus.waiting_input,
      JobStatus.cancelled,
      JobStatus.failed,
      JobStatus.timed_out,
    ],
    [JobStatus.editing]: [
      JobStatus.testing,
      // Repos with no test setup at all skip straight past testing. We never
      // scaffold a test framework that the repo did not already have.
      JobStatus.capturing,
      JobStatus.pushing,
      JobStatus.waiting_input,
      JobStatus.cancelled,
      JobStatus.failed,
      JobStatus.timed_out,
    ],
    [JobStatus.testing]: [
      JobStatus.capturing,
      JobStatus.pushing,
      // Exactly one repair attempt is allowed; the worker enforces the count.
      JobStatus.editing,
      JobStatus.cancelled,
      JobStatus.failed,
      JobStatus.timed_out,
    ],
    [JobStatus.capturing]: [
      JobStatus.pushing,
      JobStatus.cancelled,
      JobStatus.failed,
      JobStatus.timed_out,
    ],
    [JobStatus.pushing]: [
      JobStatus.reporting,
      JobStatus.cancelled,
      JobStatus.failed,
      JobStatus.timed_out,
    ],
    // A parked job holds no concurrency slot. Resuming re-runs from planning
    // with the question and the answer appended to the original prompt, because
    // releasing the worker means dropping the live agent session.
    [JobStatus.waiting_input]: [
      JobStatus.planning,
      JobStatus.cancelled,
      JobStatus.failed,
      JobStatus.timed_out,
    ],
    [JobStatus.reporting]: [JobStatus.succeeded, JobStatus.failed],
    [JobStatus.succeeded]: [],
    [JobStatus.failed]: [],
    [JobStatus.cancelled]: [],
    [JobStatus.timed_out]: [],
  });

export const TERMINAL_STATUSES: readonly JobStatus[] = Object.freeze([
  JobStatus.succeeded,
  JobStatus.failed,
  JobStatus.cancelled,
  JobStatus.timed_out,
]);

/** Statuses that occupy one of the tenant concurrency slots. */
export const ACTIVE_STATUSES: readonly JobStatus[] = Object.freeze([
  JobStatus.claimed,
  JobStatus.preparing,
  JobStatus.planning,
  JobStatus.editing,
  JobStatus.testing,
  JobStatus.capturing,
  JobStatus.pushing,
  JobStatus.reporting,
]);

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function occupiesSlot(status: JobStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: JobStatus,
    readonly to: JobStatus,
  ) {
    super(`Illegal job transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/** Human-facing label for the Discord status message. */
export const STATUS_LABELS: Readonly<Record<JobStatus, string>> = Object.freeze({
  [JobStatus.queued]: "Queued",
  [JobStatus.claimed]: "Starting up",
  [JobStatus.preparing]: "Preparing the workspace",
  [JobStatus.planning]: "Planning the change",
  [JobStatus.editing]: "Writing code",
  [JobStatus.testing]: "Running tests",
  [JobStatus.capturing]: "Capturing screenshots",
  [JobStatus.pushing]: "Opening a pull request",
  [JobStatus.waiting_input]: "Waiting for your answer",
  [JobStatus.reporting]: "Wrapping up",
  [JobStatus.succeeded]: "Done",
  [JobStatus.failed]: "Failed",
  [JobStatus.cancelled]: "Cancelled",
  [JobStatus.timed_out]: "Timed out",
});
