import { createClient } from "redis";
import type { RedisReply } from "rate-limit-redis";
import { env } from "./env.js";
import { HttpError } from "../utils/http-error.js";

export const redis = createClient({
  socket: {
    host: env.redisHost,
    port: env.redisPort,
    connectTimeout: 5000,
    reconnectStrategy: false,
  },
  password: env.redisPassword,
  disableOfflineQueue: true,
});

redis.on("error", error => console.error("Redis connection error:", error.message));

let connecting: Promise<unknown> | undefined;

async function connect(): Promise<void> {
  if (redis.isReady) return;
  connecting ??= redis.connect().finally(() => { connecting = undefined; });
  await connecting;
}

export async function redisCommand(...args: string[]): Promise<RedisReply> {
  try {
    await connect();
    return await redis.sendCommand<RedisReply>(args, { timeout: 5000 });
  } catch {
    throw new HttpError(503, "Authentication temporarily unavailable");
  }
}

// Connect before the rate-limit stores load their Redis scripts. Redis is
// required for authentication; never silently fall back to an in-memory limit.
await connect();
