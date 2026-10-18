import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/database.js";
import { redis } from "./config/redis.js";
import { TokenService } from "./services/token.service.js";
import { RedisAuthState, createRedisRateLimitStore } from "./services/redis-auth-state.service.js";
import type { Server } from "node:http";

let server: Server;
let stopping = false;

async function closeDependencies() {
  await Promise.all([prisma.$disconnect(), redis.isOpen ? redis.close() : Promise.resolve()]);
}

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
      await closeDependencies();
      clearTimeout(timeout);
    } catch (error) {
      console.error("Failed to close backend dependencies", error);
      process.exitCode = 1;
    }
  });
}

try {
  let startupTimeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.all([prisma.$queryRaw`SELECT 1`, redis.connect()]),
      new Promise((_, reject) => {
        startupTimeout = setTimeout(() => reject(new Error("Dependency startup timed out")), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(startupTimeout);
  }
  const authState = new RedisAuthState(redis, env.authActivityTtlSeconds);
  await authState.getEpoch();
  const app = createApp({
    prisma, authState, tokens: new TokenService(env.jwtSecret, env.jwtAccessTtlSeconds),
    corsOrigins: env.corsOrigins, trustedProxies: env.trustedProxies,
    rateLimitMax: env.rateLimitMax, authRateLimitMax: env.authRateLimitMax,
    rateLimitStores: {
      api: createRedisRateLimitStore(redis, "pikaai:rate:api:"),
      auth: createRedisRateLimitStore(redis, "pikaai:rate:auth:"),
    },
  });
  server = app.listen(env.port, env.host, () => {
    console.info(`PikaAI backend listening on http://${env.host}:${env.port}`);
  });
  server.on("error", async (error) => {
    console.error("Backend listener failed", error);
    await closeDependencies();
    process.exitCode = 1;
  });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (error) {
  console.error("Backend startup failed. Check PostgreSQL, Redis, and migrations.", error);
  if (redis.isOpen) redis.destroy();
  await prisma.$disconnect();
  process.exitCode = 1;
}
