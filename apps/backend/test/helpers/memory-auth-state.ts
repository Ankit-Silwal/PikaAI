import { randomUUID } from "node:crypto";
import type { AuthState, ClientActivity } from "../../src/types/auth.js";

// Unit-test substitute only. Production always uses RedisAuthState.
export class MemoryAuthState implements AuthState {
  epoch = randomUUID();
  readonly revoked = new Set<string>();
  readonly activity = new Map<string, Record<string, string>>();
  async ping() {}
  async getEpoch() { return this.epoch; }
  async isAllowed(epoch: string, tokenId: string) {
    return epoch === this.epoch && !this.revoked.has(tokenId);
  }
  async revoke(tokenId: string) { this.revoked.add(tokenId); }
  async recordActivity(userId: string, activity: ClientActivity, login = false) {
    const now = new Date().toISOString();
    this.activity.set(userId, {
      ...this.activity.get(userId), ...activity, lastSeenAt: now,
      ...(login ? { lastLoginAt: now } : {}),
    });
  }
  async getActivity(userId: string) { return this.activity.get(userId) ?? {}; }
}
