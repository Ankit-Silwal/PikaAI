import type { RequestHandler } from "express";
import type { ResourceService } from "../services/resource.service.js";
import { requireAuth } from "../middleware/authenticate.js";
import {
  documentSchema, organizationSchema, paginationSchema, parse, uuidSchema, workspaceSchema,
} from "../validators/request.js";

export function createResourceController(service: ResourceService) {
  const listOrganizations: RequestHandler = async (req, res) => {
    const pagination = parse(paginationSchema, req.query);
    res.json({ success: true, data: await service.listOrganizations(requireAuth(req).userId, pagination), pagination });
  };
  const createOrganization: RequestHandler = async (req, res) => {
    const { name } = parse(organizationSchema, req.body);
    const data = await service.createOrganization(requireAuth(req).userId, name);
    res.location(`/api/organizations/${data.id}`).status(201).json({ success: true, data });
  };
  const getOrganization: RequestHandler = async (req, res) => {
    const id = parse(uuidSchema, req.params.organizationId);
    res.json({ success: true, data: await service.getOrganization(requireAuth(req).userId, id) });
  };
  const listWorkspaces: RequestHandler = async (req, res) => {
    const id = parse(uuidSchema, req.params.organizationId);
    const pagination = parse(paginationSchema, req.query);
    res.json({ success: true, data: await service.listWorkspaces(requireAuth(req).userId, id, pagination), pagination });
  };
  const createWorkspace: RequestHandler = async (req, res) => {
    const id = parse(uuidSchema, req.params.organizationId);
    const input = parse(workspaceSchema, req.body);
    const data = await service.createWorkspace(requireAuth(req).userId, id, input);
    res.location(`/api/workspaces/${data.id}`).status(201).json({ success: true, data });
  };
  const getWorkspace: RequestHandler = async (req, res) => {
    const id = parse(uuidSchema, req.params.workspaceId);
    res.json({ success: true, data: await service.getWorkspace(requireAuth(req).userId, id) });
  };
  const listDocuments: RequestHandler = async (req, res) => {
    const id = parse(uuidSchema, req.params.workspaceId);
    const pagination = parse(paginationSchema, req.query);
    res.json({ success: true, data: await service.listDocuments(requireAuth(req).userId, id, pagination), pagination });
  };
  const createDocument: RequestHandler = async (req, res) => {
    const id = parse(uuidSchema, req.params.workspaceId);
    const input = parse(documentSchema, req.body);
    const data = await service.createDocument(requireAuth(req).userId, id, input);
    res.location(`/api/documents/${data.id}`).status(201).json({ success: true, data });
  };
  const getDocument: RequestHandler = async (req, res) => {
    const id = parse(uuidSchema, req.params.documentId);
    res.json({ success: true, data: await service.getDocument(requireAuth(req).userId, id) });
  };
  return {
    listOrganizations, createOrganization, getOrganization,
    listWorkspaces, createWorkspace, getWorkspace,
    listDocuments, createDocument, getDocument,
  };
}
