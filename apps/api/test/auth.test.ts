import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { SMTPServer } from "smtp-server";
import type { AuthTokens, AuthUser } from "../src/modules/auth/auth.types.js";

const email = "auth-test-" + randomUUID() + "@example.com";
const raceEmail = "auth-race-" + randomUUID() + "@example.com";
const otpEmail = "auth-otp-" + randomUUID() + "@example.com";
const redisPrefix = "pikaai:test:" + randomUUID() + ":";
const password = "Test-password-42!";
let server: import("node:http").Server;
let baseUrl: string;
let prisma: typeof import("../src/configs/db.js").prisma;
let redis: typeof import("../src/configs/redis.js").redis;
let env: typeof import("../src/configs/env.js").env;
const messages = new Map<string, string[]>();
let rejectMail = false;
const smtp = new SMTPServer({
  disabledCommands: ["STARTTLS"],
  allowInsecureAuth: true,
  onAuth(auth, _session, callback) {
    if (auth.username !== "test-user" || auth.password !== "test-password") {
      callback(new Error("Invalid SMTP credentials"));
      return;
    }
    callback(null, { user: "test-user" });
  },
  onData(stream, session, callback) {
    let message = "";
    stream.on("data", chunk => { message += chunk.toString(); });
    stream.on("end", () => {
      if (rejectMail) return callback(new Error("Test SMTP rejection"));
      for (const recipient of session.envelope.rcptTo) {
        const received = messages.get(recipient.address) ?? [];
        received.push(message);
        messages.set(recipient.address, received);
      }
      callback();
    });
  },
});

before(async () => {
  smtp.listen(0, "127.0.0.1");
  await once(smtp.server, "listening");
  const smtpAddress = smtp.server.address();
  assert.ok(smtpAddress && typeof smtpAddress === "object");
  // Configure before importing the app so tests cannot send external email or
  // touch rate-limit keys belonging to a running development server.
  Object.assign(process.env, {
    NODE_ENV: "test",
    REDIS_KEY_PREFIX: redisPrefix,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(smtpAddress.port),
    SMTP_SECURE: "false",
    SMTP_USER: "test-user",
    SMTP_PASS: "test-password",
    SMTP_FROM: "PikaAI <test@example.com>",
  });
  const { app } = await import("../src/app.js");
  ({ prisma } = await import("../src/configs/db.js"));
  ({ redis } = await import("../src/configs/redis.js"));
  ({ env } = await import("../src/configs/env.js"));
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
    if (prisma) await prisma.user.deleteMany({ where: { email: { in: [email, raceEmail, otpEmail] } } });
  } finally {
    if (prisma) await prisma.$disconnect();
    if (redis?.isReady) {
      for await (const keys of redis.scanIterator({ MATCH: redisPrefix + "*", COUNT: 100 })) {
        if (keys.length) await redis.del(keys);
      }
      redis.destroy();
    }
    await new Promise<void>(resolve => smtp.close(resolve));
  }
});

function rateKey(name: string): string {
  return redisPrefix + "rate:" + name + ":127.0.0.1";
}

function otpKey(address: string): string {
  return redisPrefix + "otp:" + createHash("sha256").update(address).digest("hex");
}

async function resetLimits(): Promise<void> {
  await redis.del([rateKey("otp"), rateKey("register"), rateKey("login")]);
}

async function requestOtp(address: string): Promise<string> {
  const response = await post("send-otp", { email: "  " + address.toUpperCase() + "  " });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { message: "OTP sent to your email" });
  assert.deepEqual(response.headers.getSetCookie(), []);
  const message = messages.get(address)?.at(-1);
  assert.ok(message);
  const otp = /registration code is (\d{6})\./.exec(message)?.[1];
  assert.ok(otp, "SMTP should receive the six-digit code");
  return otp;
}

async function getTokens(response: Response): Promise<AuthTokens> {
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

test("OTP registration and JWT authentication against PostgreSQL, Redis, and SMTP", async t => {
  t.beforeEach(resetLimits);
  let user: AuthUser;
  let registered: AuthTokens;
  let active: AuthTokens;

  await t.test("validates credentials, including bcrypt's UTF-8 byte limit", async () => {
    for (const body of [undefined, {}, { email: "invalid", password },
      { email, password: "short" }, { email, password: "x".repeat(73) },
      { email, password: "🔒".repeat(19) }, { email, password: 12345678 }]) {
      await resetLimits();
      assert.equal((await post("register", body)).status, 400);
    }
  });

  await t.test("registers only USER with a 24-hour access token and 7-day HTTP-only refresh cookie", async () => {
    const otp = await requestOtp(email);
    assert.equal(await prisma.user.findUnique({ where: { email } }), null);
    const storedOtp = await redis.get(otpKey(email));
    assert.ok(storedOtp);
    assert.equal(JSON.parse(storedOtp).hash.length, 64);
    assert.ok(!storedOtp.includes(otp));
    assert.ok((await redis.ttl(otpKey(email))) > 290);
    const response = await post("register", { email: "  " + email.toUpperCase() + "  ", password, otp, role: "ADMIN" });
    assert.equal(response.status, 201);
    assert.equal(await redis.get(otpKey(email)), null);
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
    assert.equal((await post("register", { email: email.toUpperCase(), password, otp: "123456" })).status, 409);
    assert.equal((await post("send-otp", { email })).status, 409);
    const otp = await requestOtp(raceEmail);
    const responses = await Promise.all([
      post("register", { email: raceEmail, password, otp }),
      post("register", { email: raceEmail.toUpperCase(), password, otp }),
    ]);
    assert.equal(responses.filter(response => response.status === 201).length, 1);
    assert.ok(responses.some(response => response.status === 400 || response.status === 409));
    assert.equal(await redis.get(otpKey(raceEmail)), null);
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
    for (const route of ["send-otp", "register", "login", "refresh", "logout"]) {
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

  await t.test("requires a six-digit string OTP and never creates an unverified account", async () => {
    for (const otp of [undefined, 123456, "123", "abcdef", "000000"]) {
      const response = await post("register", { email: otpEmail, password, otp });
      assert.equal(response.status, 400);
      assert.deepEqual(response.headers.getSetCookie(), []);
    }
    assert.equal(await prisma.user.findUnique({ where: { email: otpEmail } }), null);
  });

  await t.test("binds OTPs to the recipient and rejects expired codes", async () => {
    const otp = await requestOtp(otpEmail);
    assert.equal((await post("register", { email: "other-" + otpEmail, password, otp })).status, 400);
    await redis.expire(otpKey(otpEmail), 0);
    assert.equal((await post("register", { email: otpEmail, password, otp })).status, 400);
    assert.equal(await prisma.user.findUnique({ where: { email: otpEmail } }), null);
  });

  await t.test("invalidates a code after five incorrect guesses without extending its lifetime", async () => {
    const otp = await requestOtp(otpEmail);
    const ttl = await redis.pTTL(otpKey(otpEmail));
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal((await post("register", { email: otpEmail, password, otp: "000000" })).status, 400);
      if (attempt < 4) assert.ok((await redis.pTTL(otpKey(otpEmail))) <= ttl);
    }
    assert.equal(await redis.get(otpKey(otpEmail)), null);
    await resetLimits();
    assert.equal((await post("register", { email: otpEmail, password, otp })).status, 400);
  });

  await t.test("returns 503 on SMTP rejection, removes the code, and allows a later resend", async () => {
    rejectMail = true;
    try {
      const response = await post("send-otp", { email: otpEmail });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "Unable to send OTP. Please try again later" });
      assert.equal(await redis.get(otpKey(otpEmail)), null);
      assert.equal(await prisma.user.findUnique({ where: { email: otpEmail } }), null);
    } finally {
      rejectMail = false;
    }
    await requestOtp(otpEmail);
  });

  await t.test("sends at most three OTPs per IP and resumes when the Redis window expires", async () => {
    const received = messages.get(otpEmail)?.length ?? 0;
    for (let attempt = 0; attempt < 3; attempt++) await requestOtp(otpEmail);
    const blocked = await post("send-otp", { email: "other-" + otpEmail });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
    assert.match(blocked.headers.get("RateLimit")!, /limit=3/);
    assert.equal(messages.get(otpEmail)!.length, received + 3);
    assert.ok((await redis.pTTL(rateKey("otp"))) > 50000);
    assert.ok((await redis.pTTL(rateKey("otp"))) <= 60000);
    // Advance Redis expiry instead of making the test sleep for a full minute.
    await redis.pExpire(rateKey("otp"), 1);
    await new Promise(resolve => setTimeout(resolve, 20));
    await requestOtp(otpEmail);
  });

  await t.test("limits concurrent registrations to five per IP despite spoofed forwarding headers", async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      fetch(baseUrl + "/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100." + (index + 1) },
        body: JSON.stringify({ email: otpEmail, password }),
      }),
    ));
    assert.deepEqual(responses.map(response => response.status).sort(), [400, 400, 400, 400, 400, 429]);
    const blocked = responses.find(response => response.status === 429)!;
    assert.match(blocked.headers.get("RateLimit")!, /limit=5/);
    assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
    assert.deepEqual(blocked.headers.getSetCookie(), []);
    await requestOtp(otpEmail); // OTP and registration have independent counters.
  });

  await t.test("counts only failed logins, blocks after five, and allows login after expiry", async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await post("login", { email, password });
      assert.equal(response.status, 200);
      await response.json();
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      assert.equal((await post("login", { email, password: "short" })).status, 400);
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const address = attempt % 2 ? "missing-" + email : email;
      const response = await post("login", { email: address, password: "wrong-password" });
      assert.equal(response.status, 401);
    }
    assert.equal(await redis.get(rateKey("login")), "5");
    const blocked = await post("login", { email, password: "wrong-password" });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
    assert.deepEqual(blocked.headers.getSetCookie(), []);
    assert.equal((await post("login", { email, password })).status, 429);
    await redis.pExpire(rateKey("login"), 1);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((await post("login", { email, password })).status, 200);
  });

  await t.test("a resend replaces the previous OTP and only the current code can register", async () => {
    const old = await requestOtp(otpEmail);
    const current = await requestOtp(otpEmail);
    // Random codes can occasionally match; replacement still has a new TTL.
    if (old !== current) {
      assert.equal((await post("register", { email: otpEmail, password, otp: old })).status, 400);
    }
    assert.equal((await post("register", { email: otpEmail, password, otp: current })).status, 201);
    assert.equal(await redis.get(otpKey(otpEmail)), null);
    assert.equal(await prisma.user.count({ where: { email: otpEmail } }), 1);
  });
});
