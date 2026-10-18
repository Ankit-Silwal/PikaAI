import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import type { Store } from "express-rate-limit";
import { requestLogger } from "./middleware/request-logger.js";
import { errorHandler, notFound } from "./middleware/error-handler.js";
import { createApiRoutes } from "./routes/index.js";
import { healthRoutes } from "./routes/health.routes.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import type { AuthState } from "./types/auth.js";
import { AuthService } from "./services/auth.service.js";
import type { TokenService } from "./services/token.service.js";

export interface AppOptions {
  prisma: PrismaClient;
  authState: AuthState;
  tokens: TokenService;
  corsOrigins?: string[];
  rateLimitMax?: number;
  authRateLimitMax?: number;
  rateLimitStores?: { api: Store; auth: Store };
  trustedProxies?: string[];
  logRequests?: boolean;
}

// Creating the app separately keeps tests independent of ports and PostgreSQL.
export function createApp({
  prisma, authState, tokens, corsOrigins = [], rateLimitMax = 100,
  authRateLimitMax = 10, rateLimitStores, trustedProxies = [], logRequests = true,
}: AppOptions) {
  const app = express();
  app.locals.prisma = prisma;
  app.locals.authState = authState;
  if (trustedProxies.length > 0) app.set("trust proxy", trustedProxies);
  const authService = new AuthService(prisma, tokens, authState);
  app.disable("x-powered-by");
  app.use(requestLogger({ logRequests }));
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      // CLI/server clients do not send Origin. Browser origins must be allowed.
      if (!origin || corsOrigins.includes(origin)) return callback(null, true);
      const error = Object.assign(new Error("Origin is not allowed by CORS"), { status: 403 });
      callback(error);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["X-Request-Id"],
    credentials: false,
    maxAge: 600,
  }));
  // Health probes remain available when API clients hit the rate limit.
  app.use("/health", healthRoutes);
  app.use("/api", rateLimit({
    windowMs: 60_000,
    limit: rateLimitMax,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store: rateLimitStores?.api,
    passOnStoreError: false,
    handler(req, res) {
      res.status(429).json({
        success: false,
        error: { message: "Too many requests. Try again later.", requestId: req.id },
      });
    },
  }));
  const authLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: authRateLimitMax,
    standardHeaders: "draft-8", legacyHeaders: false,
    store: rateLimitStores?.auth, passOnStoreError: false,
    handler(req, res) {
      res.status(429).json({ success: false, error: {
        message: "Too many authentication attempts. Try again later.", requestId: req.id,
      } });
    },
  });
  // Only workspace document uploads need a larger JSON budget.
  app.use("/api/workspaces", express.json({ limit: "512kb" }));
  app.use(express.json({ limit: "16kb" }));
  app.use("/api", createApiRoutes(authService, authLimit));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
