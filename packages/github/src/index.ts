/**
 * GitHub App authentication, mirror management, and branch and pull request
 * operations. Implemented in M2.
 *
 * Invariants this package owns, all enforced in code rather than by prompt:
 *   - installation tokens are minted per job and never cached across jobs
 *   - a personal access token is never created or accepted
 *   - a push to the default branch, or to any protected branch, is refused
 *   - a pull request may only target the repository bound to the channel
 */

export interface InstallationToken {
  token: string;
  expiresAt: Date;
  installationId: number;
}

export interface BranchSafetyInput {
  targetBranch: string;
  defaultBranch: string;
  protectedBranches: string[];
}

export interface MirrorRef {
  repoFullName: string;
  mirrorPath: string;
  lastFetchedAt: Date | null;
}

export interface WorktreeRef {
  jobId: string;
  path: string;
  branch: string;
  baseSha: string;
}
