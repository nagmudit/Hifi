import { OpenCodeEngine } from "@hifi/agent";
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

import { loadWorkerConfig } from "./env.js";
import { runJob } from "./pipeline.js";
import { STATUS_CHANNEL } from "./status.js";
import { startWatchdog } from "./watchdog.js";

const log = createLogger({ service: "worker" });
const config = loadWorkerConfig();

await pingDb();
const connection = createRedis();
await connection.ping();
log.info({ queue: QUEUE_NAME, repo: config.repoFullName }, "worker starting");

const engine = new OpenCodeEngine({ binPath: config.opencodeBin });
// The bot owns every Discord write, so status travels over Redis rather than
// putting a bot token in the process that runs the customer's code.
const publisher = createRedis();

const publishStatus = (update: { jobId: string; status: string; detail?: string }) => {
  void publisher.publish(STATUS_CHANNEL, JSON.stringify(update));
};

// Catches jobs whose worker died. A live job enforces its own wall clock.
startWatchdog({ logger: log, onStatus: publishStatus });

const worker = new Worker(
  QUEUE_NAME,
  async (job: BullJob) => {
    const payload = jobQueuePayload.parse(job.data);
    const result = await runJob(payload.jobId, {
      engine,
      config,
      logger: log,
      onStatus: publishStatus,
    });
    // A failed job is reported, not thrown: the failure is already recorded on
    // the job row, and throwing would only trigger a retry we do not want yet.
    return result;
  },
  {
    connection: { url: redisUrl(), ...redisOptions() },
    concurrency: 1,
    settings: {
      backoffStrategy: (attempts: number) => Math.min(attempts * 5_000, 60_000),
    },
  },
);

worker.on("failed", (job, err) => {
  log.error({ jobId: job?.data?.jobId, err }, "job threw");
});

worker.on("ready", () => log.info("worker ready"));

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down");
  await worker.close();
  connection.disconnect();
  publisher.disconnect();
  await disconnectDb();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}
