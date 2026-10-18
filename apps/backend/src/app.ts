import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { requestLogger } from "./middleware/request-logger.js";
import { errorHandler, notFound } from "./middleware/error-handler.js";
import { apiRoutes } from "./routes/index.js";
import { healthRoutes } from "./routes/health.routes.js";
import type { Database } from "./types/database.js";

export interface AppOptions {
  database: Database;
  corsOrigins?: string[];
  rateLimitMax?: number;
  logRequests?: boolean;
}

// Creating the app separately keeps tests independent of ports and PostgreSQL.
export function createApp({ database, corsOrigins = [], rateLimitMax = 100, logRequests = true }: AppOptions) {
  const app = express();
  app.locals.database = database;
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
    handler(req, res) {
      res.status(429).json({
        success: false,
        error: { message: "Too many requests. Try again later.", requestId: req.id },
      });
    },
  }));
  app.use(express.json({ limit: "16kb" }));
  app.use("/api", apiRoutes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
