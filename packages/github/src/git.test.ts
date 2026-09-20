import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  addWorktree,
  diffStat,
  ensureMirror,
  hasChanges,
  headSha,
  mirrorPathFor,
  pushBranch,
  removeWorktree,
  stageAndCommit,
} from "./git.js";

/**
 * Driven against a local bare repository over a file path, so the suite needs
 * no network and no credentials. The plumbing under test is the same either
 * way: only the remote URL and the auth header differ in production.
 */
const exec = promisify(execFile);
const git = (args: string[], cwd: string) =>
  exec("git", args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });

let root: string;
let originPath: string;
let mirrorsDir: string;
let workDir: string;
const repoFullName = "acme/fixture";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "hifi-git-"));
  originPath = path.join(root, "origin.git");
  mirrorsDir = path.join(root, "mirrors");
  workDir = path.join(root, "work");

  // A bare origin with one commit on main.
  const seed = path.join(root, "seed");
  await mkdir(seed, { recursive: true });
  await git(["init", "--bare", "--initial-branch=main", originPath], root);
  await git(["init", "--initial-branch=main"], seed);
  await writeFile(path.join(seed, "README.md"), "# fixture\n", "utf8");
  await writeFile(path.join(seed, "app.txt"), "one\ntwo\nthree\n", "utf8");
  await git(["add", "--all"], seed);
  await git(
    ["-c", "user.name=Seed", "-c", "user.email=seed@example.invalid", "commit", "-m", "initial"],
    seed,
  );
  await git(["remote", "add", "origin", originPath], seed);
  await git(["push", "origin", "main"], seed);
}, 120_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("mirror and worktree lifecycle", () => {
  it("clones a mirror, then reuses and fetches it", async () => {
    const first = await ensureMirror({ repoFullName, mirrorsDir, cloneUrl: originPath });
    expect(first.mirrorPath).toBe(mirrorPathFor(repoFullName, mirrorsDir));

    const { stdout } = await git(["rev-parse", "--is-bare-repository"], first.mirrorPath);
    expect(stdout.trim()).toBe("true");

    // Second call must not fail on an existing directory.
    const second = await ensureMirror({ repoFullName, mirrorsDir, cloneUrl: originPath });
    expect(second.mirrorPath).toBe(first.mirrorPath);
  }, 120_000);

  it("creates an isolated worktree on a new branch", async () => {
    const mirror = await ensureMirror({ repoFullName, mirrorsDir, cloneUrl: originPath });
    const tree = await addWorktree({
      mirrorPath: mirror.mirrorPath,
      workDir,
      jobId: "job_one",
      branch: "hifi/first-change-jobone",
      baseRef: "main",
    });

    expect(tree.path).toBe(path.join(workDir, "job_one"));
    expect(await readFile(path.join(tree.path, "app.txt"), "utf8")).toContain("one");
    expect(await hasChanges(tree.path)).toBe(false);

    const { stdout } = await git(["rev-parse", "--abbrev-ref", "HEAD"], tree.path);
    expect(stdout.trim()).toBe("hifi/first-change-jobone");

    await removeWorktree(tree);
  }, 120_000);

  it("commits, reports a diff stat, and pushes the branch", async () => {
    const mirror = await ensureMirror({ repoFullName, mirrorsDir, cloneUrl: originPath });
    const branch = "hifi/edit-app-jobtwo";
    const tree = await addWorktree({
      mirrorPath: mirror.mirrorPath,
      workDir,
      jobId: "job_two",
      branch,
      baseRef: "main",
    });

    await writeFile(path.join(tree.path, "app.txt"), "one\ntwo\nthree\nfour\n", "utf8");
    await writeFile(path.join(tree.path, "new.txt"), "added\n", "utf8");
    expect(await hasChanges(tree.path)).toBe(true);

    const sha = await stageAndCommit({ worktreePath: tree.path, message: "feat: extend app" });
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(sha).toBe(await headSha(tree.path));

    const stat = await diffStat({ worktreePath: tree.path, baseSha: tree.baseSha });
    expect(stat.files.map((f) => f.path).sort()).toEqual(["app.txt", "new.txt"]);
    expect(stat.totalAdditions).toBe(2);
    expect(stat.totalDeletions).toBe(0);

    await pushBranch({ worktreePath: tree.path, branch });

    const { stdout } = await git(["branch", "--list", branch], originPath);
    expect(stdout).toContain(branch);

    await removeWorktree(tree);
  }, 120_000);

  it("removes the worktree and leaves the mirror intact", async () => {
    const mirror = await ensureMirror({ repoFullName, mirrorsDir, cloneUrl: originPath });
    const tree = await addWorktree({
      mirrorPath: mirror.mirrorPath,
      workDir,
      jobId: "job_three",
      branch: "hifi/temp-jobthree",
      baseRef: "main",
    });

    await removeWorktree(tree);

    await expect(readFile(path.join(tree.path, "app.txt"), "utf8")).rejects.toThrow();
    const { stdout } = await git(["rev-parse", "--is-bare-repository"], mirror.mirrorPath);
    expect(stdout.trim()).toBe("true");
  }, 120_000);

  it("tears down twice without throwing, because teardown runs in a finally", async () => {
    const mirror = await ensureMirror({ repoFullName, mirrorsDir, cloneUrl: originPath });
    const tree = await addWorktree({
      mirrorPath: mirror.mirrorPath,
      workDir,
      jobId: "job_four",
      branch: "hifi/temp-jobfour",
      baseRef: "main",
    });

    await removeWorktree(tree);
    await expect(removeWorktree(tree)).resolves.toBeUndefined();
  }, 120_000);

  it("reports a failure as a HifiError rather than a raw exec error", async () => {
    await expect(
      ensureMirror({
        repoFullName: "acme/missing",
        mirrorsDir,
        cloneUrl: path.join(root, "does-not-exist.git"),
      }),
    ).rejects.toMatchObject({ name: "HifiError" });
  }, 120_000);
});
