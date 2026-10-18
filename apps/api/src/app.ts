import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { healthRoutes } from "./modules/health/health.routes.js";

export const app = express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());

app.use("/health", healthRoutes);
