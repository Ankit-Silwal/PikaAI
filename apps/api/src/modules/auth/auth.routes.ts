import { Router } from "express";
import { env } from "../../configs/env.js";
import { authenticate } from "../../middleware/authenticate.js";
import { loginRateLimit, otpRateLimit, registerRateLimit } from "../../middleware/rate-limit.js";
import { HttpError } from "../../utils/http-error.js";
import * as controller from "./auth.controller.js";

export const authRoutes = Router();

authRoutes.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  const origin = req.get("Origin");
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS" &&
      ((origin && origin !== env.corsOrigin) || (!origin && req.get("Sec-Fetch-Site") === "cross-site"))) {
    throw new HttpError(403, "Origin not allowed");
  }
  next();
});

authRoutes.post("/send-otp", otpRateLimit, controller.sendOtp);
authRoutes.post("/register", registerRateLimit, controller.register);
authRoutes.post("/login", loginRateLimit, controller.login);
authRoutes.post("/refresh", controller.refresh);
authRoutes.post("/logout", controller.logout);
authRoutes.get("/me", authenticate, controller.me);
