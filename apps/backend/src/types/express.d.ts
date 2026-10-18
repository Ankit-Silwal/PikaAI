import type { PrismaClient } from "../generated/prisma/client.js";
import type { AuthContext, AuthState } from "./auth.js";

declare global {
  namespace Express {
    interface Request {
      id: string;
      auth?: AuthContext;
    }
    interface Locals {
      prisma: PrismaClient;
      authState: AuthState;
    }
  }
}

export {};
