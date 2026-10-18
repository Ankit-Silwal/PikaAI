import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

dotenv.config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });

function positiveInteger(name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return value;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required. Copy .env.example to .env.`);
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
if (!["development", "test", "production"].includes(nodeEnv)) {
  throw new Error("NODE_ENV must be development, test, or production");
}

const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:5173")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
for (const origin of corsOrigins) {
  const url = new URL(origin);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) {
    throw new Error("CORS_ORIGINS must contain exact HTTP(S) origins without trailing slashes");
  }
}

export const env = {
  nodeEnv,
  host: process.env.HOST ?? "0.0.0.0",
  port: positiveInteger("PORT", 3001, 65535),
  corsOrigins,
  rateLimitMax: positiveInteger("RATE_LIMIT_MAX", 100),
  database: {
    host: process.env.PGHOST ?? "localhost",
    port: positiveInteger("PGPORT", 55432, 65535),
    user: required("PGUSER"),
    password: required("PGPASSWORD"),
    database: required("PGDATABASE"),
  },
};
