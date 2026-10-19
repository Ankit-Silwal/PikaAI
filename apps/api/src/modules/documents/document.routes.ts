import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import * as controller from "./document.controller.js";
import { uploadDocument } from "./document.upload.js";

export const documentRoutes = Router({ mergeParams: true });

documentRoutes.use(authenticate, controller.requireMember);
documentRoutes.post("/", uploadDocument, controller.upload);
documentRoutes.post("/query", controller.query);
documentRoutes.get("/:documentId", controller.get);
