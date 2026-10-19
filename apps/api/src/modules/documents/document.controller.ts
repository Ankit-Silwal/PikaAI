import type { NextFunction, Request, Response } from "express";
import { prisma } from "../../configs/db.js";
import { HttpError } from "../../utils/http-error.js";
import * as service from "./document.service.js";
import type { DocumentLocals, DocumentResponse, DocumentUploadResponse } from "./document.types.js";

function uuid(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) {
    throw new HttpError(400, name + " must be a valid UUID");
  }
  return value;
}

export async function requireMember(req: Request, res: Response<unknown, DocumentLocals>, next: NextFunction): Promise<void> {
  const organizationId = uuid(req.params.organizationId, "Organization ID");
  const membership = await prisma.organizationMembership.findUnique({
    where: { organization_id_user_id: { organization_id: organizationId, user_id: res.locals.user.user_id } },
    select: { status: true },
  });
  if (membership?.status !== "ACTIVE") throw new HttpError(403, "Active organization membership required");
  res.locals.organizationId = organizationId;
  next();
}

export async function upload(req: Request, res: Response<DocumentUploadResponse, DocumentLocals>): Promise<void> {
  if (!req.file) throw new HttpError(400, "Upload a document in the file field");
  const result = await service.upload(res.locals.organizationId, res.locals.user.user_id, req.file);
  res.status(202).json(result);
}

export async function get(req: Request, res: Response<DocumentResponse, DocumentLocals>): Promise<void> {
  const documentId = uuid(req.params.documentId, "Document ID");
  res.json(await service.get(res.locals.organizationId, documentId));
}

export async function query(req: Request, res: Response<unknown, DocumentLocals>): Promise<void> {
  const question = req.body?.question;
  if (typeof question !== "string" || !question.trim() || question.trim().length > 4000) {
    throw new HttpError(400, "Question must contain 1 to 4000 characters");
  }
  res.json(await service.query(res.locals.organizationId, question.trim()));
}
