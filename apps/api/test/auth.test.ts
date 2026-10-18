import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";
import { prisma } from "../src/configs/db.js";
import { env } from "../src/configs/env.js";

const email = "auth-test-" + randomUUID() + "@example.com";
const raceEmail = "auth-race-" + randomUUID() + "@example.com";
const password = "Test-password-42!";
let server: ReturnType<typeof app.listen>;
let baseUrl: string;

before(async () => {
  await prisma.$queryRaw`SELECT 1`;
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = "http://127.0.0.1:" + address.port;
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  try {
    await prisma.user.deleteMany({ where: { email: { in: [email, raceEmail] } } });
  } finally {
    await prisma.$disconnect();
  }
});

type Tokens = { accessToken: string; refreshToken: string };

async function getTokens(response: Response): Promise<Tokens> {
  const body = await response.clone().json();
  const values = Object.fromEntries(response.headers.getSetCookie().map(header => {
    const cookie = header.split(";")[0]!;
    const separator = cookie.indexOf("=");
    return [cookie.slice(0, separator), decodeURIComponent(cookie.slice(separator + 1))];
  }));
  assert.equal(typeof body.accessToken, "string");
  assert.equal(values.accessToken, undefined);
  assert.equal(typeof values.refreshToken, "string");
  assert.equal(body.refreshToken, undefined);
  return { accessToken: body.accessToken, refreshToken: values.refreshToken! };
}

function post(path: string, body?: unknown, cookie?: string, origin?: string) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  return fetch(baseUrl + "/auth/" + path, {
    method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function me(accessToken?: string) {
  return fetch(baseUrl + "/auth/me", {
    headers: accessToken ? { Authorization: "Bearer " + accessToken } : {},
  });
}

test("Bearer JWT authentication with refresh cookies against PostgreSQL", async t => {
  let user: { user_id: string; email: string; role: string };
  let registered: Tokens;
  let active: Tokens;

  await t.test("validates credentials, including bcrypt's UTF-8 byte limit", async () => {
    for (const body of [undefined, {}, { email: "invalid", password },
      { email, password: "short" }, { email, password: "x".repeat(73) },
      { email, password: "🔒".repeat(19) }, { email, password: 12345678 }]) {
      assert.equal((await post("register", body)).status, 400);
    }
  });

  await t.test("registers only USER with a 24-hour access token and 7-day HTTP-only refresh cookie", async () => {
    const response = await post("register", { email: "  " + email.toUpperCase() + "  ", password, role: "ADMIN" });
    assert.equal(response.status, 201);
    registered = active = await getTokens(response);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ["accessToken", "user"]);
    user = body.user;
    assert.deepEqual(Object.keys(user).sort(), ["email", "role", "user_id"]);
    assert.equal(user.email, email);
    assert.equal(user.role, "USER");
    for (const header of response.headers.getSetCookie()) {
      assert.match(header, /HttpOnly/);
      assert.match(header, /SameSite=Lax/);
      assert.match(header, /Path=\//);
    }
    assert.match(response.headers.getSetCookie().find(value => value.startsWith("refreshToken="))!, /Max-Age=604800;/);
    for (const [type, token, secret, seconds] of [
      ["access", active.accessToken, env.accessSecret, 86400],
      ["refresh", active.refreshToken, env.refreshSecret, 604800],
    ] as const) {
      const payload = jwt.verify(token, secret, { algorithms: ["HS256"], issuer: "pikaai", audience: "pikaai:" + type });
      assert.ok(typeof payload === "object");
      assert.equal(payload.sub, user.user_id);
      assert.equal(payload.role, "USER");
      assert.equal(payload.exp! - payload.iat!, seconds);
    }
  });

  await t.test("stores bcrypt password hashes and only a hash of the refresh token", async () => {
    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    assert.match(stored.password_hash, /^\$2[ab]\$12\$/);
    assert.equal(await bcrypt.compare(password, stored.password_hash), true);
    assert.notEqual(stored.refreshToken, active.refreshToken);
    assert.equal(stored.refreshToken, createHash("sha256").update(active.refreshToken).digest("hex"));
  });

  await t.test("rejects duplicate emails, including concurrent registrations", async () => {
    assert.equal((await post("register", { email: email.toUpperCase(), password })).status, 409);
    const responses = await Promise.all([
      post("register", { email: raceEmail, password }),
      post("register", { email: raceEmail.toUpperCase(), password }),
    ]);
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  });

  await t.test("authenticates from Authorization and rejects missing or malformed headers and cookie-only access", async () => {
    assert.equal((await me()).status, 401);
    const response = await me(active.accessToken);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { user });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    for (const authorization of ["Basic " + active.accessToken, "Bearer", "Bearer " + active.accessToken + " extra"]) {
      assert.equal((await fetch(baseUrl + "/auth/me", { headers: { Authorization: authorization } })).status, 401);
    }
    assert.equal((await fetch(baseUrl + "/auth/me", { headers: { Cookie: "accessToken=" + active.accessToken } })).status, 401);
  });

  await t.test("rejects tampering, expiration, wrong algorithms, wrong token types, and missing expiration", async () => {
    const payload = { email, role: "USER", type: "access" };
    const options = { subject: user.user_id, issuer: "pikaai", audience: "pikaai:access" };
    const tokens = [
      active.accessToken + "tampered",
      active.refreshToken,
      jwt.sign(payload, env.accessSecret, { ...options, expiresIn: -1 }),
      jwt.sign(payload, env.accessSecret, { ...options, expiresIn: "24h", algorithm: "HS384" }),
      jwt.sign(payload, env.accessSecret, options),
      jwt.sign({ ...payload, role: "SUPERADMIN" }, env.accessSecret, { ...options, expiresIn: "24h" }),
    ];
    for (const token of tokens) assert.equal((await me(token)).status, 401);
    assert.equal((await post("refresh", undefined, "refreshToken=" + active.accessToken)).status, 401);
    assert.equal((await post("refresh")).status, 401);
  });

  await t.test("returns generic errors for wrong credentials and rejects malformed JSON", async () => {
    for (const credentials of [{ email, password: "wrong-password" }, { email: "missing-" + email, password }]) {
      const response = await post("login", credentials);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "Invalid email or password" });
      assert.deepEqual(response.headers.getSetCookie(), []);
    }
    const response = await fetch(baseUrl + "/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
    });
    assert.equal(response.status, 400);
  });

  await t.test("rejects cross-origin state changes", async () => {
    for (const route of ["register", "login", "refresh", "logout"]) {
      assert.equal((await post(route, { email, password }, "refreshToken=" + active.refreshToken, "https://evil.example")).status, 403);
    }
    const response = await fetch(baseUrl + "/auth/logout", {
      method: "POST", headers: { "Sec-Fetch-Site": "cross-site", Cookie: "refreshToken=" + active.refreshToken },
    });
    assert.equal(response.status, 403);
  });

  await t.test("login replaces the previous refresh token and allows credentialed CORS", async () => {
    const response = await post("login", { email: email.toUpperCase(), password }, undefined, env.corsOrigin);
    assert.equal(response.status, 200);
    active = await getTokens(response);
    assert.deepEqual(await response.json(), { user, accessToken: active.accessToken });
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), env.corsOrigin);
    assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
    assert.notEqual(active.refreshToken, registered.refreshToken);
    assert.equal((await post("refresh", undefined, "refreshToken=" + registered.refreshToken)).status, 401);
  });

  await t.test("refresh rotates tokens and rejects replay", async () => {
    const old = active;
    const response = await post("refresh", undefined, "refreshToken=" + old.refreshToken);
    assert.equal(response.status, 200);
    active = await getTokens(response);
    assert.deepEqual(await response.json(), { user, accessToken: active.accessToken });
    assert.notEqual(active.refreshToken, old.refreshToken);
    assert.notEqual(active.accessToken, old.accessToken);
    assert.equal((await post("refresh", undefined, "refreshToken=" + old.refreshToken)).status, 401);
  });

  await t.test("only one concurrent refresh succeeds", async () => {
    const responses = await Promise.all([
      post("refresh", undefined, "refreshToken=" + active.refreshToken),
      post("refresh", undefined, "refreshToken=" + active.refreshToken),
    ]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 401]);
    active = await getTokens(responses.find(response => response.status === 200)!);
    assert.deepEqual(responses.find(response => response.status === 401)!.headers.getSetCookie(), []);
  });

  await t.test("a stale logout cannot revoke the current refresh token", async () => {
    assert.equal((await post("logout", undefined, "refreshToken=" + registered.refreshToken)).status, 204);
    const response = await post("refresh", undefined, "refreshToken=" + active.refreshToken);
    assert.equal(response.status, 200);
    active = await getTokens(response);
  });

  await t.test("refresh uses the current database role", async () => {
    await prisma.user.update({ where: { email }, data: { role: "ADMIN" } });
    const response = await post("refresh", undefined, "refreshToken=" + active.refreshToken);
    assert.equal(response.status, 200);
    active = await getTokens(response);
    user = { ...user, role: "ADMIN" };
    assert.deepEqual(await response.json(), { user, accessToken: active.accessToken });
    assert.deepEqual(await (await me(active.accessToken)).json(), { user });
  });

  await t.test("logout clears the refresh cookie and revokes refresh, while access remains stateless", async () => {
    const response = await post("logout", undefined, "refreshToken=" + active.refreshToken);
    assert.equal(response.status, 204);
    assert.equal(response.headers.getSetCookie().length, 1);
    for (const header of response.headers.getSetCookie()) assert.match(header, /Expires=Thu, 01 Jan 1970/);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { email } })).refreshToken, null);
    assert.equal((await post("refresh", undefined, "refreshToken=" + active.refreshToken)).status, 401);
    assert.equal((await me(active.accessToken)).status, 200);
    assert.equal((await post("logout")).status, 204);
    assert.equal((await post("logout", undefined, "refreshToken=invalid")).status, 204);
  });
});
