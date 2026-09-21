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

/**
 * A gateway that dies quietly is the worst failure this process has: the bot
 * looks online in Discord and simply never hears anything again. These events
 * are the difference between diagnosing that in seconds and guessing.
 */
client.on("shardDisconnect", (event, shardId) =>
  log.warn({ shardId, code: event.code }, "gateway disconnected"),
);
client.on("shardReconnecting", (shardId) => log.warn({ shardId }, "gateway reconnecting"));
client.on("shardResume", (shardId, replayed) =>
  log.info({ shardId, replayed }, "gateway resumed"),
);
client.on("shardError", (err, shardId) => log.error({ shardId, err }, "gateway error"));
client.on("invalidated", () => {
  // Discord has told us this session can never resume. Staying up would be
  // pretending to work, so exit and let the supervisor restart us.
  log.error("gateway session invalidated; exiting so it can be restarted");
  process.exit(1);
});

/**
 * Proof of life, and a liveness guard.
 *
 * The failure that matters is not a crash, it is a socket that stops
 * delivering while the bot still shows as online. Discord does not always tell
 * us, so if the connection is not ready for several checks running, this exits
 * and lets the supervisor start a process that works. Locally that means
 * restarting it by hand; on Fly the machine restarts on its own.
 */
const READY = 0;
const UNHEALTHY_LIMIT = 3;
let unhealthy = 0;

setInterval(() => {
  const status = client.ws.status;
  log.info(
    { ping: client.ws.ping, status, guilds: client.guilds.cache.size },
    "gateway heartbeat",
  );

  if (status === READY) {
    unhealthy = 0;
    return;
  }

  unhealthy += 1;
  log.warn({ status, checks: unhealthy }, "gateway is not ready");
  if (unhealthy >= UNHEALTHY_LIMIT) {
    log.error({ status }, "gateway never recovered; exiting to be restarted");
    process.exit(1);
  }
}, 60_000).unref();

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
