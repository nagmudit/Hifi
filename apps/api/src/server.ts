import {
  createLogger,
  createRedis,
  pingRedis,
  type Logger,
  type Redis,
} from "@hifi/core";
import { disconnectDb, pingDb } from "@hifi/db";
import Fastify, { type FastifyInstance, type RawServerDefault } from "fastify";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { ApiEnv } from "./env.js";

/**
 * Fastify carries its logger in its type. Handing it a concrete pino instance
 * means the instance type has to say so, or every route registration widens
 * back to the default logger and stops type-checking.
 */
export type HifiFastify = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse<IncomingMessage>,
  Logger
>;

export interface ApiServer {
  app: HifiFastify;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function buildServer(env: ApiEnv): ApiServer {
  const logger = createLogger({ service: "api" });
  const redis: Redis = createRedis();

  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: false,
    // Webhook signature verification needs the exact bytes that were signed,
    // so raw bodies are kept per-route from M4 onward.
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });

  /** Liveness: is the process able to answer at all. No dependencies. */
  app.get("/healthz", async () => ({ status: "ok", service: "api" }));

  /** Readiness: can this process actually serve traffic. */
  app.get("/readyz", async (_req, reply) => {
    const checks: Record<string, "ok" | "down"> = {
      postgres: "down",
      redis: "down",
    };
    try {
      await pingDb();
      checks.postgres = "ok";
    } catch (err) {
      app.log.error({ err }, "postgres readiness check failed");
    }
    try {
      checks.redis = (await pingRedis(redis)) ? "ok" : "down";
    } catch (err) {
      app.log.error({ err }, "redis readiness check failed");
    }

    const ready = Object.values(checks).every((v) => v === "ok");
    return reply.code(ready ? 200 : 503).send({ ready, checks });
  });

  app.get("/", async () => ({
    name: "hifi-api",
    milestone: "M1",
    routes: ["/healthz", "/readyz"],
  }));

  async function start(): Promise<void> {
    await app.listen({ host: env.API_HOST, port: env.API_PORT });
  }

  async function stop(): Promise<void> {
    await app.close();
    redis.disconnect();
    await disconnectDb();
  }

  return { app, start, stop };
}
