import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The worker can use its own .env; unset values fall back to the local repo .env.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the worker");

export const env = {
  databaseUrl: process.env.DATABASE_URL,
  redisHost: process.env.REDIS_HOST ?? "localhost",
  redisPort: Number(process.env.REDIS_PORT ?? 56379),
  redisPassword: process.env.REDIS_PASSWORD || undefined,
  redisPrefix: process.env.REDIS_KEY_PREFIX ?? "pikaai:",
  documentUploadDir: resolve(fileURLToPath(new URL("../../../../", import.meta.url)), process.env.DOCUMENT_UPLOAD_DIR ?? "uploads"),
};
