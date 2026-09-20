import { ACTIVE_STATUSES, assertTransition, type Logger } from "@hifi/core";
import { db, FailureCode, JobEventType, JobStatus } from "@hifi/db";

/**
 * Catches orphans only.
 *
 * A running job enforces its own wall clock, because the process holding it is
 * the one that can actually stop the work. This sweep exists for the other
 * case: a worker that died mid-job, leaving a row that would otherwise sit in a
 * running state forever and hold a concurrency slot against its tenant.
 *
 * The grace period is what keeps the two from fighting. A job is only adopted
 * here once it is well past its own deadline, by which point a live worker
 * would already have finished it.
 */
const SWEEP_INTERVAL_MS = 30_000;
const GRACE_MS = 60_000;

export interface WatchdogDeps {
  logger: Logger;
  onStatus?: (update: { jobId: string; status: JobStatus; detail?: string }) => void;
}

export async function sweepExpiredJobs(deps: WatchdogDeps): Promise<number> {
  const prisma = db();
  const cutoff = new Date(Date.now() - GRACE_MS);

  const expired = await prisma.job.findMany({
    where: {
      status: { in: [...ACTIVE_STATUSES] },
      deadlineAt: { not: null, lt: cutoff },
    },
    select: { id: true, status: true },
    take: 25,
  });

  let stopped = 0;
  for (const job of expired) {
    try {
      assertTransition(job.status, JobStatus.timed_out);
    } catch {
      continue;
    }

    const last = await prisma.jobEvent.findFirst({
      where: { jobId: job.id },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });

    await prisma.$transaction([
      prisma.job.update({
        where: { id: job.id },
        data: {
          status: JobStatus.timed_out,
          statusDetail: "The job ran out of time.",
          failureCode: FailureCode.wall_clock_timeout,
          failureMessage: "no worker finished this job before its deadline",
          finishedAt: new Date(),
        },
      }),
      prisma.jobEvent.create({
        data: {
          jobId: job.id,
          seq: (last?.seq ?? 0) + 1,
          type: JobEventType.status_change,
          fromStatus: job.status,
          toStatus: JobStatus.timed_out,
          message: "Adopted by the watchdog: no worker finished it in time.",
        },
      }),
    ]);

    deps.logger.warn({ jobId: job.id, from: job.status }, "watchdog timed out an orphaned job");
    deps.onStatus?.({ jobId: job.id, status: JobStatus.timed_out, detail: "The job ran out of time." });
    stopped += 1;
  }

  return stopped;
}

export function startWatchdog(deps: WatchdogDeps): NodeJS.Timeout {
  const timer = setInterval(() => {
    void sweepExpiredJobs(deps).catch((err: unknown) => {
      deps.logger.error({ err }, "watchdog sweep failed");
    });
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
