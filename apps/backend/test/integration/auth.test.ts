import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { env } from "../../src/config/env.js";
import { TokenService } from "../../src/services/token.service.js";
import { createRedisRateLimitStore, RedisAuthState } from "../../src/services/redis-auth-state.service.js";

const runId = randomUUID();
const prefix = `pikaai:test:${runId}:`;
const email = `${runId}@integration.pikaai.test`;
const password = "correct horse battery staple";
const tokens = new TokenService(env.jwtSecret);
const state = new RedisAuthState(redis, 60, `${prefix}auth:`);
function makeApp(ratePrefix = `${prefix}rate:`, authRateLimitMax = 100) {
  return createApp({
    prisma, tokens, authState: state, logRequests: false, rateLimitMax: 1000, authRateLimitMax,
    rateLimitStores: {
      api: createRedisRateLimitStore(redis, `${ratePrefix}api:`),
      auth: createRedisRateLimitStore(redis, `${ratePrefix}auth:`),
    },
  });
}
let app: ReturnType<typeof makeApp>;
let accessToken: string;
let userId: string;

describe("authentication with local Prisma/PostgreSQL and Redis", { concurrency: false }, () => {
  before(async () => {
    await prisma.$connect();
    await redis.connect();
    app = makeApp();
  });
  after(async () => {
    try {
      await prisma.user.deleteMany({ where: { email } });
      for await (const keys of redis.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
        if (keys.length) await redis.del(keys);
      }
    } finally {
      await prisma.$disconnect();
      if (redis.isOpen) await redis.close();
    }
  });

  test("register persists a hash and returns only public user fields", async () => {
    const response = await request(app).post("/api/auth/register")
      .set("User-Agent", "PikaAI integration test")
      .send({ name: " Alice ", email: email.toUpperCase(), password }).expect(201);
    accessToken = response.body.data.accessToken;
    userId = response.body.data.user.id;
    assert.equal(response.body.data.user.email, email);
    assert.equal(response.body.data.user.name, "Alice");
    assert.equal(response.body.data.user.passwordHash, undefined);
    assert.equal(response.body.data.tokenType, "Bearer");
    assert.equal(response.headers["cache-control"], "no-store");
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.match(stored.passwordHash, /^scrypt\$/u);
    assert.notEqual(stored.passwordHash, password);
  });

  test("duplicate normalized email returns 409 and malformed inputs return 400", async () => {
    await request(app).post("/api/auth/register").send({ name: "Alice", email, password }).expect(409);
    await request(app).post("/api/auth/register").send({ name: "Alice", email: "invalid", password }).expect(400);
    await request(app).post("/api/auth/register").send({ name: "Alice", email, password: "short" }).expect(400);
    await request(app).post("/api/auth/register").send({ name: "Alice", email, password, role: "owner" }).expect(400);
  });

  test("login rejects incorrect credentials with the same error for unknown email", async () => {
    const wrong = await request(app).post("/api/auth/login").send({ email, password: "wrong password" }).expect(401);
    const unknown = await request(app).post("/api/auth/login")
      .send({ email: `missing-${email}`, password: "wrong password" }).expect(401);
    assert.equal(wrong.body.error.message, unknown.body.error.message);
    assert.equal(wrong.headers["www-authenticate"], "Bearer");
  });

  test("login and /me work across backend instances using the same Redis state", async () => {
    const response = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    accessToken = response.body.data.accessToken;
    const otherInstance = makeApp();
    const me = await request(otherInstance).get("/api/auth/me").auth(accessToken, { type: "bearer" }).expect(200);
    assert.equal(me.body.data.id, userId);
    assert.equal(me.body.data.passwordHash, undefined);
    await request(app).get("/api/auth/me").expect(401);
    await request(app).get("/api/auth/me").auth("invalid", { type: "bearer" }).expect(401);
  });

  test("activity has a TTL and ignores spoofed forwarded IP headers", async () => {
    const response = await request(app).get("/api/auth/activity")
      .auth(accessToken, { type: "bearer" })
      .set("X-Forwarded-For", "203.0.113.77").set("User-Agent", "PikaAI test device").expect(200);
    assert.notEqual(response.body.data.ip, "203.0.113.77");
    assert.equal(response.body.data.userAgent, "PikaAI test device");
    assert.ok(response.body.data.lastSeenAt);
    assert.ok(response.body.data.lastLoginAt);
    const ttl = await redis.ttl(`${prefix}auth:activity:${userId}`);
    assert.ok(ttl > 0 && ttl <= 60);
  });

  test("logout revokes only the current token across instances until its expiry", async () => {
    const anotherLogin = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    const secondToken: string = anotherLogin.body.data.accessToken;
    await request(app).post("/api/auth/logout").auth(accessToken, { type: "bearer" }).expect(204);
    await request(makeApp()).get("/api/auth/me").auth(accessToken, { type: "bearer" }).expect(401);
    await request(app).get("/api/auth/me").auth(secondToken, { type: "bearer" }).expect(200);
    const identity = await tokens.verify(accessToken);
    const ttl = await redis.ttl(`${prefix}auth:revoked:${identity.tokenId}`);
    assert.ok(ttl > 0 && ttl <= 900);
    accessToken = secondToken;
  });

  test("Redis-backed login limits are shared across instances", async () => {
    const sharedPrefix = `${prefix}limited:`;
    const first = makeApp(sharedPrefix, 2);
    const second = makeApp(sharedPrefix, 2);
    await request(first).post("/api/auth/login").send({ email, password: "wrong" }).expect(401);
    await request(second).post("/api/auth/login").send({ email, password: "wrong" }).expect(401);
    const limited = await request(first).post("/api/auth/login").send({ email, password }).expect(429);
    assert.ok(limited.headers["retry-after"]);
    await request(first).get("/health/live").expect(200);
  });

  test("Redis epoch loss invalidates existing tokens and a fresh login recovers", async () => {
    await redis.del(`${prefix}auth:epoch`);
    await request(app).get("/api/auth/me").auth(accessToken, { type: "bearer" }).expect(401);
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    await request(app).get("/api/auth/me").auth(login.body.data.accessToken, { type: "bearer" }).expect(200);
    accessToken = login.body.data.accessToken;
  });

  test("an offline Redis client fails closed and makes readiness unhealthy", async (t) => {
    t.mock.method(console, "error", () => {});
    const offline = redis.duplicate();
    await offline.connect();
    await offline.close();
    const appWithOfflineRedis = createApp({
      prisma, tokens, authState: new RedisAuthState(offline), logRequests: false,
    });
    const response = await request(appWithOfflineRedis).get("/api/auth/me")
      .auth(accessToken, { type: "bearer" }).expect(503);
    assert.equal(response.body.error.message, "Authentication service unavailable");
    const ready = await request(appWithOfflineRedis).get("/health/ready").expect(503);
    assert.equal(ready.body.redis, "unavailable");
    assert.equal(ready.body.database, "connected");
    await request(appWithOfflineRedis).get("/health/live").expect(200);
  });
});
