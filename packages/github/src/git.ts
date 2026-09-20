import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { HifiError, type DiffStat } from "@hifi/core";
import { FailureCode } from "@hifi/db";

const exec = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 16 * 1024 * 1024;

export interface GitAuth {
  token: string;
  host?: string;
}

export interface MirrorRef {
  repoFullName: string;
  mirrorPath: string;
}

export interface WorktreeRef {
  jobId: string;
  path: string;
  branch: string;
  baseSha: string;
  mirrorPath: string;
}

/**
 * Authentication is injected as an HTTP header through `GIT_CONFIG_*`
 * environment variables rather than through the remote URL, a config file, or
 * `-c` on the command line.
 *
 * The reason is narrow and important: a token in the URL lands in the mirror's
 * config and in error output, and a token in `-c` is visible in the process
 * list. Neither is acceptable on a machine that also runs the customer's own
 * install scripts. Verified against git 2.45.
 */
function gitEnv(auth?: GitAuth): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    // Never sit waiting for a username at a prompt nobody can answer.
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
  };
  if (!auth) return base;

  const basic = Buffer.from(`x-access-token:${auth.token}`).toString("base64");
  return {
    ...base,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `http.https://${auth.host ?? "github.com"}/.extraheader`,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}

/** The real subcommand, skipping any leading `-c key=value` pairs, for messages. */
function subcommandOf(args: string[]): string {
  let i = 0;
  while (args[i] === "-c") i += 2;
  return args[i] ?? "";
}

async function git(
  args: string[],
  options: {
    cwd?: string;
    auth?: GitAuth;
    timeoutMs?: number;
    failureCode?: FailureCode;
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await exec("git", args, {
      cwd: options.cwd,
      env: gitEnv(options.auth),
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    });
    return { stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  } catch (err) {
    const stderr =
      typeof err === "object" && err !== null && "stderr" in err
        ? String((err as { stderr: unknown }).stderr)
        : "";
    const message = stderr.trim() || (err instanceof Error ? err.message : String(err));
    const subcommand = subcommandOf(args);
    throw new HifiError(
      options.failureCode ?? FailureCode.checkout_failed,
      `git ${subcommand} failed: ${message.slice(0, 500)}`,
      { cause: err, context: { command: subcommand } },
    );
  }
}

function mirrorDirName(repoFullName: string): string {
  return `${repoFullName.replace("/", "__")}.git`;
}

export function mirrorPathFor(repoFullName: string, mirrorsDir: string): string {
  return path.join(mirrorsDir, mirrorDirName(repoFullName));
}

async function isGitDir(candidate: string): Promise<boolean> {
  try {
    const { stdout } = await git(["rev-parse", "--is-bare-repository"], { cwd: candidate });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

/**
 * The bare mirror is the warm cache that makes a job take seconds rather than
 * minutes. It persists; the worktree never does. Losing it costs one slow job.
 */
export async function ensureMirror(input: {
  repoFullName: string;
  mirrorsDir: string;
  auth?: GitAuth;
  cloneUrl?: string;
}): Promise<MirrorRef> {
  const mirrorPath = mirrorPathFor(input.repoFullName, input.mirrorsDir);
  await mkdir(input.mirrorsDir, { recursive: true });

  if (await isGitDir(mirrorPath)) {
    await fetchMirror({ mirrorPath, auth: input.auth });
    return { repoFullName: input.repoFullName, mirrorPath };
  }

  const url = input.cloneUrl ?? `https://github.com/${input.repoFullName}.git`;
  await git(["clone", "--mirror", url, mirrorPath], {
    auth: input.auth,
    timeoutMs: 300_000,
  });
  return { repoFullName: input.repoFullName, mirrorPath };
}

export async function fetchMirror(input: {
  mirrorPath: string;
  auth?: GitAuth;
}): Promise<void> {
  await git(["fetch", "--prune", "origin", "+refs/heads/*:refs/heads/*"], {
    cwd: input.mirrorPath,
    auth: input.auth,
    timeoutMs: 300_000,
  });
}

export async function resolveSha(mirrorPath: string, ref: string): Promise<string> {
  const { stdout } = await git(["rev-parse", ref], { cwd: mirrorPath });
  return stdout.trim();
}

/**
 * One worktree per job, created from the mirror and destroyed in a `finally`.
 * The branch is created here so that nothing downstream can push to a ref that
 * branch safety never saw.
 */
export async function addWorktree(input: {
  mirrorPath: string;
  workDir: string;
  jobId: string;
  branch: string;
  baseRef: string;
}): Promise<WorktreeRef> {
  const worktreePath = path.join(input.workDir, input.jobId);
  await mkdir(input.workDir, { recursive: true });
  const baseSha = await resolveSha(input.mirrorPath, input.baseRef);

  await git(["worktree", "add", "--detach", worktreePath, baseSha], {
    cwd: input.mirrorPath,
  });
  await git(["switch", "--create", input.branch], { cwd: worktreePath });

  return {
    jobId: input.jobId,
    path: worktreePath,
    branch: input.branch,
    baseSha,
    mirrorPath: input.mirrorPath,
  };
}

/** Always called from a `finally`. Never throws, because teardown must not mask a real failure. */
export async function removeWorktree(worktree: WorktreeRef): Promise<void> {
  try {
    await git(["worktree", "remove", "--force", worktree.path], {
      cwd: worktree.mirrorPath,
    });
  } catch {
    // Fall through to the filesystem: a half-created worktree still has to go.
  }
  try {
    await rm(worktree.path, { recursive: true, force: true });
  } catch {
    // Nothing further to try. The volume is a cache and gets collected.
  }
  try {
    await git(["worktree", "prune"], { cwd: worktree.mirrorPath });
    await git(["branch", "-D", worktree.branch], { cwd: worktree.mirrorPath });
  } catch {
    // The branch may never have been created, or may already be gone.
  }
}

export async function hasChanges(worktreePath: string): Promise<boolean> {
  const { stdout } = await git(["status", "--porcelain"], { cwd: worktreePath });
  return stdout.trim().length > 0;
}

export async function stageAndCommit(input: {
  worktreePath: string;
  message: string;
  authorName?: string;
  authorEmail?: string;
}): Promise<string> {
  const name = input.authorName ?? "HiFi";
  const email = input.authorEmail ?? "bot@hifi.invalid";

  await git(["add", "--all"], { cwd: input.worktreePath });
  await git(
    [
      "-c",
      `user.name=${name}`,
      "-c",
      `user.email=${email}`,
      "commit",
      "--message",
      input.message,
    ],
    { cwd: input.worktreePath },
  );
  return headSha(input.worktreePath);
}

export async function headSha(worktreePath: string): Promise<string> {
  const { stdout } = await git(["rev-parse", "HEAD"], { cwd: worktreePath });
  return stdout.trim();
}

export async function pushBranch(input: {
  worktreePath: string;
  branch: string;
  auth?: GitAuth;
  remote?: string;
}): Promise<void> {
  const remote = input.remote ?? "origin";
  await git(
    [
      // `clone --mirror` sets remote.<name>.mirror, which a worktree inherits,
      // and git then refuses any push carrying a refspec. Overridden per command
      // rather than unset on the mirror, so fetch semantics stay as they are.
      "-c",
      `remote.${remote}.mirror=false`,
      "push",
      remote,
      `refs/heads/${input.branch}:refs/heads/${input.branch}`,
    ],
    {
      cwd: input.worktreePath,
      auth: input.auth,
      timeoutMs: 180_000,
      failureCode: FailureCode.push_failed,
    },
  );
}

export async function diffStat(input: {
  worktreePath: string;
  baseSha: string;
}): Promise<DiffStat> {
  const { stdout } = await git(["diff", "--numstat", `${input.baseSha}..HEAD`], {
    cwd: input.worktreePath,
  });

  const files = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [additions, deletions, ...rest] = line.split("\t");
      return {
        path: rest.join("\t"),
        // A dash means a binary file, which has no line counts.
        additions: additions === "-" ? 0 : Number(additions ?? 0),
        deletions: deletions === "-" ? 0 : Number(deletions ?? 0),
      };
    })
    .filter((f) => f.path.length > 0);

  return {
    files,
    totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
    totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
  };
}

/** Exposed for tests that need to drive git directly against a fixture repo. */
export const __git = git;
