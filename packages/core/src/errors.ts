import { FailureCode } from "@hifi/db";

/**
 * Every failure that reaches a user is a HifiError carrying a FailureCode, so
 * that the Discord message, the dashboard, and the metrics all agree on what
 * went wrong. `userMessage` is safe to show; `message` is for operators.
 */
export class HifiError extends Error {
  readonly code: FailureCode;
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly context: Record<string, unknown>;

  constructor(
    code: FailureCode,
    message: string,
    options: {
      userMessage?: string;
      retryable?: boolean;
      cause?: unknown;
      context?: Record<string, unknown>;
    } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "HifiError";
    this.code = code;
    this.userMessage = options.userMessage ?? DEFAULT_USER_MESSAGES[code];
    this.retryable = options.retryable ?? RETRYABLE_BY_DEFAULT.includes(code);
    this.context = options.context ?? {};
  }
}

/** Transient by nature. Anything else is reported without a retry. */
const RETRYABLE_BY_DEFAULT: readonly FailureCode[] = [
  FailureCode.checkout_failed,
  FailureCode.github_error,
  FailureCode.internal_error,
];

const DEFAULT_USER_MESSAGES: Record<FailureCode, string> = {
  [FailureCode.quota_exceeded]:
    "This server has used its monthly job allowance.",
  [FailureCode.spend_cap_exceeded]:
    "This server has hit its model spend cap for the period.",
  [FailureCode.concurrency_exceeded]:
    "Too many jobs are already running for this server.",
  [FailureCode.no_channel_binding]: "This channel is not bound to a repository.",
  [FailureCode.tenant_suspended]: "This server is suspended.",
  [FailureCode.credential_missing]: "A required credential has not been set up.",
  [FailureCode.credential_invalid]:
    "A stored credential was rejected by its provider.",
  [FailureCode.repo_preflight_failed]:
    "This repository could not be prepared for an agent run.",
  [FailureCode.checkout_failed]: "The repository could not be checked out.",
  [FailureCode.install_failed]: "Installing dependencies failed.",
  [FailureCode.agent_error]: "The coding agent could not complete the task.",
  [FailureCode.agent_timeout]: "The coding agent ran out of time.",
  [FailureCode.tests_failed]: "The test suite is failing after the change.",
  [FailureCode.screenshot_failed]: "Screenshots could not be captured.",
  [FailureCode.protected_branch]:
    "Refused to write to a protected branch.",
  [FailureCode.push_failed]: "Pushing the branch failed.",
  [FailureCode.github_error]: "GitHub rejected a request.",
  [FailureCode.clarification_timeout]:
    "No answer arrived, so the job was closed.",
  [FailureCode.cancelled_by_user]: "Cancelled.",
  [FailureCode.wall_clock_timeout]: "The job hit its time limit.",
  [FailureCode.internal_error]: "Something broke on our side.",
};

export function toHifiError(err: unknown): HifiError {
  if (err instanceof HifiError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new HifiError(FailureCode.internal_error, message, { cause: err });
}
