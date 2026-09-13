import { loadEnv } from "./env.js";
import { buildServer } from "./server.js";

const env = loadEnv();
const server = buildServer(env);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  server.app.log.info({ signal }, "shutting down");
  try {
    await server.stop();
    process.exit(0);
  } catch (err) {
    server.app.log.error({ err }, "shutdown failed");
    process.exit(1);
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

try {
  await server.start();
  server.app.log.info(
    { port: env.API_PORT, host: env.API_HOST },
    "api listening",
  );
} catch (err) {
  server.app.log.error({ err }, "failed to start");
  process.exit(1);
}
