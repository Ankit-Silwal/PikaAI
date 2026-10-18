import type { CookieOptions, Request, Response } from "express";
import { env } from "../../configs/env.js";
import { HttpError } from "../../utils/http-error.js";
import * as authService from "./auth.service.js";
import { REFRESH_TOKEN_SECONDS } from "../../utils/jwt.js";
import type { AuthCredentials, AuthResponse, AuthUserResponse } from "./auth.types.js";

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.production,
  sameSite: "lax",
  path: "/",
};

function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie("refreshToken", refreshToken, { ...cookieOptions, maxAge: REFRESH_TOKEN_SECONDS * 1000 });
}

function emailFromBody(body: unknown): string {
  if (!body || typeof body !== "object" || !("email" in body) || typeof body.email !== "string") {
    throw new HttpError(400, "A valid email is required");
  }
  const email = body.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "A valid email is required");
  }
  return email;
}

function credentials(body: unknown): AuthCredentials {
  const email = emailFromBody(body);
  if (!body || typeof body !== "object" || !("password" in body) || typeof body.password !== "string") {
    throw new HttpError(400, "Email and password are required");
  }
  if (body.password.length < 8 || Buffer.byteLength(body.password, "utf8") > 72) {
    throw new HttpError(400, "Password must be at least 8 characters and at most 72 bytes");
  }
  return { email, password: body.password };
}

export async function sendOtp(req: Request, res: Response): Promise<void> {
  await authService.sendOtp(emailFromBody(req.body));
  res.json({ message: "OTP sent to your email" });
}

export async function register(req: Request, res: Response<AuthResponse>): Promise<void> {
  const { email, password } = credentials(req.body);
  const otp: unknown = req.body.otp;
  if (typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
    throw new HttpError(400, "A 6-digit OTP is required");
  }
  const result = await authService.register(email, password, otp);
  setRefreshCookie(res, result.tokens.refreshToken);
  res.status(201).json({ user: result.user, accessToken: result.tokens.accessToken });
}

export async function login(req: Request, res: Response<AuthResponse>): Promise<void> {
  const { email, password } = credentials(req.body);
  const result = await authService.login(email, password);
  setRefreshCookie(res, result.tokens.refreshToken);
  res.json({ user: result.user, accessToken: result.tokens.accessToken });
}

export async function refresh(req: Request, res: Response<AuthResponse>): Promise<void> {
  const result = await authService.refresh(req.cookies?.refreshToken);
  setRefreshCookie(res, result.tokens.refreshToken);
  res.json({ user: result.user, accessToken: result.tokens.accessToken });
}

export async function logout(req: Request, res: Response): Promise<void> {
  await authService.logout(req.cookies?.refreshToken);
  res.clearCookie("refreshToken", cookieOptions);
  res.sendStatus(204);
}

export function me(_req: Request, res: Response<AuthUserResponse>): void {
  res.json({ user: res.locals.user });
}
