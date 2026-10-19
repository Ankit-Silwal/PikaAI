import type { Document } from "../../generated/prisma/client.js";
import type { AuthUser } from "../auth/auth.types.js";

export type DocumentResponse = { document: Document };
export type DocumentUploadResponse = DocumentResponse & { jobId: string };
export type DocumentLocals = { user: AuthUser; organizationId: string };
export type DocumentQueryResponse = {
  answer: string;
  sources: { document_id: string; filename: string; chunk_index: number; text: string; page_label: string | null }[];
};
