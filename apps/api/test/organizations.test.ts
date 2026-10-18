import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { app } from "../src/app.js";
import { prisma } from "../src/configs/db.js";
import { redis } from "../src/configs/redis.js";
import { createTokens } from "../src/utils/jwt.js";
import type { AuthUser } from "../src/modules/auth/auth.types.js";
import type { CreateOrganizationResponse } from "../src/modules/organizations/organization.types.js";

const prefix = "org-test-" + randomUUID() + "-";
const actors: AuthUser[] = Array.from({ length: 6 }, (_, index) => ({
  user_id: randomUUID(), email: prefix + index + "@example.com", role: index === 2 ? "ADMIN" : "USER",
}));
const [creator, member, outsider, otherAdmin, delegate, racer] = actors as [AuthUser, AuthUser, AuthUser, AuthUser, AuthUser, AuthUser];
const accessTokens = new Map(actors.map(actor => [actor.user_id, createTokens(actor).accessToken]));
let server: ReturnType<typeof app.listen>;
let baseUrl: string;

before(async () => {
  await prisma.user.createMany({
    data: actors.map(actor => ({ ...actor, password_hash: "unused-test-password-hash" })),
  });
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = "http://127.0.0.1:" + address.port;
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  try {
    await prisma.organization.deleteMany({ where: { name: { startsWith: prefix } } });
    await prisma.user.deleteMany({ where: { user_id: { in: actors.map(actor => actor.user_id) } } });
  } finally {
    await prisma.$disconnect();
    if (redis.isOpen) redis.destroy();
  }
});

function request(method: string, path: string, actor?: AuthUser, body?: unknown) {
  const headers: Record<string, string> = {};
  if (actor) headers.Authorization = "Bearer " + accessTokens.get(actor.user_id);
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(baseUrl + "/organizations" + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(response: Response, status: number) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

test("Organization creation, invite joins, approval, and admin permissions against PostgreSQL", async t => {
  let open: CreateOrganizationResponse;
  let approval: CreateOrganizationResponse;

  await t.test("requires Bearer authentication on every organization endpoint", async () => {
    const id = randomUUID();
    for (const [method, path] of [
      ["POST", ""], ["POST", "/join"], ["GET", `/${id}/invite-code`], ["GET", `/${id}/members`],
      ["POST", `/${id}/join-requests/${id}/approve`], ["POST", `/${id}/members/${id}/admin`],
    ]) {
      assert.equal((await request(method!, path!)).status, 401);
    }
  });

  await t.test("validates organization name and join policy without adding a rate limit", async () => {
    for (const body of [undefined, {}, { name: 123, joinPolicy: "OPEN" },
      { name: "   ", joinPolicy: "OPEN" }, { name: "x".repeat(101), joinPolicy: "OPEN" },
      { name: prefix }, { name: prefix, joinPolicy: "invalid" }]) {
      const response = await request("POST", "", creator, body);
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("RateLimit"), null);
    }
  });

  await t.test("creates an open organization and atomically makes its creator an active admin", async () => {
    open = await json(await request("POST", "", creator, {
      name: "  " + prefix + "open  ", joinPolicy: "OPEN", inviteCode: "client-code", role: "MEMBER",
    }), 201);
    assert.equal(open.organization.name, prefix + "open");
    assert.equal(open.organization.join_policy, "OPEN");
    assert.match(open.inviteCode, /^[\da-f]{32}$/);
    assert.deepEqual(Object.keys(open.organization).sort(), ["created_at", "join_policy", "name", "organization_id"]);
    const stored = await prisma.organizationMembership.findUniqueOrThrow({
      where: { organization_id_user_id: { organization_id: open.organization.organization_id, user_id: creator.user_id } },
    });
    assert.equal(stored.role, "ADMIN");
    assert.equal(stored.status, "ACTIVE");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { user_id: creator.user_id } })).role, "USER");
  });

  await t.test("creates an organization requiring admin approval", async () => {
    approval = await json(await request("POST", "", otherAdmin, {
      name: prefix + "approval", joinPolicy: "APPROVAL_REQUIRED",
    }), 201);
    assert.equal(approval.organization.join_policy, "APPROVAL_REQUIRED");
    assert.notEqual(approval.inviteCode, open.inviteCode);
  });

  await t.test("joins an open organization immediately and ignores role/status overrides", async () => {
    const body = await json(await request("POST", "/join", member, {
      inviteCode: "  " + open.inviteCode.toUpperCase() + "  ", role: "ADMIN", status: "PENDING",
    }), 201);
    assert.equal(body.membership.status, "ACTIVE");
    assert.equal(body.membership.role, "MEMBER");
    assert.equal(body.membership.user_id, member.user_id);
    assert.equal(body.organization.organization_id, open.organization.organization_id);
    assert.equal(body.inviteCode, undefined);
    assert.equal(body.organization.invite_code, undefined);
    const duplicate = await json(await request("POST", "/join", member, { inviteCode: open.inviteCode }), 409);
    assert.equal(duplicate.error, "Already joined or requested to join this organization");
  });

  await t.test("approval-only joins stay pending and cannot be promoted or approve themselves", async () => {
    const id = approval.organization.organization_id;
    const body = await json(await request("POST", "/join", member, {
      inviteCode: approval.inviteCode, role: "ADMIN", status: "ACTIVE",
    }), 201);
    assert.equal(body.membership.status, "PENDING");
    assert.equal(body.membership.role, "MEMBER");
    assert.equal((await request("POST", "/join", member, { inviteCode: approval.inviteCode })).status, 409);
    assert.equal((await request("POST", `/${id}/join-requests/${member.user_id}/approve`, member)).status, 403);
    assert.equal((await request("POST", `/${id}/members/${member.user_id}/admin`, otherAdmin)).status, 404);
    assert.equal((await request("GET", `/${id}/invite-code`, member)).status, 403);
  });

  await t.test("only the same organization's active admins can read invite codes and members", async () => {
    const id = open.organization.organization_id;
    const code = await json(await request("GET", `/${id}/invite-code`, creator), 200);
    assert.deepEqual(code, { inviteCode: open.inviteCode });
    const body = await json(await request("GET", `/${id}/members`, creator), 200);
    assert.equal(body.members.length, 2);
    assert.ok(body.members.some((entry: { user_id: string }) => entry.user_id === member.user_id));
    for (const entry of body.members) assert.deepEqual(Object.keys(entry.user), ["email"]);
    for (const actor of [member, outsider, otherAdmin]) {
      assert.equal((await request("GET", `/${id}/invite-code`, actor)).status, 403);
      assert.equal((await request("GET", `/${id}/members`, actor)).status, 403);
    }
    const pending = await json(await request("GET", `/${approval.organization.organization_id}/members`, otherAdmin), 200);
    assert.ok(pending.members.some((entry: { user_id: string; status: string }) =>
      entry.user_id === member.user_id && entry.status === "PENDING"));
  });

  await t.test("blocks approvals and admin grants from members, global admins, and other organization admins", async () => {
    const id = approval.organization.organization_id;
    for (const actor of [member, outsider, creator]) {
      assert.equal((await request("POST", `/${id}/join-requests/${member.user_id}/approve`, actor)).status, 403);
      assert.equal((await request("POST", `/${id}/members/${member.user_id}/admin`, actor)).status, 403);
    }
    assert.equal((await request("POST", `/${open.organization.organization_id}/members/${member.user_id}/admin`, member)).status, 403);
  });

  await t.test("an admin approves a pending request exactly once", async () => {
    const id = approval.organization.organization_id;
    const body = await json(await request("POST", `/${id}/join-requests/${member.user_id}/approve`, otherAdmin), 200);
    assert.equal(body.membership.status, "ACTIVE");
    assert.equal(body.membership.role, "MEMBER");
    assert.equal((await request("POST", `/${id}/join-requests/${member.user_id}/approve`, otherAdmin)).status, 404);
    assert.equal((await request("GET", `/${id}/invite-code`, member)).status, 403);
  });

  await t.test("admin grants apply immediately and remain scoped to their organization", async () => {
    const id = open.organization.organization_id;
    const promoted = await json(await request("POST", `/${id}/members/${member.user_id}/admin`, creator), 200);
    assert.equal(promoted.membership.role, "ADMIN");
    assert.equal(promoted.membership.status, "ACTIVE");
    assert.equal((await request("GET", `/${id}/invite-code`, member)).status, 200);
    assert.equal((await request("GET", `/${approval.organization.organization_id}/invite-code`, member)).status, 403);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { user_id: member.user_id } })).role, "USER");
    await json(await request("POST", "/join", delegate, { inviteCode: open.inviteCode }), 201);
    assert.equal((await request("POST", `/${id}/members/${delegate.user_id}/admin`, member)).status, 200);
    assert.equal((await request("GET", `/${id}/invite-code`, delegate)).status, 200);
  });

  await t.test("returns 404 for approval or promotion targets who have not joined", async () => {
    const id = open.organization.organization_id;
    assert.equal((await request("POST", `/${id}/members/${outsider.user_id}/admin`, creator)).status, 404);
    assert.equal((await request("POST", `/${id}/join-requests/${outsider.user_id}/approve`, creator)).status, 404);
  });

  await t.test("validates invite codes and route IDs, and rejects unknown codes", async () => {
    for (const inviteCode of [undefined, 123, "", "short", "z".repeat(32)]) {
      assert.equal((await request("POST", "/join", outsider, { inviteCode })).status, 400);
    }
    assert.equal((await request("POST", "/join", outsider, { inviteCode: "0".repeat(32) })).status, 404);
    assert.equal((await request("GET", "/invalid/invite-code", creator)).status, 400);
    assert.equal((await request("GET", "/invalid/members", creator)).status, 400);
    const id = open.organization.organization_id;
    assert.equal((await request("POST", `/${id}/join-requests/invalid/approve`, creator)).status, 400);
    assert.equal((await request("POST", `/${id}/members/invalid/admin`, creator)).status, 400);
  });

  await t.test("concurrent joins create only one membership", async () => {
    const responses = await Promise.all([
      request("POST", "/join", racer, { inviteCode: open.inviteCode }),
      request("POST", "/join", racer, { inviteCode: open.inviteCode }),
    ]);
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
    assert.equal(await prisma.organizationMembership.count({
      where: { organization_id: open.organization.organization_id, user_id: racer.user_id },
    }), 1);
  });

  await t.test("concurrent pending joins and approvals cannot create duplicate or bypassed membership", async () => {
    const id = approval.organization.organization_id;
    const joins = await Promise.all([
      request("POST", "/join", racer, { inviteCode: approval.inviteCode }),
      request("POST", "/join", racer, { inviteCode: approval.inviteCode }),
    ]);
    assert.deepEqual(joins.map(response => response.status).sort(), [201, 409]);
    const joined = await json(joins.find(response => response.status === 201)!, 201);
    assert.equal(joined.membership.status, "PENDING");
    const approvals = await Promise.all([
      request("POST", `/${id}/join-requests/${racer.user_id}/approve`, otherAdmin),
      request("POST", `/${id}/join-requests/${racer.user_id}/approve`, otherAdmin),
    ]);
    assert.deepEqual(approvals.map(response => response.status).sort(), [200, 404]);
    const stored = await prisma.organizationMembership.findUniqueOrThrow({
      where: { organization_id_user_id: { organization_id: id, user_id: racer.user_id } },
    });
    assert.equal(stored.status, "ACTIVE");
    assert.equal(stored.role, "MEMBER");
  });
});
