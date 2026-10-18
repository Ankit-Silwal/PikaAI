import { randomUUID } from "node:crypto";
import type { RedisClientType } from "redis";
import { RedisStore } from "rate-limit-redis";
import type { RedisReply } from "rate-limit-redis";
import { HttpError } from "../utils/http-error.js";
import type { AuthState, ClientActivity } from "../types/auth.js";

type RedisConnection = RedisClientType<{}, {}, {}, 3, {}>;

export class RedisAuthState implements AuthState {
  constructor(
    private readonly client: RedisConnection,
    private readonly activityTtlSeconds = 86400,
    private readonly prefix = "pikaai:auth:",
  ) {}

  private async command<T>(operation: () => Promise<T>): Promise<T> {
    try {
      if (!this.client.isReady) throw new Error("Redis not ready");
      return await operation();
    } catch {
      throw new HttpError(503, "Authentication service unavailable");
    }
  }

  async ping(): Promise<void> {
    await this.command(() => this.client.ping());
  }

  async getEpoch(): Promise<string> {
    return this.command(async () => {
      const key = `${this.prefix}epoch`;
      await this.client.set(key, randomUUID(), { NX: true });
      const epoch = await this.client.get(key);
      if (!epoch) throw new Error("Missing token epoch");
      return epoch;
    });
  }

  async isAllowed(epoch: string, tokenId: string): Promise<boolean> {
    return this.command(async () => {
      const [currentEpoch, revoked] = await this.client.mGet([
        `${this.prefix}epoch`, `${this.prefix}revoked:${tokenId}`,
      ]);
      return currentEpoch === epoch && revoked === null;
    });
  }

  async revoke(tokenId: string, expiresAt: number): Promise<void> {
    const ttl = Math.max(1, expiresAt - Math.floor(Date.now() / 1000));
    await this.command(() => this.client.set(`${this.prefix}revoked:${tokenId}`, "1", { EX: ttl }));
  }

  async recordActivity(userId: string, activity: ClientActivity, login = false): Promise<void> {
    const key = `${this.prefix}activity:${userId}`;
    const now = new Date().toISOString();
    const fields: Record<string, string> = {
      ip: activity.ip, userAgent: activity.userAgent.slice(0, 512), lastSeenAt: now,
    };
    if (login) fields.lastLoginAt = now;
    await this.command(() => this.client.multi()
      .hSet(key, fields).expire(key, this.activityTtlSeconds).exec());
  }

  async getActivity(userId: string): Promise<Record<string, string>> {
    return this.command(() => this.client.hGetAll(`${this.prefix}activity:${userId}`));
  }
}

export function createRedisRateLimitStore(client: RedisConnection, prefix: string) {
  return new RedisStore({
    prefix,
    async sendCommand(...args: string[]): Promise<RedisReply> {
      try {
        if (!client.isReady) throw new Error("Redis not ready");
        return await client.sendCommand(args) as RedisReply;
      } catch {
        throw new HttpError(503, "Rate limiting service unavailable");
      }
    },
  });
}
