import type { User } from "../../generated/prisma/client.js";

export type AuthUser = Pick<User, "user_id" | "email" | "role">;

export type AuthCredentials = {
  email: string;
  password: string;
};

export type TokenType = "access" | "refresh";

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthResult = {
  user: AuthUser;
  tokens: AuthTokens;
};

export type AuthUserResponse = { user: AuthUser };

export type AuthResponse = AuthUserResponse & { accessToken: string };
