import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { HttpError } from "../utils/http-error.js";
import type { TokenIdentity } from "../types/auth.js";

const identitySchema = z.object({
  sub: z.uuid(), jti: z.uuid(), epoch: z.uuid(),
  exp: z.number().int(), iat: z.number().int(),
});

export class TokenService {
  private readonly key: Uint8Array;
  readonly issuer = "pikaai";
  readonly audience = "pikaai-api";

  constructor(secret: string, readonly ttlSeconds = 900) {
    if (!/^[a-f\d]{64}$/iu.test(secret) || !Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600) {
      throw new Error("Invalid JWT configuration");
    }
    this.key = Buffer.from(secret, "hex");
  }

  async issue(userId: string, epoch: string) {
    const now = Math.floor(Date.now() / 1000);
    const tokenId = randomUUID();
    const accessToken = await new SignJWT({ epoch })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(userId).setJti(tokenId).setIssuedAt(now)
      .setExpirationTime(now + this.ttlSeconds)
      .setIssuer(this.issuer).setAudience(this.audience).sign(this.key);
    return { accessToken, tokenType: "Bearer" as const, expiresIn: this.ttlSeconds };
  }

  async verify(token: string): Promise<TokenIdentity> {
    try {
      if (token.length > 2048) throw new Error("Oversized token");
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ["HS256"], typ: "JWT", issuer: this.issuer, audience: this.audience,
        requiredClaims: ["sub", "jti", "iat", "exp", "epoch"],
        maxTokenAge: this.ttlSeconds,
      });
      const claims = identitySchema.parse(payload);
      if (claims.exp - claims.iat > this.ttlSeconds) throw new Error("Invalid token lifetime");
      return { userId: claims.sub, tokenId: claims.jti, expiresAt: claims.exp, epoch: claims.epoch };
    } catch {
      throw new HttpError(401, "Invalid or expired access token");
    }
  }
}
