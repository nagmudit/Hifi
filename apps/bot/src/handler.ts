import {
  createRedis,
  ensureM2Context,
  QUEUE_NAME,
  upsertDiscordUser,
  type Logger,
} from "@hifi/core";
import { db } from "@hifi/db";
import { Queue } from "bullmq";
import { ChannelType, type Client, type Message } from "discord.js";

import type { BotConfig } from "./env.js";
import { botRoleIds, mentionsBot, stripMentions, type MentionInput } from "./mentions.js";
import { buildRunningEmbed } from "./report.js";

/**
 * The gateway handler. It must return quickly: a handler that blocks loses
 * events. Everything slow happens in the worker, so this only validates,
 * creates the thread, writes the Job row, and enqueues.
 */

const THREAD_NAME_MAX = 90;
const PROMPT_MAX = 4000;

export interface HandlerDeps {
  client: Client;
  config: BotConfig;
  logger: Logger;
  queue: Queue;
}

/** Per-user sliding window, so an accidental mention storm cannot queue fifty jobs. */
class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  take(userId: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(userId) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(userId, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(userId, recent);
    return true;
  }
}

export function createMessageHandler(deps: HandlerDeps): (message: Message) => Promise<void> {
  const limiter = new RateLimiter(
    deps.config.BOT_RATE_LIMIT_JOBS,
    deps.config.BOT_RATE_LIMIT_WINDOW_MS,
  );

  return async function onMessage(message: Message): Promise<void> {
    try {
      const skip = skipReason(message, deps);
      if (skip) {
        // Only for messages in the bound channel: everywhere else this would be
        // noise, and the channel guard is the whole point.
        if (message.channelId === deps.config.M2_DISCORD_CHANNEL_ID) {
          deps.logger.debug({ messageId: message.id, skip }, "message not handled");
        }
        return;
      }

      const prompt = extractPrompt(message, deps.client.user?.id ?? "");
      if (prompt.length === 0) {
        await message.reply("Tell me what to change, and I will open a pull request.");
        return;
      }

      if (!limiter.take(message.author.id)) {
        await message.reply(
          `That is more than ${deps.config.BOT_RATE_LIMIT_JOBS} requests in a short window. Give the earlier ones a moment to finish.`,
        );
        return;
      }

      const log = deps.logger.child({ messageId: message.id, userId: message.author.id });

      const { tenant, repo } = await ensureM2Context({
        discordGuildId: deps.config.M2_DISCORD_GUILD_ID,
        discordChannelId: deps.config.M2_DISCORD_CHANNEL_ID,
        repoFullName: deps.config.M2_REPO_FULL_NAME,
      });

      const user = await upsertDiscordUser({
        discordUserId: message.author.id,
        username: message.author.username,
        tenantId: tenant.id,
      });

      // The unique constraint on discordMessageId is the idempotency guard: a
      // gateway reconnect can redeliver this event, and a redelivery must not
      // produce a second job or a second pull request.
      const existing = await db().job.findUnique({
        where: { discordMessageId: message.id },
      });
      if (existing) {
        log.warn("message already has a job; ignoring the redelivery");
        return;
      }

      const thread = await message.startThread({
        name: threadName(prompt),
        autoArchiveDuration: 1440,
      });

      const job = await db().job.create({
        data: {
          tenantId: tenant.id,
          repoId: repo.id,
          requestedByUserId: user.id,
          discordChannelId: message.channelId,
          discordMessageId: message.id,
          discordThreadId: thread.id,
          prompt: prompt.slice(0, PROMPT_MAX),
        },
      });

      const status = await thread.send({ embeds: [buildRunningEmbed(job, "Queued.")] });
      await db().job.update({
        where: { id: job.id },
        data: { discordStatusMessageId: status.id },
      });

      await deps.queue.add(
        "run",
        { jobId: job.id, tenantId: tenant.id, attempt: 0 },
        { attempts: 1, removeOnComplete: true, removeOnFail: 100 },
      );

      log.info({ jobId: job.id, threadId: thread.id }, "job queued");
    } catch (err) {
      deps.logger.error({ err }, "failed to handle a mention");
      try {
        await message.reply("Something broke before I could start. It has been logged.");
      } catch {
        // If even the reply fails there is nothing useful left to do.
      }
    }
  };
}

/** Null means handle it. Anything else is the reason it was ignored. */
function skipReason(message: Message, deps: HandlerDeps): string | null {
  if (message.author.bot) return "author is a bot";
  if (message.guildId !== deps.config.M2_DISCORD_GUILD_ID) return "different guild";
  if (message.channelId !== deps.config.M2_DISCORD_CHANNEL_ID) return "different channel";
  if (message.channel.type !== ChannelType.GuildText) {
    return `channel type ${String(message.channel.type)}`;
  }
  const selfId = deps.client.user?.id;
  if (!selfId) return "client user not ready";
  // Accepts the bot's own managed role as well as the user, but not @everyone
  // and not an ordinary role the bot happens to hold.
  if (!mentionsBot(mentionInput(message, selfId))) return "not addressed to this bot";
  return null;
}

function mentionInput(message: Message, selfId: string): MentionInput {
  return {
    selfId,
    userMentionIds: [...message.mentions.users.keys()],
    roleMentions: message.mentions.roles.map((role) => ({
      id: role.id,
      botId: role.tags?.botId ?? null,
    })),
  };
}

function extractPrompt(message: Message, selfId: string): string {
  const input = mentionInput(message, selfId);
  return stripMentions(message.content, selfId, botRoleIds(input));
}

function threadName(prompt: string): string {
  const firstLine = prompt.split("\n")[0] ?? prompt;
  return firstLine.length > THREAD_NAME_MAX
    ? `${firstLine.slice(0, THREAD_NAME_MAX - 1)}…`
    : firstLine;
}

export function createJobQueue(): Queue {
  return new Queue(QUEUE_NAME, { connection: createRedis() });
}
