import type { Database } from "./database.js";

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
    interface Locals {
      database: Database;
    }
  }
}

export {};
