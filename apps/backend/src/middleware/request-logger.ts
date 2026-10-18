import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export function requestLogger({ logRequests = true } = {}): RequestHandler {
  return (req, res, next) => {
    req.id = randomUUID();
    res.setHeader("X-Request-Id", req.id);
    const startedAt = performance.now();
    res.on("finish", () => {
      if (logRequests) console.info(JSON.stringify({
        requestId: req.id,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      }));
    });
    next();
  };
}
