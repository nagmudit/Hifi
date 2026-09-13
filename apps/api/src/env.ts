import { z } from "zod";

/**
 * Fail at boot, not at the first request. Only variables the API genuinely needs
 * are required here; credentials for later milestones stay optional so that a
 * partial environment still boots.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(8080),
  PUBLIC_API_URL: z.string().url().optional(),
  PUBLIC_DASHBOARD_URL: z.string().url().optional(),
  /** Sealing only needs the public key. The API must not hold the secret key. */
  HIFI_MASTER_PUBLIC_KEY: z.string().optional(),
  HIFI_MASTER_KEY_VERSION: z.coerce.number().int().positive().default(1),
});

export type ApiEnv = z.infer<typeof schema>;

export function loadEnv(): ApiEnv {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
