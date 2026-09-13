import {
  createLogger,
  createRedis,
  jobQueuePayload,
  QUEUE_NAME,
  redisOptions,
  redisUrl,
} from "@hifi/core";
import { disconnectDb, pingDb } from "@hifi/db";
import { Worker, type Job as BullJob } from "bullmq";

/**
 * M1: the worker connects, claims nothing, and proves the queue wiring is real.
 * The job pipeline lands in M2.
 */
const log = createLogger({ service: "worker" });

await pingDb();
log.info("postgres reachable");

const connection = createRedis();
await connection.ping();
log.info({ queue: QUEUE_NAME }, "redis reachable");

const worker = new Worker(
  QUEUE_NAME,
  async (job: BullJob) => {
    const payload = jobQueuePayload.parse(job.data);
    log.warn(
      { jobId: payload.jobId, tenantId: payload.tenantId },
      "job received but the pipeline is not implemented until M2",
    );
    throw new Error("job pipeline not implemented (M2)");
  },
  {
    connection: { url: redisUrl(), ...redisOptions() },
    concurrency: 1,
    // Retries are bounded with jitter everywhere in this product.
    settings: { backoffStrategy: (attempts: number) => Math.min(attempts * 5_000, 60_000) },
  },
);

worker.on("failed", (job, err) => {
  log.error({ jobId: job?.data?.jobId, err }, "job failed");
});

worker.on("ready", () => {
  log.info("worker ready");
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down");
  // Let an in-flight job finish rather than orphaning a worktree.
  await worker.close();
  connection.disconnect();
  await disconnectDb();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}
