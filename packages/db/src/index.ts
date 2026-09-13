import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

export type { PrismaClient };

let client: PrismaClient | undefined;

/**
 * Process-wide Prisma client. Every app in the monorepo shares this accessor so
 * that connection pooling is decided in one place.
 */
export function db(): PrismaClient {
  if (!client) {
    client = new PrismaClient({
      log:
        process.env.NODE_ENV === "development"
          ? ["warn", "error"]
          : ["error"],
    });
  }
  return client;
}

export async function disconnectDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}

/** Liveness probe used by the API health endpoint and by worker startup. */
export async function pingDb(): Promise<boolean> {
  await db().$queryRaw`SELECT 1`;
  return true;
}
