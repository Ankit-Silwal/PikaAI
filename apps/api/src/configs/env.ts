import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });

function jwtSecret(name: string): string {
  const value = process.env[name];
  if (!value || value.length < 32) {
    throw new Error(name + " must contain at least 32 characters");
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  ragServiceUrl: (process.env.RAG_SERVICE_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, ""),
  ragServiceToken: process.env.RAG_SERVICE_TOKEN ?? "",
  production: process.env.NODE_ENV === "production",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  accessSecret: jwtSecret("JWT_ACCESS_SECRET"),
  refreshSecret: jwtSecret("JWT_REFRESH_SECRET"),
  redisHost: process.env.REDIS_HOST ?? "localhost",
  redisPort: Number(process.env.REDIS_PORT ?? 56379),
  redisPassword: process.env.REDIS_PASSWORD || undefined,
  redisPrefix: process.env.REDIS_KEY_PREFIX ?? "pikaai:",
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",
  smtpFrom: process.env.SMTP_FROM || process.env.SMTP_USER || "",
  documentUploadDir: resolve(fileURLToPath(new URL("../../../../", import.meta.url)), process.env.DOCUMENT_UPLOAD_DIR ?? "uploads"),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024),
};

if (env.accessSecret === env.refreshSecret) {
  throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different");
}

if (!Number.isSafeInteger(env.maxUploadBytes) || env.maxUploadBytes < 1 || env.maxUploadBytes > 2147483647) {
  throw new Error("MAX_UPLOAD_BYTES must be an integer between 1 and 2147483647");
}
