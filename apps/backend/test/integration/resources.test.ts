import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { env } from "../../src/config/env.js";
import { TokenService } from "../../src/services/token.service.js";
import { RedisAuthState } from "../../src/services/redis-auth-state.service.js";

const runId = randomUUID();
const prefix = `pikaai:test:${runId}:`;
const emails = ["owner", "outsider", "member"].map((role) => `${role}-${runId}@integration.pikaai.test`);
const state = new RedisAuthState(redis, 60, `${prefix}auth:`);
const app = createApp({
  prisma, tokens: new TokenService(env.jwtSecret), authState: state,
  logRequests: false, rateLimitMax: 1000, authRateLimitMax: 100,
});
const users: { id: string; token: string }[] = [];
let organizationId: string;
let workspaceId: string;
let documentId: string;
const owner = () => users[0]!;
const outsider = () => users[1]!;
const member = () => users[2]!;
const content = "  Source content for future retrieval.\n";

describe("tenant resources with local Prisma/PostgreSQL and Redis", { concurrency: false }, () => {
  before(async () => {
    await prisma.$connect();
    await redis.connect();
    for (const email of emails) {
      const response = await request(app).post("/api/auth/register")
        .send({ name: "Integration user", email, password: "correct horse battery staple" }).expect(201);
      users.push({ id: response.body.data.user.id, token: response.body.data.accessToken });
    }
  });
  after(async () => {
    try {
      // Delete only this run's fixtures; no table truncation or Redis flush.
      await prisma.$transaction(async (tx) => {
        const fixtureUsers = await tx.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
        await tx.organization.deleteMany({ where: { createdBy: { in: fixtureUsers.map((user) => user.id) } } });
        await tx.user.deleteMany({ where: { email: { in: emails } } });
      });
      for await (const keys of redis.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
        if (keys.length) await redis.del(keys);
      }
    } finally {
      await prisma.$disconnect();
      if (redis.isOpen) await redis.close();
    }
  });

  test("all organization, workspace, and document endpoints require authentication", async () => {
    const id = randomUUID();
    for (const url of ["/api/organizations", `/api/organizations/${id}`, `/api/organizations/${id}/workspaces`,
      `/api/workspaces/${id}`, `/api/workspaces/${id}/documents`, `/api/documents/${id}`]) {
      await request(app).get(url).expect(401);
    }
    await request(app).post("/api/organizations").send({ name: "Forbidden" }).expect(401);
    await request(app).post(`/api/workspaces/${id}/documents`).send({ title: "No", content: "No" }).expect(401);
  });

  test("creating an organization atomically creates its owner membership", async () => {
    const response = await request(app).post("/api/organizations").auth(owner().token, { type: "bearer" })
      .send({ name: " Team PikaAI " }).expect(201);
    organizationId = response.body.data.id;
    assert.equal(response.body.data.name, "Team PikaAI");
    assert.equal(response.body.data.createdBy, owner().id);
    assert.equal(response.body.data.role, "owner");
    assert.equal(response.headers.location, `/api/organizations/${organizationId}`);
    const membership = await prisma.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId, userId: owner().id } },
    });
    assert.equal(membership.role, "owner");
  });

  test("organization lists and details exclude non-members", async () => {
    const mine = await request(app).get("/api/organizations").auth(owner().token, { type: "bearer" }).expect(200);
    assert.ok(mine.body.data.some((organization: { id: string }) => organization.id === organizationId));
    const other = await request(app).get("/api/organizations").auth(outsider().token, { type: "bearer" }).expect(200);
    assert.deepEqual(other.body.data, []);
    await request(app).get(`/api/organizations/${organizationId}`).auth(outsider().token, { type: "bearer" }).expect(404);
    await request(app).get(`/api/organizations/${organizationId}/workspaces`).auth(outsider().token, { type: "bearer" }).expect(404);
  });

  test("workspace creation checks membership and records the authenticated creator", async () => {
    await request(app).post(`/api/organizations/${organizationId}/workspaces`).auth(outsider().token, { type: "bearer" })
      .send({ name: "Unauthorized" }).expect(404);
    const response = await request(app).post(`/api/organizations/${organizationId}/workspaces`).auth(owner().token, { type: "bearer" })
      .send({ name: " Research ", description: "Initial workspace" }).expect(201);
    workspaceId = response.body.data.id;
    assert.equal(response.body.data.organizationId, organizationId);
    assert.equal(response.body.data.createdBy, owner().id);
    const list = await request(app).get(`/api/organizations/${organizationId}/workspaces`).auth(owner().token, { type: "bearer" }).expect(200);
    assert.equal(list.body.data[0].id, workspaceId);
    await request(app).get(`/api/workspaces/${workspaceId}`).auth(outsider().token, { type: "bearer" }).expect(404);
  });

  test("document POST persists plain text and GET returns it without RAG processing", async () => {
    const response = await request(app).post(`/api/workspaces/${workspaceId}/documents`).auth(owner().token, { type: "bearer" })
      .send({ title: " First source ", content }).expect(201);
    documentId = response.body.data.id;
    assert.equal(response.body.data.title, "First source");
    assert.equal(response.body.data.content, content);
    assert.equal(response.body.data.workspaceId, workspaceId);
    const document = await request(app).get(`/api/documents/${documentId}`).auth(owner().token, { type: "bearer" }).expect(200);
    assert.equal(document.body.data.content, content);
    const stored = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    assert.equal(stored.content, content);
    const list = await request(app).get(`/api/workspaces/${workspaceId}/documents`).auth(owner().token, { type: "bearer" }).expect(200);
    assert.equal(list.body.data[0].id, documentId);
    assert.equal(list.body.data[0].content, undefined);
  });

  test("non-members cannot list, retrieve, or create another tenant's documents", async () => {
    await request(app).get(`/api/workspaces/${workspaceId}/documents`).auth(outsider().token, { type: "bearer" }).expect(404);
    await request(app).get(`/api/documents/${documentId}`).auth(outsider().token, { type: "bearer" }).expect(404);
    await request(app).post(`/api/workspaces/${workspaceId}/documents`).auth(outsider().token, { type: "bearer" })
      .send({ title: "Unauthorized", content: "Unauthorized" }).expect(404);
  });

  test("membership changes take effect immediately without reissuing the user's JWT", async () => {
    await request(app).get(`/api/documents/${documentId}`).auth(member().token, { type: "bearer" }).expect(404);
    await prisma.organizationMember.create({ data: { organizationId, userId: member().id, role: "member" } });
    await request(app).get(`/api/documents/${documentId}`).auth(member().token, { type: "bearer" }).expect(200);
    await request(app).post(`/api/workspaces/${workspaceId}/documents`).auth(member().token, { type: "bearer" })
      .send({ title: "Collaborator source", content: "A member can contribute" }).expect(201);
    await prisma.organizationMember.delete({ where: { organizationId_userId: { organizationId, userId: member().id } } });
    await request(app).get(`/api/documents/${documentId}`).auth(member().token, { type: "bearer" }).expect(404);
    await request(app).post(`/api/organizations/${organizationId}/workspaces`).auth(member().token, { type: "bearer" })
      .send({ name: "No longer a member" }).expect(404);
  });

  test("resource validation rejects bad UUIDs, pagination, blank content, and ownership spoofing", async () => {
    await request(app).get("/api/organizations/not-a-uuid").auth(owner().token, { type: "bearer" }).expect(400);
    await request(app).get("/api/organizations?limit=101").auth(owner().token, { type: "bearer" }).expect(400);
    await request(app).get("/api/organizations?offset=-1").auth(owner().token, { type: "bearer" }).expect(400);
    await request(app).post("/api/organizations").auth(owner().token, { type: "bearer" }).send({ name: " " }).expect(400);
    await request(app).post(`/api/organizations/${organizationId}/workspaces`).auth(owner().token, { type: "bearer" })
      .send({ name: "Spoof", createdBy: outsider().id }).expect(400);
    for (const invalid of ["", " ", "a".repeat(100001)]) {
      await request(app).post(`/api/workspaces/${workspaceId}/documents`).auth(owner().token, { type: "bearer" })
        .send({ title: "Invalid", content: invalid }).expect(400);
    }
  });

  test("collection pagination is bounded and document bodies support text above 16 KB", async () => {
    const response = await request(app).post(`/api/workspaces/${workspaceId}/documents`).auth(owner().token, { type: "bearer" })
      .send({ title: "Longer source", content: "x".repeat(30000) }).expect(201);
    const paged = await request(app).get(`/api/workspaces/${workspaceId}/documents?limit=1&offset=0`)
      .auth(owner().token, { type: "bearer" }).expect(200);
    assert.equal(paged.body.data.length, 1);
    assert.equal(paged.body.data[0].id, response.body.data.id);
    assert.deepEqual(paged.body.pagination, { limit: 1, offset: 0 });
  });

  test("document endpoints expose no update or delete methods", async () => {
    for (const method of ["put", "patch", "delete"] as const) {
      await request(app)[method](`/api/documents/${documentId}`).auth(owner().token, { type: "bearer" })
        .send({ content: "Replacement" }).expect(404);
    }
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: documentId } })).content, content);
  });
});
