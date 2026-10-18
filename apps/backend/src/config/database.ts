import pg from "pg";
import { env } from "./env.js";

export const pool = new pg.Pool({
  ...env.database,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 3_000,
  statement_timeout: 3_000,
  query_timeout: 4_000,
});

// Idle clients can emit errors independently of requests.
pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error", error);
});
