import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { AgentEngine, AgentResult, AgentRunInput } from "@hifi/agent";
import { createLogger, ensureM2Context } from "@hifi/core";
import { db, JobStatus, type Prisma } from "@hifi/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { WorkerConfig } from "./env.js";
import { runJob, type GitHubPort } from "./pipeline.js";

/**
 * Drives the real state machine, the real git plumbing, and the real database
 * against a local bare repository, with GitHub and the agent stubbed. It is the
 * test that protects the transition order, the worktree teardown, and the rule
 * that a redelivered job never opens a second pull request.
 *
 * It needs Postgres. Without it the suite skips rather than failing, because a
 * missing local container is not a broken pipeline.
 */
const exec = promisify(execFile);
const git = (args: string[], cwd: string) =>
  exec("git", args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });

const dbReachable = await db()
  .$queryRaw`SELECT 1`.then(() => true)
  .catch(() => false);

let root: string;
let originPath: string;
let config: WorkerConfig;
let tenantId: string;
let userId: string;
let repoId: string;
const opened: Array<{ head: string; base: string; title: string }> = [];
let prCounter = 0;
let existingPr: { number: number; url: string; title: string } | null = null;

const github: GitHubPort = {
  mintInstallationToken: async () => ({
    token: "ghs_fake_installation_token",
    expiresAt: new Date(Date.now() + 3_600_000),
    installationId: 1,
    permissions: { contents: "write", pull_requests: "write" },
    repositorySelection: "selected",
  }),
  getRepo: async () => ({
    id: 1,
    fullName: "acme/fixture",
    defaultBranch: "main",
    private: true,
    // The "remote" is a local bare repository, so push is exercised for real.
    cloneUrl: originPath,
  }),
  listProtectedBranches: async () => ["main"],
  findOpenPullRequestForBranch: async () => existingPr,
  openPullRequest: async (input) => {
    opened.push({ head: input.head, base: input.base, title: input.title });
    prCounter += 1;
    return {
      number: prCounter,
      url: `https://github.invalid/acme/fixture/pull/${prCounter}`,
      title: input.title,
    };
  },
};

function stubEngine(behaviour: (input: AgentRunInput) => Promise<AgentResult>): AgentEngine {
  return { name: "stub", run: behaviour };
}

const editingEngine = stubEngine(async (input) => {
  const page = path.join(input.cwd, "app.txt");
  const before = await readFile(page, "utf8");
  await writeFile(page, before.replace("Wellcome", "Welcome"), "utf8");
  return {
    outcome: "edited",
    changedFiles: ["app.txt"],
    summary: "Replaced the typo.",
    turns: 2,
    tokensIn: 100,
    tokensOut: 20,
  };
});

async function createJob(prompt: string): Promise<string> {
  const job = await db().job.create({
    data: {
      tenantId,
      repoId,
      requestedByUserId: userId,
      discordChannelId: "1",
      discordMessageId: `msg_${Math.random().toString(36).slice(2)}`,
      prompt,
    },
  });
  return job.id;
}

async function statusSequence(jobId: string): Promise<JobStatus[]> {
  const events = await db().jobEvent.findMany({
    where: { jobId, type: "status_change" },
    orderBy: { seq: "asc" },
  });
  return events.map((e) => e.toStatus).filter((s): s is JobStatus => s !== null);
}

beforeAll(async () => {
  if (!dbReachable) return;
  root = await mkdtemp(path.join(tmpdir(), "hifi-pipeline-"));
  originPath = path.join(root, "origin.git");

  const seed = path.join(root, "seed");
  await mkdir(seed, { recursive: true });
  await git(["init", "--bare", "--initial-branch=main", originPath], root);
  await git(["init", "--initial-branch=main"], seed);
  await writeFile(path.join(seed, "app.txt"), "Wellcome to Acme\n", "utf8");
  await git(["add", "--all"], seed);
  await git(
    ["-c", "user.name=Seed", "-c", "user.email=seed@example.invalid", "commit", "-m", "initial"],
    seed,
  );
  await git(["remote", "add", "origin", originPath], seed);
  await git(["push", "origin", "main"], seed);

  const context = await ensureM2Context({
    discordGuildId: `guild_${Date.now()}`,
    discordChannelId: `channel_${Date.now()}`,
    repoFullName: "acme/fixture",
  });
  tenantId = context.tenant.id;
  repoId = context.repo.id;
  const user = await db().user.create({
    data: { discordUserId: `user_${Date.now()}`, username: "tester" },
  });
  userId = user.id;

  config = {
    dataDir: path.join(root, "data"),
    githubAppId: "1",
    githubPrivateKey: "unused-by-the-stub",
    githubInstallationId: "1",
    repoFullName: "acme/fixture",
    discordGuildId: "g",
    discordChannelId: "c",
    modelProvider: "stub",
    modelApiKey: "sk-not-used",
    modelId: "stub-model",
    modelBaseUrl: "https://api.invalid/v1",
    jobTokenCeiling: 1000,
    jobWallClockMs: 60_000,
    agentTimeoutMs: 60_000,
  };
}, 180_000);

afterAll(async () => {
  if (!dbReachable) return;
  if (tenantId) await db().tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
  if (userId) await db().user.delete({ where: { id: userId } }).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(!dbReachable)("job pipeline", () => {
  it("walks the happy path and opens one pull request", async () => {
    existingPr = null;
    const jobId = await createJob("Fix the typo in the headline");

    const result = await runJob(jobId, {
      engine: editingEngine,
      config,
      logger: createLogger({ service: "test" }),
      github,
    });

    expect(result.status).toBe(JobStatus.succeeded);
    expect(result.prUrl).toContain("/pull/");

    expect(await statusSequence(jobId)).toEqual([
      JobStatus.claimed,
      JobStatus.preparing,
      JobStatus.planning,
      JobStatus.editing,
      JobStatus.pushing,
      JobStatus.reporting,
      JobStatus.succeeded,
    ]);

    const job = await db().job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.branchName).toMatch(/^hifi\//);
    expect(job.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(job.prNumber).toBeGreaterThan(0);
    expect(job.durationMs).toBeGreaterThanOrEqual(0);

    const stat = job.diffStat as unknown as { totalAdditions: number };
    expect(stat.totalAdditions).toBe(1);

    // The change really reached the "remote".
    const { stdout } = await git(["branch", "--list", job.branchName ?? ""], originPath);
    expect(stdout).toContain("hifi/");
  }, 180_000);

  it("destroys the worktree and keeps the mirror", async () => {
    existingPr = null;
    const jobId = await createJob("Fix the typo again");
    await runJob(jobId, {
      engine: editingEngine,
      config,
      logger: createLogger({ service: "test" }),
      github,
    });

    await expect(readFile(path.join(config.dataDir, "work", jobId, "app.txt"))).rejects.toThrow();
    const mirror = path.join(config.dataDir, "mirrors", "acme__fixture.git");
    const { stdout } = await git(["rev-parse", "--is-bare-repository"], mirror);
    expect(stdout.trim()).toBe("true");
  }, 180_000);

  it("adopts an existing pull request rather than opening a second one", async () => {
    const jobId = await createJob("Fix the typo once more");
    existingPr = { number: 99, url: "https://github.invalid/acme/fixture/pull/99", title: "prior" };
    const before = opened.length;

    const result = await runJob(jobId, {
      engine: editingEngine,
      config,
      logger: createLogger({ service: "test" }),
      github,
    });

    expect(result.prUrl).toContain("/pull/99");
    expect(opened.length).toBe(before);
    existingPr = null;
  }, 180_000);

  it("does nothing at all when the job already carries a pull request", async () => {
    const jobId = await createJob("Already done");
    await db().job.update({
      where: { id: jobId },
      data: { prUrl: "https://github.invalid/acme/fixture/pull/7", prNumber: 7 },
    });
    const before = opened.length;

    const result = await runJob(jobId, {
      engine: editingEngine,
      config,
      logger: createLogger({ service: "test" }),
      github,
    });

    expect(result.prUrl).toContain("/pull/7");
    expect(opened.length).toBe(before);
    expect(await statusSequence(jobId)).toEqual([]);
  }, 180_000);

  it("reports a run that changed nothing as a result, not a failure", async () => {
    existingPr = null;
    const jobId = await createJob("What is the architecture of this repo?");
    const before = opened.length;
    const answer = "It is a single page with one pure module for pricing.";

    const result = await runJob(jobId, {
      engine: stubEngine(async () => ({
        outcome: "no_changes",
        changedFiles: [],
        summary: answer,
        turns: 1,
        tokensIn: 10,
        tokensOut: 1,
      })),
      config,
      logger: createLogger({ service: "test" }),
      github,
    });

    expect(result.status).toBe(JobStatus.succeeded);
    expect(result.prUrl).toBeUndefined();
    expect(opened.length).toBe(before);

    const job = await db().job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.failureCode).toBeNull();
    expect(job.summary).toBe(answer);
    expect(job.prUrl).toBeNull();
    // Duration is written before the terminal status is published, so the
    // report never renders it as unknown.
    expect(job.durationMs).toBeGreaterThanOrEqual(0);

    expect(await statusSequence(jobId)).toEqual([
      JobStatus.claimed,
      JobStatus.preparing,
      JobStatus.planning,
      JobStatus.editing,
      JobStatus.reporting,
      JobStatus.succeeded,
    ]);
  }, 180_000);

  it("believes git over an agent that claims an edit it did not make", async () => {
    existingPr = null;
    const jobId = await createJob("Claim an edit without making one");
    const before = opened.length;

    const result = await runJob(jobId, {
      engine: stubEngine(async () => ({
        // Says it edited; the working tree disagrees.
        outcome: "edited",
        changedFiles: ["app.txt"],
        summary: "I changed the file.",
        turns: 1,
        tokensIn: 10,
        tokensOut: 1,
      })),
      config,
      logger: createLogger({ service: "test" }),
      github,
    });

    expect(result.status).toBe(JobStatus.succeeded);
    expect(result.prUrl).toBeUndefined();
    expect(opened.length).toBe(before);
  }, 180_000);

  it("fails without a pull request when the agent errors", async () => {
    existingPr = null;
    const jobId = await createJob("Break something");
    const before = opened.length;

    const result = await runJob(jobId, {
      engine: stubEngine(async () => ({
        outcome: "error",
        changedFiles: [],
        summary: "",
        turns: 1,
        tokensIn: 5,
        tokensOut: 0,
        error: "the model refused",
      })),
      config,
      logger: createLogger({ service: "test" }),
      github,
    });

    expect(result.status).toBe(JobStatus.failed);
    expect(opened.length).toBe(before);
  }, 180_000);

  it("records every transition as an ordered event", async () => {
    existingPr = null;
    const jobId = await createJob("Fix the typo for the event log");
    await runJob(jobId, {
      engine: editingEngine,
      config,
      logger: createLogger({ service: "test" }),
      github,
    });

    const events = await db().jobEvent.findMany({ where: { jobId }, orderBy: { seq: "asc" } });
    const seqs = events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  }, 180_000);
});
