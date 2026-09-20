import { createRedis, isTerminal, type Logger, type Redis } from "@hifi/core";
import { db, JobStatus } from "@hifi/db";
import { userMention, type Client, type TextBasedChannel } from "discord.js";

import type { BotConfig } from "./env.js";
import { buildFinalEmbed, buildRunningEmbed } from "./report.js";

/**
 * The worker publishes status changes here; the bot performs every Discord
 * write. The worker runs the customer's install scripts and test suite, so a
 * bot token in that process would be readable by any postinstall hook in their
 * dependency tree. Same argument as ADR-002 makes about the model key.
 */
const STATUS_CHANNEL = "hifi:job-status";

interface StatusUpdate {
  jobId: string;
  status: JobStatus;
  detail?: string;
}

function parse(raw: string): StatusUpdate | null {
  try {
    const value = JSON.parse(raw) as Partial<StatusUpdate>;
    if (typeof value.jobId !== "string" || typeof value.status !== "string") return null;
    return {
      jobId: value.jobId,
      status: value.status as JobStatus,
      detail: typeof value.detail === "string" ? value.detail : undefined,
    };
  } catch {
    return null;
  }
}

export function startStatusSubscriber(deps: {
  client: Client;
  config: BotConfig;
  logger: Logger;
}): Redis {
  const subscriber = createRedis();

  void subscriber.subscribe(STATUS_CHANNEL).catch((err: unknown) => {
    deps.logger.error({ err }, "could not subscribe to job status");
  });

  subscriber.on("message", (_channel: string, raw: string) => {
    const update = parse(raw);
    if (!update) return;
    void applyUpdate(update, deps).catch((err: unknown) => {
      deps.logger.error({ err, jobId: update.jobId }, "could not update the status message");
    });
  });

  return subscriber;
}

async function applyUpdate(
  update: StatusUpdate,
  deps: { client: Client; config: BotConfig; logger: Logger },
): Promise<void> {
  const job = await db().job.findUnique({
    where: { id: update.jobId },
    include: { requestedBy: true },
  });
  if (!job || !job.discordThreadId || !job.discordStatusMessageId) return;

  const channel = await deps.client.channels.fetch(job.discordThreadId);
  if (!channel || !channel.isTextBased()) return;

  const message = await (channel as TextBasedChannel & {
    messages: { fetch: (id: string) => Promise<{ edit: (payload: object) => Promise<unknown> }> };
  }).messages
    .fetch(job.discordStatusMessageId)
    .catch(() => null);
  if (!message) return;

  const terminal = isTerminal(job.status);
  const embed = terminal
    ? buildFinalEmbed(job, deps.config.M2_REPO_FULL_NAME)
    : buildRunningEmbed(job, update.detail);

  // The status message is edited in place, never reposted.
  await message.edit({ embeds: [embed] });

  if (terminal && "send" in channel) {
    // One mention at the end, so the requester gets exactly one notification.
    const verdict =
      job.status === JobStatus.succeeded
        ? `${userMention(job.requestedBy.discordUserId)} your change is ready: ${job.prUrl ?? ""}`
        : `${userMention(job.requestedBy.discordUserId)} that one did not work out. ${job.statusDetail ?? ""}`;
    await channel.send(verdict.trim());
  }
}
