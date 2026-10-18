import { Router } from "express";
import { testRoutes } from "./test.routes.js";

export const apiRoutes = Router();
apiRoutes.use("/test", testRoutes);
