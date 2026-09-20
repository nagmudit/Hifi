import { ensureM2Context } from "@hifi/core";
import { db, JobStatus } from "@hifi/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sweepExpiredJobs } from "./watchdog.js";

/**
 * Needs Postgres, and skips without it rather than failing: a missing local
 * container is not a broken watchdog.
 */
const dbReachable = await db()
  .$queryRaw`SELECT 1`.then(() => true)
  .catch(() => false);

let tenantId: string;
let userId: string;
let repoId: string;
const logger = {
  warn: () => undefined,
  error: () => undefined,
  info: () => undefined,
  child: () => logger,
} as never;

beforeAll(async () => {
  if (!dbReachable) return;
  const suffix = `wd_${Date.now()}`;
  const context = await ensureM2Context({
    discordGuildId: `guild_${suffix}`,
    discordChannelId: `channel_${suffix}`,
    repoFullName: "acme/watchdog",
  });
  tenantId = context.tenant.id;
  repoId = context.repo.id;
  const user = await db().user.create({
    data: { discordUserId: `user_${suffix}`, username: "wd" },
  });
  userId = user.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  if (tenantId) await db().tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
  if (userId) await db().user.delete({ where: { id: userId } }).catch(() => undefined);
});

async function makeJob(status: JobStatus, deadlineAt: Date | null): Promise<string> {
  const job = await db().job.create({
    data: {
      tenantId,
      repoId,
      requestedByUserId: userId,
      discordChannelId: "1",
      discordMessageId: `wd_${Math.random().toString(36).slice(2)}`,
      prompt: "watchdog fixture",
      status,
      deadlineAt,
    },
  });
  return job.id;
}

const longAgo = () => new Date(Date.now() - 10 * 60 * 1000);
const soon = () => new Date(Date.now() + 10 * 60 * 1000);

describe.skipIf(!dbReachable)("watchdog", () => {
  it("times out a running job that is well past its deadline", async () => {
    const jobId = await makeJob(JobStatus.editing, longAgo());

    const stopped = await sweepExpiredJobs({ logger });
    expect(stopped).toBeGreaterThanOrEqual(1);

    const job = await db().job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe(JobStatus.timed_out);
    expect(job.failureCode).toBe("wall_clock_timeout");
    expect(job.finishedAt).not.toBeNull();

    const events = await db().jobEvent.findMany({ where: { jobId } });
    expect(events.at(-1)?.toStatus).toBe(JobStatus.timed_out);
  });

  it("leaves a job whose deadline has not passed", async () => {
    const jobId = await makeJob(JobStatus.editing, soon());
    await sweepExpiredJobs({ logger });
    const job = await db().job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe(JobStatus.editing);
  });

  it("leaves a queued job alone, because it holds no worker", async () => {
    const jobId = await makeJob(JobStatus.queued, longAgo());
    await sweepExpiredJobs({ logger });
    const job = await db().job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe(JobStatus.queued);
  });

  it("never touches a job that already finished", async () => {
    const jobId = await makeJob(JobStatus.succeeded, longAgo());
    await sweepExpiredJobs({ logger });
    const job = await db().job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe(JobStatus.succeeded);
  });

  it("is idempotent: a second sweep changes nothing", async () => {
    await makeJob(JobStatus.pushing, longAgo());
    await sweepExpiredJobs({ logger });
    const second = await sweepExpiredJobs({ logger });
    expect(second).toBe(0);
  });
});
