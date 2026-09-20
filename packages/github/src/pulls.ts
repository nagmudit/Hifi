import { assertRepoAllowed } from "./branch-safety.js";
import { tokenAuth } from "./auth.js";
import { githubRequest } from "./http.js";

export interface RepoInfo {
  id: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  cloneUrl: string;
}

interface RepoResponse {
  id: number;
  full_name: string;
  default_branch: string;
  private: boolean;
  clone_url: string;
}

export async function getRepo(input: {
  token: string;
  repoFullName: string;
}): Promise<RepoInfo> {
  const res = await githubRequest<RepoResponse>({
    path: `/repos/${input.repoFullName}`,
    auth: tokenAuth(input.token),
  });
  return {
    id: res.id,
    fullName: res.full_name,
    defaultBranch: res.default_branch,
    private: res.private,
    cloneUrl: res.clone_url,
  };
}

/**
 * Best-effort second opinion for branch safety. An empty list never means
 * "anything goes": the primary rule is that HiFi writes only its own prefix,
 * and the default branch is refused whether or not it appears here.
 */
export async function listProtectedBranches(input: {
  token: string;
  repoFullName: string;
}): Promise<string[]> {
  try {
    const res = await githubRequest<Array<{ name: string }>>({
      path: `/repos/${input.repoFullName}/branches?protected=true&per_page=100`,
      auth: tokenAuth(input.token),
      attempts: 1,
    });
    return res.map((b) => b.name);
  } catch {
    return [];
  }
}

export interface PullRequest {
  number: number;
  url: string;
  title: string;
}

interface PullResponse {
  number: number;
  html_url: string;
  title: string;
}

export async function openPullRequest(input: {
  token: string;
  repoFullName: string;
  boundRepoFullName: string;
  head: string;
  base: string;
  title: string;
  body: string;
}): Promise<PullRequest> {
  // Checked before the call, not after: a pull request may only ever target the
  // repository this job is bound to.
  assertRepoAllowed(input.repoFullName, input.boundRepoFullName);

  const res = await githubRequest<PullResponse>({
    method: "POST",
    path: `/repos/${input.repoFullName}/pulls`,
    auth: tokenAuth(input.token),
    body: {
      title: input.title,
      head: input.head,
      base: input.base,
      body: input.body,
      maintainer_can_modify: true,
    },
  });

  return { number: res.number, url: res.html_url, title: res.title };
}

/**
 * Idempotency guard for a re-claimed job: if this branch already has an open
 * pull request, the retry must adopt it rather than open a second one.
 */
export async function findOpenPullRequestForBranch(input: {
  token: string;
  repoFullName: string;
  branch: string;
}): Promise<PullRequest | null> {
  const owner = input.repoFullName.split("/")[0] ?? "";
  const res = await githubRequest<PullResponse[]>({
    path: `/repos/${input.repoFullName}/pulls?state=open&head=${encodeURIComponent(`${owner}:${input.branch}`)}`,
    auth: tokenAuth(input.token),
  });
  const first = res[0];
  return first ? { number: first.number, url: first.html_url, title: first.title } : null;
}

export async function closePullRequest(input: {
  token: string;
  repoFullName: string;
  number: number;
}): Promise<void> {
  await githubRequest({
    method: "PATCH",
    path: `/repos/${input.repoFullName}/pulls/${input.number}`,
    auth: tokenAuth(input.token),
    body: { state: "closed" },
  });
}

export async function deleteBranch(input: {
  token: string;
  repoFullName: string;
  branch: string;
}): Promise<void> {
  await githubRequest({
    method: "DELETE",
    path: `/repos/${input.repoFullName}/git/refs/heads/${input.branch}`,
    auth: tokenAuth(input.token),
  });
}
