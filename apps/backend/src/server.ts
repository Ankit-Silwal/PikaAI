import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./config/database.js";
import type { Server } from "node:http";

const app = createApp({
  database: pool,
  corsOrigins: env.corsOrigins,
  rateLimitMax: env.rateLimitMax,
});

let server: Server;
let stopping = false;

function shutdown(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  console.info(`Received ${signal}; closing the backend`);
  const timeout = setTimeout(() => {
    console.error("Graceful shutdown timed out");
    process.exit(1);
  }, 30_000);
  timeout.unref();
  server.close(async () => {
    try {
      await pool.end();
      clearTimeout(timeout);
    } catch (error) {
      console.error("Failed to close the database pool", error);
      process.exitCode = 1;
    }
  });
}

try {
  await pool.query("SELECT 1");
  server = app.listen(env.port, env.host, () => {
    console.info(`PikaAI backend listening on http://${env.host}:${env.port}`);
  });
  server.on("error", async (error) => {
    console.error("Backend listener failed", error);
    await pool.end();
    process.exitCode = 1;
  });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (error) {
  console.error("Backend startup failed. Check the PostgreSQL connection.", error);
  await pool.end();
  process.exitCode = 1;
}
