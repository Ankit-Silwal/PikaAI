import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import * as controller from "./organization.controller.js";

export const organizationRoutes = Router();

organizationRoutes.use(authenticate);
organizationRoutes.post("/", controller.create);
organizationRoutes.post("/join", controller.join);
organizationRoutes.get("/:organizationId/invite-code", controller.inviteCode);
organizationRoutes.get("/:organizationId/members", controller.members);
organizationRoutes.post("/:organizationId/join-requests/:userId/approve", controller.approve);
organizationRoutes.post("/:organizationId/members/:userId/admin", controller.grantAdmin);
