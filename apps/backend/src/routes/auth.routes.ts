import { Router } from "express";
import type { RequestHandler } from "express";
import type { AuthService } from "../services/auth.service.js";
import { createAuthController } from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/authenticate.js";

export function createAuthRoutes(service: AuthService, authLimit: RequestHandler) {
  const router = Router();
  const controller = createAuthController(service);
  router.use((req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.post("/register", authLimit, controller.register);
  router.post("/login", authLimit, controller.login);
  router.get("/me", authenticate(service), controller.me);
  router.get("/activity", authenticate(service), controller.activity);
  router.post("/logout", authenticate(service), controller.logout);
  return router;
}
