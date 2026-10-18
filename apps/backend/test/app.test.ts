import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import type { AppOptions } from "../src/app.js";

const timestamp = "2026-10-19T00:00:00.000Z";
function makeApp(overrides: Partial<AppOptions> = {}) {
  return createApp({
    database: { async query() { return { rows: [{ timestamp }] }; } },
    corsOrigins: ["http://localhost:3000"],
    logRequests: false,
    ...overrides,
  });
}

test("GET /api/test returns a working API response and security headers", async () => {
  const response = await request(makeApp()).get("/api/test").expect(200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.message, "PikaAI backend is running");
  assert.ok(response.headers["x-request-id"]);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-powered-by"], undefined);
});

test("POST /api/test/echo validates and trims a message", async () => {
  const response = await request(makeApp()).post("/api/test/echo")
    .send({ message: " hello " }).expect(200);
  assert.deepEqual(response.body, { success: true, data: { message: "hello" } });
});

test("echo rejects missing, blank, oversized, and non-string messages", async () => {
  for (const payload of [{}, { message: " " }, { message: "a".repeat(501) }, { message: 123 }]) {
    const response = await request(makeApp()).post("/api/test/echo").send(payload).expect(400);
    assert.equal(response.body.success, false);
    assert.ok(response.body.error.requestId);
  }
});

test("malformed JSON receives a readable 400", async () => {
  const response = await request(makeApp()).post("/api/test/echo")
    .set("Content-Type", "application/json").send('{"message":').expect(400);
  assert.equal(response.body.error.message, "Invalid JSON body");
});

test("bodies over 16 KB are rejected", async () => {
  const response = await request(makeApp()).post("/api/test/echo")
    .send({ message: "a".repeat(20_000) }).expect(413);
  assert.equal(response.body.error.message, "Request body too large");
});

test("allowed browser origins receive CORS headers and preflight succeeds", async () => {
  const app = makeApp();
  const response = await request(app).get("/api/test")
    .set("Origin", "http://localhost:3000").expect(200);
  assert.equal(response.headers["access-control-allow-origin"], "http://localhost:3000");
  await request(app).options("/api/test/echo")
    .set("Origin", "http://localhost:3000")
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "content-type").expect(204);
});

test("unlisted browser origins are rejected", async () => {
  const response = await request(makeApp()).get("/api/test")
    .set("Origin", "https://untrusted.example").expect(403);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
  assert.equal(response.body.error.message, "Origin is not allowed by CORS");
});

test("unknown routes return a consistent JSON 404", async () => {
  const response = await request(makeApp()).get("/missing").expect(404);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.message, "Route not found");
});

test("readiness succeeds with a connected database", async () => {
  const response = await request(makeApp()).get("/health/ready").expect(200);
  assert.deepEqual(response.body, { status: "ready", database: "connected" });
});

test("database test returns a timestamp", async () => {
  const response = await request(makeApp()).get("/api/test/db").expect(200);
  assert.equal(response.body.data.database, "connected");
  assert.equal(response.body.data.timestamp, timestamp);
});

test("database failure returns 503 while liveness remains healthy", async (t) => {
  t.mock.method(console, "error", () => {});
  const app = makeApp({ database: { async query() { throw new Error("private connection details"); } } });
  const ready = await request(app).get("/health/ready").expect(503);
  assert.equal(ready.body.status, "not_ready");
  const database = await request(app).get("/api/test/db").expect(503);
  assert.equal(database.body.error.message, "Database unavailable");
  assert.ok(!database.text.includes("private connection details"));
  await request(app).get("/health/live").expect(200);
});

test("API rate limiting returns 429 without blocking health probes", async () => {
  const app = makeApp({ rateLimitMax: 1 });
  await request(app).get("/api/test").expect(200);
  const response = await request(app).get("/api/test").expect(429);
  assert.equal(response.body.success, false);
  assert.ok(response.headers["retry-after"]);
  await request(app).get("/health/live").expect(200);
});
