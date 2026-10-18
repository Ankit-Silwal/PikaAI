import { Router } from "express";
import type { ResourceService } from "../services/resource.service.js";
import type { AuthService } from "../services/auth.service.js";
import { createResourceController } from "../controllers/resource.controller.js";
import { authenticate } from "../middleware/authenticate.js";

export function createResourceRoutes(service: ResourceService, authService: AuthService) {
  const router = Router();
  const controller = createResourceController(service);
  router.use(["/organizations", "/workspaces", "/documents"], authenticate(authService));
  router.get("/organizations", controller.listOrganizations);
  router.post("/organizations", controller.createOrganization);
  router.get("/organizations/:organizationId", controller.getOrganization);
  router.get("/organizations/:organizationId/workspaces", controller.listWorkspaces);
  router.post("/organizations/:organizationId/workspaces", controller.createWorkspace);
  router.get("/workspaces/:workspaceId", controller.getWorkspace);
  router.get("/workspaces/:workspaceId/documents", controller.listDocuments);
  router.post("/workspaces/:workspaceId/documents", controller.createDocument);
  router.get("/documents/:documentId", controller.getDocument);
  return router;
}
