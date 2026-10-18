import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { env } from "./configs/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { organizationRoutes } from "./modules/organizations/organization.routes.js";

export const app = express();

app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use("/health", healthRoutes);
app.use("/auth", authRoutes);
app.use("/organizations", organizationRoutes);
app.use(errorHandler);
