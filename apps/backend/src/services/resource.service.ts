import { Prisma } from "../generated/prisma/client.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { z } from "zod";
import type { documentSchema, paginationSchema, workspaceSchema } from "../validators/request.js";
import { HttpError } from "../utils/http-error.js";

type Pagination = z.infer<typeof paginationSchema>;
const newestFirst = [{ createdAt: "desc" }, { id: "desc" }] as const;
const documentMetadata = {
  id: true, workspaceId: true, title: true, createdBy: true, createdAt: true,
} as const;

// Membership filters stay in database queries, so JWTs cannot carry stale tenant roles.
const memberOrganization = (userId: string) => ({ members: { some: { userId } } });
const memberWorkspace = (userId: string) => ({ organization: memberOrganization(userId) });

function missingRelation(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2025", "P2003"].includes(error.code)) {
    throw new HttpError(404, "Resource not found");
  }
  throw error;
}

export class ResourceService {
  constructor(private readonly prisma: PrismaClient) {}

  async listOrganizations(userId: string, pagination: Pagination) {
    const rows = await this.prisma.organization.findMany({
      where: memberOrganization(userId), take: pagination.limit, skip: pagination.offset,
      orderBy: [...newestFirst],
      include: { members: { where: { userId }, select: { role: true } } },
    });
    return rows.map(({ members, ...organization }) => ({ ...organization, role: members[0]!.role }));
  }

  async createOrganization(userId: string, name: string) {
    // Nested writes create the organization and its owner in one transaction.
    const { members, ...organization } = await this.prisma.organization.create({
      data: { name, createdBy: userId, members: { create: { userId, role: "owner" } } },
      include: { members: { select: { role: true } } },
    });
    return { ...organization, role: members[0]!.role };
  }

  async getOrganization(userId: string, organizationId: string) {
    const row = await this.prisma.organization.findFirst({
      where: { id: organizationId, ...memberOrganization(userId) },
      include: { members: { where: { userId }, select: { role: true } } },
    });
    if (!row) throw new HttpError(404, "Organization not found");
    const { members, ...organization } = row;
    return { ...organization, role: members[0]!.role };
  }

  async listWorkspaces(userId: string, organizationId: string, pagination: Pagination) {
    await this.getOrganization(userId, organizationId);
    return this.prisma.workspace.findMany({
      where: { organizationId, ...memberWorkspace(userId) },
      take: pagination.limit, skip: pagination.offset, orderBy: [...newestFirst],
    });
  }

  async createWorkspace(userId: string, organizationId: string, input: z.infer<typeof workspaceSchema>) {
    try {
      return await this.prisma.workspace.create({
        data: {
          ...input,
          // The relation's unique lookup also verifies membership at creation time.
          organization: { connect: { id: organizationId, ...memberOrganization(userId) } },
          creator: { connect: { id: userId } },
        },
      });
    } catch (error) { return missingRelation(error); }
  }

  async getWorkspace(userId: string, workspaceId: string) {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, ...memberWorkspace(userId) },
    });
    if (!workspace) throw new HttpError(404, "Workspace not found");
    return workspace;
  }

  async listDocuments(userId: string, workspaceId: string, pagination: Pagination) {
    await this.getWorkspace(userId, workspaceId);
    return this.prisma.document.findMany({
      where: { workspaceId, workspace: memberWorkspace(userId) },
      take: pagination.limit, skip: pagination.offset, orderBy: [...newestFirst],
      select: documentMetadata,
    });
  }

  async createDocument(userId: string, workspaceId: string, input: z.infer<typeof documentSchema>) {
    try {
      return await this.prisma.document.create({
        data: {
          ...input,
          workspace: { connect: { id: workspaceId, ...memberWorkspace(userId) } },
          creator: { connect: { id: userId } },
        },
      });
    } catch (error) { return missingRelation(error); }
  }

  async getDocument(userId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, workspace: memberWorkspace(userId) },
    });
    if (!document) throw new HttpError(404, "Document not found");
    return document;
  }
}
