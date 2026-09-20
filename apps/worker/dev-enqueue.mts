/**
 * Development tool: put a real job on the queue without Discord.
 *
 *   pnpm --filter @hifi/worker enqueue "Fix the typo in the homepage headline"
 *
 * Creates the M2 tenant, repository, binding, and a requesting user if they do
 * not exist, writes a Job row, and enqueues it. Start the worker separately.
 * Deliberately outside src/, so it is never part of the built image.
 */
import { createRedis, ensureM2Context, QUEUE_NAME, upsertDiscordUser } from "@hifi/core";
import { db, disconnectDb } from "@hifi/db";
import { Queue } from "bullmq";

const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) {
  console.error('Usage: pnpm --filter @hifi/worker enqueue "<your request>"');
  process.exit(1);
}

const guildId = process.env.M2_DISCORD_GUILD_ID;
const channelId = process.env.M2_DISCORD_CHANNEL_ID;
const repoFullName = process.env.M2_REPO_FULL_NAME;
if (!guildId || !channelId || !repoFullName) {
  console.error("M2_DISCORD_GUILD_ID, M2_DISCORD_CHANNEL_ID and M2_REPO_FULL_NAME must be set");
  process.exit(1);
}

const { tenant, repo } = await ensureM2Context({
  discordGuildId: guildId,
  discordChannelId: channelId,
  repoFullName,
});

const user = await upsertDiscordUser({
  discordUserId: `dev-${guildId}`,
  username: "dev-cli",
  tenantId: tenant.id,
});

const job = await db().job.create({
  data: {
    tenantId: tenant.id,
    repoId: repo.id,
    requestedByUserId: user.id,
    discordChannelId: channelId,
    // Stands in for the Discord message id, and keeps the idempotency guard honest.
    discordMessageId: `dev_${Date.now()}`,
    prompt,
  },
});

const queue = new Queue(QUEUE_NAME, { connection: createRedis() });
await queue.add(
  "run",
  { jobId: job.id, tenantId: tenant.id, attempt: 0 },
  { attempts: 1, removeOnComplete: true, removeOnFail: 50 },
);
await queue.close();

console.log("job", job.id);
console.log("prompt:", prompt);
console.log("watch the worker log, then check:", `https://github.com/${repoFullName}/pulls`);

await disconnectDb();
process.exit(0);
