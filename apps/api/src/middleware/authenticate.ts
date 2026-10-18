import type { RequestHandler } from "express";
import { HttpError } from "../utils/http-error.js";
import { verifyToken } from "../utils/jwt.js";

export const authenticate: RequestHandler = (req, res, next) => {
  const [scheme, token, ...extra] = (req.get("Authorization") ?? "").trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || extra.length) {
    throw new HttpError(401, "Authorization: Bearer <accessToken> is required");
  }
  res.locals.user = verifyToken(token, "access");
  next();
};
