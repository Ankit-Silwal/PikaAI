import type { Document } from "../../generated/prisma/client.js";
import type { AuthUser } from "../auth/auth.types.js";

export type DocumentJobData = { documentId: string };
export type DocumentResponse = { document: Document };
export type DocumentUploadResponse = DocumentResponse & { jobId: string };
export type DocumentLocals = { user: AuthUser; organizationId: string };
