import { rm } from "node:fs/promises";
import { prisma } from "../../configs/db.js";
import { env } from "../../configs/env.js";
import { HttpError } from "../../utils/http-error.js";
import { enqueueDocument } from "./document.queue.js";
import type { DocumentQueryResponse, DocumentResponse, DocumentUploadResponse } from "./document.types.js";

export async function upload(organizationId: string, userId: string, file: Express.Multer.File): Promise<DocumentUploadResponse> {
  let created = false;
  try {
    if (!file.size) throw new HttpError(400, "Document must not be empty");
    if (file.originalname.length > 255 || file.mimetype.length > 255) {
      throw new HttpError(400, "Document filename or MIME type is too long");
    }
    const document = await prisma.document.create({
      data: {
        document_id: file.filename,
        organization_id: organizationId,
        uploaded_by: userId,
        original_name: file.originalname,
        mime_type: file.mimetype,
        size_bytes: file.size,
      },
    });
    created = true;
    await enqueueDocument(document.document_id);
    return { document, jobId: document.document_id };
  } catch (error) {
    try {
      if (created) await prisma.document.deleteMany({ where: { document_id: file.filename } });
    } finally {
      await rm(file.path, { force: true });
    }
    throw error;
  }
}

export async function get(organizationId: string, documentId: string): Promise<DocumentResponse> {
  const document = await prisma.document.findFirst({
    where: { document_id: documentId, organization_id: organizationId },
  });
  if (!document) throw new HttpError(404, "Document not found");
  return { document };
}

export async function query(organizationId: string, question: string): Promise<DocumentQueryResponse> {
  if (!env.ragServiceToken) throw new HttpError(503, "RAG service is not configured");
  try {
    const response = await fetch(env.ragServiceUrl + "/query", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.ragServiceToken, "Content-Type": "application/json" },
      body: JSON.stringify({ organization_id: organizationId, question }),
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) throw new Error("RAG query failed");
    const result = await response.json() as DocumentQueryResponse;
    if (typeof result?.answer !== "string" || !Array.isArray(result?.sources)) throw new Error("Invalid RAG query result");
    return result;
  } catch {
    throw new HttpError(503, "Unable to query documents. Please try again later");
  }
}
