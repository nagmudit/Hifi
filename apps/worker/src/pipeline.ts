import path from "node:path";

import type { AgentEngine } from "@hifi/agent";
import {
  assertTransition,
  HifiError,
  MAX_AGENT_TURNS,
  toHifiError,
  type DiffStat,
  type Logger,
  type ModelSelection,
} from "@hifi/core";
import { db, FailureCode, JobEventType, JobStatus, type Job } from "@hifi/db";
import {
  addWorktree,
  assertBranchWritable,
  buildBranchName,
  diffStat,
  ensureMirror,
  findOpenPullRequestForBranch,
  getRepo,
  hasChanges,
  headSha,
  listProtectedBranches,
  loadPrivateKey,
  mintInstallationToken,
  openPullRequest,
  pushBranch,
  removeWorktree,
  stageAndCommit,
  type WorktreeRef,
} from "@hifi/github";

import { startModelProxy, type ModelProxy } from "./proxy.js";
import type { WorkerConfig } from "./env.js";

/**
 * The GitHub calls the pipeline makes, as a port. Git itself is not here: it
 * runs for real in tests, against a local bare repository, because the point of
 * testing the plumbing is to test the plumbing.
 */
export interface GitHubPort {
  mintInstallationToken: typeof mintInstallationToken;
  getRepo: typeof getRepo;
  listProtectedBranches: typeof listProtectedBranches;
  findOpenPullRequestForBranch: typeof findOpenPullRequestForBranch;
  openPullRequest: typeof openPullRequest;
}

export const realGitHub: GitHubPort = {
  mintInstallationToken,
  getRepo,
  listProtectedBranches,
  findOpenPullRequestForBranch,
  openPullRequest,
};

export interface PipelineDeps {
  engine: AgentEngine;
  config: WorkerConfig;
  logger: Logger;
  github?: GitHubPort;
  /** Chunk C publishes these to the bot, which owns every Discord write. */
  onStatus?: (update: { jobId: string; status: JobStatus; detail?: string }) => void;
}

export interface PipelineResult {
  status: JobStatus;
  prUrl?: string;
  failure?: string;
}

/**
 * The job pipeline. Every status change goes through `assertTransition` and
 * writes a JobEvent, so the state machine in `packages/core` is the only place
 * the rules live.
 */
export async function runJob(jobId: string, deps: PipelineDeps): Promise<PipelineResult> {
  const prisma = db();
  const started = Date.now();
  const log = deps.logger.child({ jobId });
  const github = deps.github ?? realGitHub;

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new HifiError(FailureCode.internal_error, `job ${jobId} not found`);

  // Idempotency: a re-delivered job that already produced a pull request must
  // never open a second one.
  if (job.prUrl) {
    log.warn({ prUrl: job.prUrl }, "job already has a pull request; nothing to do");
    return { status: job.status, prUrl: job.prUrl };
  }

  let seq = await nextSeq(jobId);
  let status = job.status;

  const advance = async (to: JobStatus, detail?: string): Promise<void> => {
    assertTransition(status, to);
    const from = status;
    status = to;
    await prisma.$transaction([
      prisma.job.update({
        where: { id: jobId },
        data: { status: to, statusDetail: detail ?? null },
      }),
      prisma.jobEvent.create({
        data: {
          jobId,
          seq: seq++,
          type: JobEventType.status_change,
          fromStatus: from,
          toStatus: to,
          message: detail,
        },
      }),
    ]);
    log.info({ from, to, detail }, "job status");
    deps.onStatus?.({ jobId, status: to, detail });
  };

  const note = async (type: JobEventType, message: string, data?: object): Promise<void> => {
    await prisma.jobEvent.create({
      data: { jobId, seq: seq++, type, message: message.slice(0, 2000), data: data ?? undefined },
    });
  };

  let worktree: WorktreeRef | undefined;
  let proxy: ModelProxy | undefined;

  // The job enforces its own wall clock. The watchdog in index.ts only exists
  // for jobs whose worker died and can no longer enforce anything.
  const deadline = new AbortController();
  const deadlineTimer = setTimeout(() => deadline.abort(), deps.config.jobWallClockMs);

  try {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + deps.config.jobWallClockMs),
        attempt: { increment: 1 },
      },
    });

    await advance(JobStatus.claimed);
    await advance(JobStatus.preparing, "Preparing the workspace");

    // A fresh installation token per job. Never cached.
    const installation = await github.mintInstallationToken({
      appId: deps.config.githubAppId,
      privateKeyPem: loadPrivateKey({
        pem: deps.config.githubPrivateKey,
        pemPath: deps.config.githubPrivateKeyPath,
      }),
      installationId: deps.config.githubInstallationId,
    });
    const token = installation.token;
    const auth = { token };

    const repoFullName = deps.config.repoFullName;
    const repoInfo = await github.getRepo({ token, repoFullName });
    const protectedBranches = await github.listProtectedBranches({ token, repoFullName });

    const branch = buildBranchName(job.prompt, jobId);
    assertBranchWritable({
      targetBranch: branch,
      defaultBranch: repoInfo.defaultBranch,
      protectedBranches,
    });

    // Second idempotency guard: the branch may already carry a pull request
    // from an earlier attempt that died after pushing.
    const existingPr = await github.findOpenPullRequestForBranch({ token, repoFullName, branch });
    if (existingPr) {
      log.warn({ pr: existingPr.number }, "branch already has an open pull request; adopting it");
      await prisma.job.update({
        where: { id: jobId },
        data: { branchName: branch, prNumber: existingPr.number, prUrl: existingPr.url },
      });
      await advance(JobStatus.planning);
      await advance(JobStatus.editing);
      await advance(JobStatus.pushing);
      await advance(JobStatus.reporting);
      await advance(JobStatus.succeeded, "Adopted an existing pull request");
      return { status: JobStatus.succeeded, prUrl: existingPr.url };
    }

    const mirror = await ensureMirror({
      repoFullName,
      mirrorsDir: path.join(deps.config.dataDir, "mirrors"),
      auth,
      cloneUrl: repoInfo.cloneUrl,
    });

    worktree = await addWorktree({
      mirrorPath: mirror.mirrorPath,
      workDir: path.join(deps.config.dataDir, "work"),
      jobId,
      branch,
      baseRef: repoInfo.defaultBranch,
    });
    await prisma.job.update({
      where: { id: jobId },
      data: { branchName: branch },
    });

    // The proxy holds the key; the agent gets a job token. ADR-002 and ADR-008.
    proxy = await startModelProxy({
      upstreamBaseUrl: deps.config.modelBaseUrl,
      apiKey: deps.config.modelApiKey,
      tokenCeiling: deps.config.jobTokenCeiling,
      renameMaxTokens: deps.config.modelProvider === "openai",
      logger: log,
    });

    const model: ModelSelection = {
      provider: deps.config.modelProvider,
      model: deps.config.modelId,
      tier: "cheap",
      reason: "M2 runs a single configured model; the router lands in M3",
    };

    await advance(JobStatus.planning, "Planning the change");
    await advance(JobStatus.editing, "Writing code");

    const result = await deps.engine.run({
      cwd: worktree.path,
      prompt: job.prompt,
      images: [],
      model,
      access: { baseUrl: proxy.baseUrl, token: proxy.token },
      maxTurns: MAX_AGENT_TURNS,
      timeoutMs: deps.config.agentTimeoutMs,
      signal: deadline.signal,
      onEvent: (event) => {
        if (event.type === "message") {
          void note(JobEventType.agent_message, event.text).catch(() => undefined);
        } else if (event.type === "tool_call") {
          void note(JobEventType.tool_call, `${event.name}: ${event.summary}`).catch(() => undefined);
        }
      },
    });

    // Usage comes from the proxy, not from the agent's own report.
    const usage = proxy.usage();
    await prisma.job.update({
      where: { id: jobId },
      data: {
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        tokensCacheRead: usage.tokensCacheRead,
        modelSelection: model as unknown as object,
      },
    });

    if (deadline.signal.aborted) {
      throw new HifiError(
        FailureCode.wall_clock_timeout,
        `the job passed its ${Math.round(deps.config.jobWallClockMs / 1000)}s wall clock`,
      );
    }

    if (result.outcome === "error") {
      const budgetHit = proxy.exceeded();
      throw new HifiError(
        budgetHit ? FailureCode.spend_cap_exceeded : FailureCode.agent_error,
        result.error ?? "the agent failed",
        {
          userMessage: budgetHit
            ? `Stopped: this job hit its ${deps.config.jobTokenCeiling} token budget.`
            : undefined,
        },
      );
    }

    if (!(await hasChanges(worktree.path))) {
      throw new HifiError(
        FailureCode.agent_error,
        "the agent finished without changing any files",
        { userMessage: "The agent did not change anything." },
      );
    }

    await advance(JobStatus.pushing, "Opening a pull request");

    const commitMessage = buildCommitMessage(job.prompt, result.summary);
    await stageAndCommit({ worktreePath: worktree.path, message: commitMessage });
    const sha = await headSha(worktree.path);
    const stat: DiffStat = await diffStat({
      worktreePath: worktree.path,
      baseSha: worktree.baseSha,
    });

    await prisma.job.update({
      where: { id: jobId },
      data: { headSha: sha, diffStat: stat as unknown as object },
    });

    await pushBranch({ worktreePath: worktree.path, branch, auth });

    const pr = await github.openPullRequest({
      token,
      repoFullName,
      boundRepoFullName: repoFullName,
      head: branch,
      base: repoInfo.defaultBranch,
      title: commitMessage.split("\n")[0] ?? "HiFi change",
      body: buildPullRequestBody(job, result.summary, stat, usage, deps.config.modelId),
    });

    await advance(JobStatus.reporting, "Wrapping up");
    await prisma.job.update({
      where: { id: jobId },
      data: { prNumber: pr.number, prUrl: pr.url },
    });

    await advance(JobStatus.succeeded);
    await prisma.job.update({
      where: { id: jobId },
      data: { finishedAt: new Date(), durationMs: Date.now() - started },
    });

    log.info({ pr: pr.url, usage }, "job succeeded");
    return { status: JobStatus.succeeded, prUrl: pr.url };
  } catch (err) {
    const error = toHifiError(err);
    log.error({ err: error, code: error.code }, "job failed");

    const terminal =
      error.code === FailureCode.wall_clock_timeout ? JobStatus.timed_out : JobStatus.failed;

    if (status !== JobStatus.failed && status !== JobStatus.succeeded) {
      try {
        await advance(terminal, error.userMessage);
      } catch {
        // An illegal transition must not mask the original failure.
      }
    }

    await prisma.job.update({
      where: { id: jobId },
      data: {
        failureCode: error.code,
        failureMessage: error.message.slice(0, 2000),
        finishedAt: new Date(),
        durationMs: Date.now() - started,
        ...(proxy
          ? {
              tokensIn: proxy.usage().tokensIn,
              tokensOut: proxy.usage().tokensOut,
            }
          : {}),
      },
    });

    return { status: terminal, failure: error.userMessage };
  } finally {
    clearTimeout(deadlineTimer);
    // The worktree never survives the job. The mirror always does.
    if (worktree) await removeWorktree(worktree);
    if (proxy) await proxy.close();
  }
}

async function nextSeq(jobId: string): Promise<number> {
  const last = await db().jobEvent.findFirst({
    where: { jobId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  return (last?.seq ?? 0) + 1;
}

const SUBJECT_MAX = 68;

/** Conventional-commit subject, cut at a word boundary rather than mid-word. */
function buildCommitMessage(prompt: string, summary: string): string {
  const firstLine = (prompt.trim().split("\n")[0] ?? "change").trim();
  const prefix = "chore: ";
  const room = SUBJECT_MAX - prefix.length;

  let subject = firstLine;
  if (subject.length > room) {
    const cut = subject.slice(0, room);
    const lastSpace = cut.lastIndexOf(" ");
    subject = (lastSpace > room / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s:,;.-]+$/, "");
  }
  subject = `${subject.charAt(0).toLowerCase()}${subject.slice(1)}`;

  return `${prefix}${subject}\n\n${summary.trim().slice(0, 1000)}`;
}

function buildPullRequestBody(
  job: Job,
  summary: string,
  stat: DiffStat,
  usage: { tokensIn: number; tokensOut: number },
  model: string,
): string {
  const files = stat.files
    .map((f) => `- \`${f.path}\` +${f.additions} -${f.deletions}`)
    .join("\n");

  return [
    "### The request",
    "",
    "> " + job.prompt.trim().split("\n").join("\n> "),
    "",
    "### What changed",
    "",
    summary.trim() || "_No summary was produced._",
    "",
    "### Files",
    "",
    files || "_None._",
    "",
    "### Run",
    "",
    `- Model: \`${model}\``,
    `- Tokens: ${usage.tokensIn} in, ${usage.tokensOut} out`,
    "- Cost: unknown, because no price is recorded for this model",
    "",
    "---",
    "",
    "Generated by HiFi. Tests, screenshots, and preview links arrive in M3.",
  ].join("\n");
}
