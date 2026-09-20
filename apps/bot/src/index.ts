import { createLogger } from "@hifi/core";
import { disconnectDb, pingDb } from "@hifi/db";
import { Client, GatewayIntentBits, Partials, type Message } from "discord.js";

import { loadBotConfig } from "./env.js";
import { createJobQueue, createMessageHandler } from "./handler.js";
import { startStatusSubscriber } from "./status-subscriber.js";

/**
 * Discord gateway process. Long-lived, thin, and deliberately boring.
 *
 * MessageContent is a privileged intent. It must be enabled on the application
 * in the Discord developer portal, and verified once the bot is in more than
 * 100 servers.
 */
const log = createLogger({ service: "bot" });

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  const message =
    "DISCORD_BOT_TOKEN is not set. The bot cannot start. Set it to run the Discord loop.";
  if (process.env.NODE_ENV === "production") {
    log.error(message);
    process.exit(1);
  }
  log.warn(message);
  process.exit(0);
}

const config = loadBotConfig();
await pingDb();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const queue = createJobQueue();
const onMessage = createMessageHandler({ client, config, logger: log, queue });
const subscriber = startStatusSubscriber({ client, config, logger: log });

client.once("clientReady", (ready) => {
  log.info(
    {
      user: ready.user.tag,
      guilds: ready.guilds.cache.size,
      channel: config.M2_DISCORD_CHANNEL_ID,
      repo: config.M2_REPO_FULL_NAME,
    },
    "discord gateway connected",
  );
});

client.on("messageCreate", (message: Message) => {
  void onMessage(message);
});

client.on("error", (err) => log.error({ err }, "discord client error"));

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down");
  subscriber.disconnect();
  await queue.close();
  await client.destroy();
  await disconnectDb();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

await client.login(token);
