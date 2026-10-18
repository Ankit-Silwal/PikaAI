import { createHash, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../configs/env.js";
import type { AuthTokens, AuthUser, TokenType } from "../modules/auth/auth.types.js";
import { HttpError } from "./http-error.js";

export const ACCESS_TOKEN_SECONDS = 24 * 60 * 60;
export const REFRESH_TOKEN_SECONDS = 7 * 24 * 60 * 60;

export function createTokens(user: AuthUser): AuthTokens {
  function sign(type: TokenType) {
    return jwt.sign(
      { email: user.email, role: user.role, type },
      type === "access" ? env.accessSecret : env.refreshSecret,
      {
        algorithm: "HS256",
        subject: user.user_id,
        issuer: "pikaai",
        audience: "pikaai:" + type,
        expiresIn: type === "access" ? ACCESS_TOKEN_SECONDS : REFRESH_TOKEN_SECONDS,
        jwtid: randomUUID(),
      },
    );
  }
  return { accessToken: sign("access"), refreshToken: sign("refresh") };
}

export function verifyToken(token: unknown, type: TokenType): AuthUser {
  if (typeof token !== "string") throw new HttpError(401, "Authentication required");
  try {
    const payload = jwt.verify(token, type === "access" ? env.accessSecret : env.refreshSecret, {
      algorithms: ["HS256"],
      issuer: "pikaai",
      audience: "pikaai:" + type,
    });
    if (
      typeof payload === "string" || typeof payload.sub !== "string" ||
      typeof payload.email !== "string" || typeof payload.exp !== "number" ||
      payload.type !== type || (payload.role !== "USER" && payload.role !== "ADMIN")
    ) throw new Error("Invalid token claims");
    return { user_id: payload.sub, email: payload.email, role: payload.role };
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
