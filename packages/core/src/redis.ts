import { Redis, type RedisOptions } from "ioredis";

/**
 * Shared Redis connection settings. BullMQ requires maxRetriesPerRequest to be
 * null on the connections it owns, and the local compose file sets
 * maxmemory-policy noeviction for the same reason: a queue whose keys can be
 * evicted silently loses jobs.
 */
export function redisOptions(): RedisOptions {
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times: number) => Math.min(times * 200, 5_000),
  };
}

export function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  return url;
}

export function createRedis(): Redis {
  return new Redis(redisUrl(), redisOptions());
}

export async function pingRedis(client: Redis): Promise<boolean> {
  const reply = await client.ping();
  return reply === "PONG";
}

export { Redis };
