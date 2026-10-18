import { Router } from "express";
import type { RequestHandler } from "express";
import { testRoutes } from "./test.routes.js";
import { createAuthRoutes } from "./auth.routes.js";
import type { AuthService } from "../services/auth.service.js";
import type { ResourceService } from "../services/resource.service.js";
import { createResourceRoutes } from "./resource.routes.js";

export function createApiRoutes(authService: AuthService, resources: ResourceService, authLimit: RequestHandler) {
  const router = Router();
  router.use("/test", testRoutes);
  router.use("/auth", createAuthRoutes(authService, authLimit));
  router.use(createResourceRoutes(resources, authService));
  return router;
}
