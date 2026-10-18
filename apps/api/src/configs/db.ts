import { PrismaPg } from "@prisma/adapter-pg";
import "./env.js";
import { PrismaClient } from "../generated/prisma/client.js";

export const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  }),
});
