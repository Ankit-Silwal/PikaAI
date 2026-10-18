import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import multer from "multer";
import type { RequestHandler } from "express";
import { env } from "../../configs/env.js";
import { HttpError } from "../../utils/http-error.js";

const parseUpload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, callback) {
      mkdir(env.documentUploadDir, { recursive: true })
        .then(() => callback(null, env.documentUploadDir))
        .catch(error => callback(error, env.documentUploadDir));
    },
    filename(_req, _file, callback) {
      callback(null, randomUUID());
    },
  }),
  limits: { fileSize: env.maxUploadBytes, files: 1, fields: 0 },
}).single("file");

export const uploadDocument: RequestHandler = (req, res, next) => {
  parseUpload(req, res, error => {
    if (error instanceof Error && (error.message.startsWith("Multipart:") || error.message === "Unexpected end of form")) {
      next(new HttpError(400, "Invalid multipart upload"));
      return;
    }
    next(error);
  });
};
