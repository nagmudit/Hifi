/**
 * GitHub App authentication, bare mirrors, worktrees, branches, and pull
 * requests.
 *
 * Invariants this package owns, all enforced in code rather than by prompt:
 *   - installation tokens are minted per job and never cached across jobs
 *   - a personal access token is never created or accepted
 *   - a push to the default branch, or to any protected branch, is refused
 *   - a pull request may only target the repository bound to the request
 */

export * from "./auth.js";
export * from "./branch-safety.js";
export * from "./git.js";
export * from "./http.js";
export * from "./pulls.js";
