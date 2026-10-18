import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "./env.js";

export const prisma = new PrismaClient({
  adapter: new PrismaPg({
    ...env.database,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 3_000,
    statement_timeout: 5_000,
    query_timeout: 6_000,
  }, {
    onPoolError: (error) => console.error("Unexpected PostgreSQL pool error", error.message),
  }),
});
