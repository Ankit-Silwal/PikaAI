import type { Request, Response } from "express";
import { HttpError } from "../../utils/http-error.js";
import * as service from "./organization.service.js";
import type {
  CreateOrganizationInput,
  CreateOrganizationResponse,
  InviteCodeResponse,
  JoinOrganizationResponse,
  MembersResponse,
  MembershipResponse,
  OrganizationLocals,
} from "./organization.types.js";

function createInput(body: unknown): CreateOrganizationInput {
  if (!body || typeof body !== "object" || !("name" in body) || typeof body.name !== "string" ||
      !body.name.trim() || body.name.trim().length > 100) {
    throw new HttpError(400, "Organization name must contain 1 to 100 characters");
  }
  if (!("joinPolicy" in body) || (body.joinPolicy !== "OPEN" && body.joinPolicy !== "APPROVAL_REQUIRED")) {
    throw new HttpError(400, "Join policy must be OPEN or APPROVAL_REQUIRED");
  }
  return { name: body.name.trim(), joinPolicy: body.joinPolicy };
}

function uuid(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) {
    throw new HttpError(400, name + " must be a valid UUID");
  }
  return value;
}

export async function create(req: Request, res: Response<CreateOrganizationResponse, OrganizationLocals>): Promise<void> {
  const result = await service.create(res.locals.user.user_id, createInput(req.body));
  res.status(201).json(result);
}

export async function join(req: Request, res: Response<JoinOrganizationResponse, OrganizationLocals>): Promise<void> {
  const body: unknown = req.body;
  if (!body || typeof body !== "object" || !("inviteCode" in body) || typeof body.inviteCode !== "string" ||
      !/^[\da-f]{32}$/i.test(body.inviteCode.trim())) {
    throw new HttpError(400, "A valid invite code is required");
  }
  const result = await service.join(res.locals.user.user_id, body.inviteCode.trim().toLowerCase());
  res.status(201).json(result);
}

export async function inviteCode(req: Request, res: Response<InviteCodeResponse, OrganizationLocals>): Promise<void> {
  const organizationId = uuid(req.params.organizationId, "Organization ID");
  res.json({ inviteCode: await service.getInviteCode(organizationId, res.locals.user.user_id) });
}

export async function members(req: Request, res: Response<MembersResponse, OrganizationLocals>): Promise<void> {
  const organizationId = uuid(req.params.organizationId, "Organization ID");
  res.json({ members: await service.listMembers(organizationId, res.locals.user.user_id) });
}

export async function approve(req: Request, res: Response<MembershipResponse, OrganizationLocals>): Promise<void> {
  const organizationId = uuid(req.params.organizationId, "Organization ID");
  const userId = uuid(req.params.userId, "User ID");
  res.json({ membership: await service.approve(organizationId, res.locals.user.user_id, userId) });
}

export async function grantAdmin(req: Request, res: Response<MembershipResponse, OrganizationLocals>): Promise<void> {
  const organizationId = uuid(req.params.organizationId, "Organization ID");
  const userId = uuid(req.params.userId, "User ID");
  res.json({ membership: await service.grantAdmin(organizationId, res.locals.user.user_id, userId) });
}
