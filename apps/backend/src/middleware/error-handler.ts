import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError as ExpectedError } from "../utils/http-error.js";

interface HttpError extends Error {
  status?: number;
  type?: string;
}

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ success: false, error: { message: "Route not found", requestId: req.id } });
};

// Express requires all four arguments to recognize error middleware.
export const errorHandler: ErrorRequestHandler = (caught: unknown, req, res, next) => {
  const error: HttpError = caught instanceof Error ? caught : new Error("Unexpected error");
  if (res.headersSent) return next(error);
  const status = typeof error.status === "number" && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
    ? error.status : 500;
  if (status >= 500) console.error({ requestId: req.id, name: error.name, message: error.message });
  if (status === 401) res.setHeader("WWW-Authenticate", "Bearer");
  const parserType = "type" in error ? error.type : undefined;
  const message = status >= 500 && !(error instanceof ExpectedError) ? "Internal server error"
    : parserType === "entity.parse.failed" ? "Invalid JSON body"
    : parserType === "entity.too.large" ? "Request body too large"
    : error.message;
  res.status(status).json({ success: false, error: {
    message, requestId: req.id,
    ...(error instanceof ExpectedError && error.details ? { details: error.details } : {}),
  } });
};
