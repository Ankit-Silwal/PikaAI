import { Router } from "express";
import { getHealth } from "./health.controller.js";

export const healthRoutes = Router();

healthRoutes.get("/", getHealth);
