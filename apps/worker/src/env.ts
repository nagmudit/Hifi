import { JOB_WALL_CLOCK_MS } from "@hifi/core";
import { z } from "zod";

/**
 * Fail at boot, not at the first job. The M2_ prefixed values stand in for the
 * tenant, repository, and credential rows until M4.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  HIFI_DATA_DIR: z.string().default(".hifi-data"),

  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().optional(),

  M2_GITHUB_INSTALLATION_ID: z.string().min(1),
  M2_REPO_FULL_NAME: z.string().regex(/^[^/]+\/[^/]+$/, "expected owner/repo"),
  M2_DISCORD_GUILD_ID: z.string().min(1),
  M2_DISCORD_CHANNEL_ID: z.string().min(1),

  M2_MODEL_PROVIDER: z.string().default("openai"),
  M2_MODEL_API_KEY: z.string().min(1),
  M2_MODEL_ID: z.string().min(1),
  M2_MODEL_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  M2_JOB_TOKEN_CEILING: z.coerce.number().int().positive().default(1_000_000),

  AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  OPENCODE_BIN: z.string().optional(),
});

export interface WorkerConfig {
  dataDir: string;
  githubAppId: string;
  githubPrivateKey?: string;
  githubPrivateKeyPath?: string;
  githubInstallationId: string;
  repoFullName: string;
  discordGuildId: string;
  discordChannelId: string;
  modelProvider: string;
  modelApiKey: string;
  modelId: string;
  modelBaseUrl: string;
  jobTokenCeiling: number;
  jobWallClockMs: number;
  agentTimeoutMs: number;
  opencodeBin?: string;
}

export function loadWorkerConfig(): WorkerConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid worker environment:\n${issues}`);
  }
  const env = parsed.data;

  if (!env.GITHUB_APP_PRIVATE_KEY && !env.GITHUB_APP_PRIVATE_KEY_PATH) {
    throw new Error(
      "Set GITHUB_APP_PRIVATE_KEY_PATH locally, or GITHUB_APP_PRIVATE_KEY in production",
    );
  }

  return {
    dataDir: env.HIFI_DATA_DIR,
    githubAppId: env.GITHUB_APP_ID,
    githubPrivateKey: env.GITHUB_APP_PRIVATE_KEY,
    githubPrivateKeyPath: env.GITHUB_APP_PRIVATE_KEY_PATH,
    githubInstallationId: env.M2_GITHUB_INSTALLATION_ID,
    repoFullName: env.M2_REPO_FULL_NAME,
    discordGuildId: env.M2_DISCORD_GUILD_ID,
    discordChannelId: env.M2_DISCORD_CHANNEL_ID,
    modelProvider: env.M2_MODEL_PROVIDER,
    modelApiKey: env.M2_MODEL_API_KEY,
    modelId: env.M2_MODEL_ID,
    modelBaseUrl: env.M2_MODEL_BASE_URL,
    jobTokenCeiling: env.M2_JOB_TOKEN_CEILING,
    jobWallClockMs: JOB_WALL_CLOCK_MS,
    agentTimeoutMs: env.AGENT_TIMEOUT_MS,
    opencodeBin: env.OPENCODE_BIN,
  };
}
