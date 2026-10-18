import { createClient } from "redis";
import { env } from "./env.js";

export const redis = createClient({
  socket: {
    host: env.redis.host,
    port: env.redis.port,
    connectTimeout: 3_000,
    reconnectStrategy: (retries) => Math.min(100 * (retries + 1), 3_000),
  },
  password: env.redis.password,
  disableOfflineQueue: true,
  commandsQueueMaxLength: 1000,
  commandOptions: { timeout: 3_000 },
});

redis.on("error", (error: Error) => console.error("Redis connection error", error.message));
