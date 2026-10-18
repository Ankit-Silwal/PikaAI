import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "./generated/prisma/client.js";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

export const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  }),
});
