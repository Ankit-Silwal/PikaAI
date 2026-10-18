import { Router } from "express";
import { echoTest, getDatabaseTest, getTest } from "../controllers/test.controller.js";

export const testRoutes = Router();
testRoutes.get("/", getTest);
testRoutes.post("/echo", echoTest);
testRoutes.get("/db", getDatabaseTest);
