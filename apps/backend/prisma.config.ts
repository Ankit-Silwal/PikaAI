import { defineConfig } from "prisma/config";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

const url = new URL("postgresql://localhost/pikaai");
url.hostname = process.env.PGHOST ?? "localhost";
url.port = process.env.PGPORT ?? "55432";
url.username = process.env.PGUSER ?? "pikaai";
url.password = process.env.PGPASSWORD ?? "";
url.pathname = `/${process.env.PGDATABASE ?? "pikaai"}`;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: url.toString() },
});
