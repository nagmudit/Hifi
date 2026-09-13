import { createLogger } from "@hifi/core";
import { Client, GatewayIntentBits, Partials } from "discord.js";

/**
 * M1: the gateway process connects and does nothing else. The mention handler,
 * thread creation, attachment capture, and enqueue land in M2.
 *
 * MessageContent is a privileged intent. It must be enabled on the application
 * in the Discord developer portal, and verified once the bot is in more than
 * 100 servers.
 */
const log = createLogger({ service: "bot" });

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  const message =
    "DISCORD_BOT_TOKEN is not set. The bot cannot start. This is expected until M2.";
  if (process.env.NODE_ENV === "production") {
    log.error(message);
    process.exit(1);
  }
  log.warn(message);
  process.exit(0);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.once("clientReady", (ready) => {
  log.info(
    { user: ready.user.tag, guilds: ready.guilds.cache.size },
    "discord gateway connected",
  );
});

client.on("error", (err) => {
  log.error({ err }, "discord client error");
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down");
  await client.destroy();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

await client.login(token);
