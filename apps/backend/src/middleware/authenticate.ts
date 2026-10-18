import type { Request, RequestHandler } from "express";
import type { AuthService } from "../services/auth.service.js";
import { HttpError } from "../utils/http-error.js";

export function clientActivity(req: Request) {
  return { ip: req.ip ?? req.socket.remoteAddress ?? "unknown", userAgent: req.get("user-agent") ?? "unknown" };
}

export function requireAuth(req: Request) {
  if (!req.auth) throw new HttpError(401, "Authentication required");
  return req.auth;
}

export function authenticate(service: AuthService): RequestHandler {
  return async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const match = /^Bearer (\S+)$/iu.exec(req.get("authorization") ?? "");
    if (!match?.[1]) throw new HttpError(401, "A Bearer access token is required");
    req.auth = await service.authenticate(match[1], clientActivity(req));
    next();
  };
}
