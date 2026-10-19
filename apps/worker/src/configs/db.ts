import { Pool } from "pg";
import { env } from "./env.js";

export const pool = new Pool({ connectionString: env.databaseUrl, connectionTimeoutMillis: 5000 });
pool.on("error", error => console.error("Worker database error:", error.message));
