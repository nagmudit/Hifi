import { BRANCH_PREFIX, HifiError } from "@hifi/core";
import { FailureCode } from "@hifi/db";

/**
 * The check that stands between an agent and a customer's main branch.
 *
 * It is deliberately a pure function with no I/O, so it is trivially testable
 * and cannot fail open because a network call failed. It is the first of the
 * two layers required by `docs/architecture/security-model.md` control S-5; the
 * second is branch protection on the customer's own repository.
 */

export interface BranchSafetyInput {
  targetBranch: string;
  defaultBranch: string;
  /** Best-effort list from the API. An empty list must never mean "anything goes". */
  protectedBranches?: string[];
}

const MAX_BRANCH_LENGTH = 200;

/** Refused outright, from git check-ref-format plus a little paranoia. */
const FORBIDDEN_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\s/, "contains whitespace"],
  [/\.\./, "contains a path traversal"],
  [/^\//, "starts with a slash"],
  [/\/$/, "ends with a slash"],
  [/\/\//, "contains an empty path segment"],
  [/\.lock$/, "ends with .lock"],
  [/@\{/, "contains @{"],
  [/[~^:?*[\\]/, "contains a character git reserves"],
  // eslint-disable-next-line no-control-regex
  [/[\x00-\x1f\x7f]/, "contains a control character"],
];

function refuse(reason: string, context: Record<string, unknown>): never {
  throw new HifiError(
    FailureCode.protected_branch,
    `Refusing to write to branch: ${reason}`,
    {
      userMessage: "Refused to write to that branch.",
      context,
    },
  );
}

/**
 * Throws unless the target is a branch HiFi is allowed to create and push.
 *
 * The positive rule does most of the work: HiFi only ever writes branches under
 * its own prefix. Everything else is a second opinion.
 */
export function assertBranchWritable(input: BranchSafetyInput): void {
  const target = input.targetBranch.trim();
  const fallbackContext = { target: input.targetBranch };

  if (target.length === 0) refuse("the branch name is empty", fallbackContext);
  if (target !== input.targetBranch) {
    refuse("the branch name has surrounding whitespace", fallbackContext);
  }
  if (target.length > MAX_BRANCH_LENGTH) {
    refuse(`the branch name is longer than ${MAX_BRANCH_LENGTH} characters`, fallbackContext);
  }

  for (const [pattern, reason] of FORBIDDEN_PATTERNS) {
    if (pattern.test(target)) refuse(`the branch name ${reason}`, fallbackContext);
  }

  if (!target.startsWith(`${BRANCH_PREFIX}/`)) {
    refuse(`only branches under ${BRANCH_PREFIX}/ may be written`, fallbackContext);
  }

  // Case-insensitive, because a ref that differs only in case is still the same
  // branch on a case-insensitive filesystem, and close enough to be a mistake.
  const lowered = target.toLowerCase();
  if (lowered === input.defaultBranch.trim().toLowerCase()) {
    refuse("it is the default branch", fallbackContext);
  }

  for (const protectedBranch of input.protectedBranches ?? []) {
    if (lowered === protectedBranch.trim().toLowerCase()) {
      refuse("it is a protected branch", fallbackContext);
    }
  }
}

/**
 * A pull request may only ever target the repository bound to the request.
 * Enforced in code, not by asking the agent nicely.
 */
export function assertRepoAllowed(target: string, bound: string): void {
  if (target.trim().toLowerCase() !== bound.trim().toLowerCase()) {
    throw new HifiError(
      FailureCode.github_error,
      `Refusing to act on ${target}: this job is bound to ${bound}`,
      { userMessage: "Refused to touch a repository this channel is not bound to." },
    );
  }
}

const SLUG_WORDS = 6;
const SLUG_MAX = 40;

/** `hifi/fix-the-headline-typo-a1b2c3d4` */
export function buildBranchName(prompt: string, jobId: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, SLUG_WORDS)
    .join("-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-$/, "");

  const suffix = jobId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "job";
  return `${BRANCH_PREFIX}/${slug || "task"}-${suffix}`;
}
