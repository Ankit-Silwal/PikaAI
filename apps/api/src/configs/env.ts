import { config } from "dotenv";
import { fileURLToPath } from "node:url";

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
  production: process.env.NODE_ENV === "production",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  accessSecret: jwtSecret("JWT_ACCESS_SECRET"),
  refreshSecret: jwtSecret("JWT_REFRESH_SECRET"),
};

if (env.accessSecret === env.refreshSecret) {
  throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different");
}
