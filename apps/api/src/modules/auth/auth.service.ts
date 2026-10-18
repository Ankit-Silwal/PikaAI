import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { prisma } from "../../configs/db.js";
import { HttpError } from "../../utils/http-error.js";
import { createTokens, hashRefreshToken, verifyToken } from "../../utils/jwt.js";
import type { AuthResult, AuthUser } from "./auth.types.js";
import { consumeRegistrationOtp, sendRegistrationOtp } from "./otp.service.js";

const publicUser = { user_id: true, email: true, role: true } as const;

export async function sendOtp(email: string): Promise<void> {
  if (await prisma.user.findUnique({ where: { email }, select: { user_id: true } })) {
    throw new HttpError(409, "Email already registered");
  }
  await sendRegistrationOtp(email);
}

export async function register(email: string, password: string, otp: string): Promise<AuthResult> {
  if (await prisma.user.findUnique({ where: { email }, select: { user_id: true } })) {
    throw new HttpError(409, "Email already registered");
  }
  await consumeRegistrationOtp(email, otp);
  const identity: AuthUser = { user_id: randomUUID(), email, role: "USER" };
  const tokens = createTokens(identity);
  const user = await prisma.user.create({
    data: {
      ...identity,
      password_hash: await bcrypt.hash(password, 12),
      refreshToken: hashRefreshToken(tokens.refreshToken),
    },
    select: publicUser,
  });
  return { user, tokens };
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing || !(await bcrypt.compare(password, existing.password_hash))) {
    throw new HttpError(401, "Invalid email or password");
  }
  const tokens = createTokens(existing);
  const user = await prisma.user.update({
    where: { user_id: existing.user_id },
    data: { refreshToken: hashRefreshToken(tokens.refreshToken) },
    select: publicUser,
  });
  return { user, tokens };
}

export async function refresh(token: unknown): Promise<AuthResult> {
  const identity = verifyToken(token, "refresh");
  const user = await prisma.user.findUnique({ where: { user_id: identity.user_id }, select: publicUser });
  if (!user) throw new HttpError(401, "Invalid or expired token");
  const tokens = createTokens(user);
  const result = await prisma.user.updateMany({
    where: { user_id: user.user_id, refreshToken: hashRefreshToken(token as string) },
    data: { refreshToken: hashRefreshToken(tokens.refreshToken) },
  });
  if (result.count !== 1) throw new HttpError(401, "Invalid or expired token");
  return { user, tokens };
}

export async function logout(token: unknown): Promise<void> {
  if (typeof token !== "string") return;
  let user: AuthUser;
  try {
    user = verifyToken(token, "refresh");
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return;
    throw error;
  }
  await prisma.user.updateMany({
    where: { user_id: user.user_id, refreshToken: hashRefreshToken(token) },
    data: { refreshToken: null },
  });
}
