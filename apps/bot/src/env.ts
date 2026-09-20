import { z } from "zod";

/** Fail at boot, not on the first mention. */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  DISCORD_BOT_TOKEN: z.string().min(1),

  M2_DISCORD_GUILD_ID: z.string().min(1),
  M2_DISCORD_CHANNEL_ID: z.string().min(1),
  M2_REPO_FULL_NAME: z.string().regex(/^[^/]+\/[^/]+$/, "expected owner/repo"),

  /** Per-user rate limit, so an accidental mention storm cannot queue fifty jobs. */
  BOT_RATE_LIMIT_JOBS: z.coerce.number().int().positive().default(3),
  BOT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
});

export type BotConfig = z.infer<typeof schema>;

export function loadBotConfig(): BotConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid bot environment:\n${issues}`);
  }
  return parsed.data;
}
