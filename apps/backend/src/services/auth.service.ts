import type { PrismaClient } from "../generated/prisma/client.js";
import { Prisma } from "../generated/prisma/client.js";
import type { AuthContext, AuthState, ClientActivity } from "../types/auth.js";
import type { z } from "zod";
import type { loginSchema, registerSchema } from "../validators/request.js";
import { HttpError } from "../utils/http-error.js";
import { hashPassword, verifyPassword, verifyUnknownPassword } from "./password.service.js";
import type { TokenService } from "./token.service.js";

export const publicUserSelect = { id: true, name: true, email: true, createdAt: true } as const;

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tokens: TokenService,
    readonly state: AuthState,
  ) {}

  async register(input: z.infer<typeof registerSchema>, activity: ClientActivity) {
    const epoch = await this.state.getEpoch();
    const passwordHash = await hashPassword(input.password);
    try {
      // A Redis failure rolls back account creation. Hashing stays outside the transaction.
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { name: input.name, email: input.email, passwordHash }, select: publicUserSelect,
        });
        const token = await this.tokens.issue(user.id, epoch);
        await this.state.recordActivity(user.id, activity, true);
        return { user, ...token };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(409, "Email is already registered");
      }
      throw error;
    }
  }

  async login(input: z.infer<typeof loginSchema>, activity: ClientActivity) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email }, select: { ...publicUserSelect, passwordHash: true },
    });
    if (!user) {
      await verifyUnknownPassword(input.password);
      throw new HttpError(401, "Invalid email or password");
    }
    if (!await verifyPassword(input.password, user.passwordHash)) {
      throw new HttpError(401, "Invalid email or password");
    }
    const epoch = await this.state.getEpoch();
    const token = await this.tokens.issue(user.id, epoch);
    await this.state.recordActivity(user.id, activity, true);
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return { user: safeUser, ...token };
  }

  async authenticate(token: string, activity: ClientActivity): Promise<AuthContext> {
    const identity = await this.tokens.verify(token);
    if (!await this.state.isAllowed(identity.epoch, identity.tokenId)) {
      throw new HttpError(401, "Access token has been revoked");
    }
    const user = await this.prisma.user.findUnique({
      where: { id: identity.userId }, select: publicUserSelect,
    });
    if (!user) throw new HttpError(401, "User is no longer available");
    await this.state.recordActivity(user.id, activity);
    return { ...identity, user };
  }
}
