import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { SignJWT } from "jose";
import { hashPassword, verifyPassword } from "../src/services/password.service.js";
import { TokenService } from "../src/services/token.service.js";
import { HttpError } from "../src/utils/http-error.js";
import { documentSchema, parse, registerSchema } from "../src/validators/request.js";

const secret = "ab".repeat(32);
const tokens = new TokenService(secret);

test("passwords use independent salts and correct-password verification", async () => {
  const password = "a long password with spaces and 🔐";
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.ok(!first.includes(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(password.trimEnd() + "!", first), false);
  assert.equal(await verifyPassword(password, "malformed hash"), false);
});

test("signed JWT verifies identity, token ID, epoch, and expiry", async () => {
  const userId = randomUUID();
  const epoch = randomUUID();
  const issued = await tokens.issue(userId, epoch);
  const identity = await tokens.verify(issued.accessToken);
  assert.equal(identity.userId, userId);
  assert.equal(identity.epoch, epoch);
  assert.equal(issued.expiresIn, 900);
  assert.ok(identity.tokenId);
  assert.ok(identity.expiresAt > Date.now() / 1000);
});

test("JWT verification rejects tampering and a different signing key", async () => {
  const issued = await tokens.issue(randomUUID(), randomUUID());
  await assert.rejects(new TokenService("cd".repeat(32)).verify(issued.accessToken), { status: 401 });
  await assert.rejects(tokens.verify(issued.accessToken + "tampered"), { status: 401 });
  await assert.rejects(tokens.verify("not-a-token"), { status: 401 });
});

test("JWT rejects expired, wrong-audience, wrong-issuer, and incomplete claims", async () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: randomUUID(), jti: randomUUID(), epoch: randomUUID(),
    iss: "pikaai", aud: "pikaai-api", iat: now, exp: now + 900,
  };
  for (const override of [{ exp: now - 10 }, { aud: "different" }, { iss: "different" }, { jti: undefined }]) {
    const signed = await new SignJWT({ ...claims, ...override })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" }).sign(Buffer.from(secret, "hex"));
    await assert.rejects(tokens.verify(signed), { status: 401 });
  }
});

test("JWT rejects other algorithms and excessively long lifetimes", async () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: randomUUID(), jti: randomUUID(), epoch: randomUUID(), iss: "pikaai", aud: "pikaai-api", iat: now, exp: now + 9999 };
  const longLived = await new SignJWT(claims).setProtectedHeader({ alg: "HS256", typ: "JWT" }).sign(Buffer.from(secret, "hex"));
  await assert.rejects(tokens.verify(longLived), { status: 401 });
  const wrongAlgorithm = await new SignJWT(claims).setProtectedHeader({ alg: "HS512", typ: "JWT" }).sign(Buffer.alloc(64));
  await assert.rejects(tokens.verify(wrongAlgorithm), { status: 401 });
});

test("registration normalizes email without changing the password", () => {
  const password = "  correct horse battery staple  ";
  const input = parse(registerSchema, { name: " Alice ", email: " ALICE@example.com ", password });
  assert.equal(input.name, "Alice");
  assert.equal(input.email, "alice@example.com");
  assert.equal(input.password, password);
  assert.throws(() => parse(registerSchema, { ...input, role: "owner" }), HttpError);
  assert.throws(() => parse(registerSchema, { ...input, password: "too-short" }), HttpError);
});

test("document validation preserves content and rejects empty and oversized input", () => {
  const content = "  plain text for later RAG\n";
  assert.deepEqual(parse(documentSchema, { title: " Note ", content }), { title: "Note", content });
  for (const invalid of ["", "  \n ", "a".repeat(100001)]) {
    assert.throws(() => parse(documentSchema, { title: "Note", content: invalid }), HttpError);
  }
});
