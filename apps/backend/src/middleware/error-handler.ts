import type { ErrorRequestHandler, RequestHandler } from "express";

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
  if (status >= 500) console.error({ requestId: req.id, error });
  const message = status >= 500 ? "Internal server error"
    : error.type === "entity.parse.failed" ? "Invalid JSON body"
    : error.type === "entity.too.large" ? "Request body too large"
    : error.message;
  res.status(status).json({ success: false, error: { message, requestId: req.id } });
};
