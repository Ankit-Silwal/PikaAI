import { Router } from "express";
import type { RequestHandler } from "express";
import { testRoutes } from "./test.routes.js";
import { createAuthRoutes } from "./auth.routes.js";
import type { AuthService } from "../services/auth.service.js";

export function createApiRoutes(authService: AuthService, authLimit: RequestHandler) {
  const router = Router();
  router.use("/test", testRoutes);
  router.use("/auth", createAuthRoutes(authService, authLimit));
  return router;
}
