import { randomBytes } from "node:crypto";
import { prisma } from "../../configs/db.js";
import { Prisma } from "../../generated/prisma/client.js";
import { HttpError } from "../../utils/http-error.js";
import type {
  CreateOrganizationInput,
  CreateOrganizationResponse,
  JoinOrganizationResponse,
  MembersResponse,
  OrganizationMember,
} from "./organization.types.js";

const publicOrganization = {
  organization_id: true, name: true, join_policy: true, created_at: true,
} as const;

async function requireAdmin(organizationId: string, userId: string): Promise<void> {
  const membership = await prisma.organizationMembership.findUnique({
    where: { organization_id_user_id: { organization_id: organizationId, user_id: userId } },
    select: { role: true, status: true },
  });
  if (membership?.role !== "ADMIN" || membership.status !== "ACTIVE") {
    throw new HttpError(403, "Organization admin access required");
  }
}

export async function create(userId: string, input: CreateOrganizationInput): Promise<CreateOrganizationResponse> {
  const { invite_code, ...organization } = await prisma.organization.create({
    data: {
      name: input.name,
      join_policy: input.joinPolicy,
      invite_code: randomBytes(16).toString("hex"),
      memberships: { create: { user_id: userId, role: "ADMIN", status: "ACTIVE" } },
    },
    select: { ...publicOrganization, invite_code: true },
  });
  return { organization, inviteCode: invite_code };
}

export async function join(userId: string, inviteCode: string): Promise<JoinOrganizationResponse> {
  const organization = await prisma.organization.findUnique({
    where: { invite_code: inviteCode },
    select: publicOrganization,
  });
  if (!organization) throw new HttpError(404, "Invalid invite code");
  try {
    const membership = await prisma.organizationMembership.create({
      data: {
        organization_id: organization.organization_id,
        user_id: userId,
        role: "MEMBER",
        status: organization.join_policy === "OPEN" ? "ACTIVE" : "PENDING",
      },
    });
    return { organization, membership };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "Already joined or requested to join this organization");
    }
    throw error;
  }
}

export async function getInviteCode(organizationId: string, userId: string): Promise<string> {
  await requireAdmin(organizationId, userId);
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { organization_id: organizationId },
    select: { invite_code: true },
  });
  return organization.invite_code;
}

export async function listMembers(organizationId: string, userId: string): Promise<MembersResponse["members"]> {
  await requireAdmin(organizationId, userId);
  return prisma.organizationMembership.findMany({
    where: { organization_id: organizationId },
    include: { user: { select: { email: true } } },
    orderBy: [{ created_at: "asc" }, { user_id: "asc" }],
  });
}

export async function approve(organizationId: string, adminId: string, userId: string): Promise<OrganizationMember> {
  await requireAdmin(organizationId, adminId);
  const [membership] = await prisma.organizationMembership.updateManyAndReturn({
    where: { organization_id: organizationId, user_id: userId, status: "PENDING" },
    data: { status: "ACTIVE" },
  });
  if (!membership) throw new HttpError(404, "Pending join request not found");
  return membership;
}

export async function grantAdmin(organizationId: string, adminId: string, userId: string): Promise<OrganizationMember> {
  await requireAdmin(organizationId, adminId);
  const [membership] = await prisma.organizationMembership.updateManyAndReturn({
    where: { organization_id: organizationId, user_id: userId, status: "ACTIVE" },
    data: { role: "ADMIN" },
  });
  if (!membership) throw new HttpError(404, "Active organization member not found");
  return membership;
}
