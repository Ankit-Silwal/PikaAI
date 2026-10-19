import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";
import type { Worker } from "bullmq";
import type { DocumentJobData } from "@pikaai/queues";
import type { AuthUser } from "../src/modules/auth/auth.types.js";
import type { DocumentUploadResponse } from "../src/modules/documents/document.types.js";

const prefix = "document-test-" + randomUUID();
const redisPrefix = "pikaai:test:" + randomUUID() + ":";
const actors: AuthUser[] = Array.from({ length: 4 }, (_, index) => ({
  user_id: randomUUID(), email: prefix + "-" + index + "@example.com", role: index === 3 ? "ADMIN" : "USER",
}));
const [admin, member, pending, outsider] = actors as [AuthUser, AuthUser, AuthUser, AuthUser];
const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
let uploadDir: string;
let server: import("node:http").Server;
let baseUrl: string;
let worker: Worker<DocumentJobData, void> | undefined;
let prisma: typeof import("../src/configs/db.js").prisma;
let redis: typeof import("../src/configs/redis.js").redis;
let queueModule: typeof import("../src/modules/documents/document.queue.js");
let workerModule: typeof import("../../worker/src/modules/documents/document.worker.js");
let workerPool: typeof import("../../worker/src/configs/db.js").pool;
let bullmqConnection: typeof import("../src/configs/bullmq.js").bullmqConnection;
const tokens = new Map<string, string>();

before(async () => {
  uploadDir = await mkdtemp(join(tmpdir(), "pikaai-documents-"));
  Object.assign(process.env, {
    NODE_ENV: "test", REDIS_KEY_PREFIX: redisPrefix, DOCUMENT_UPLOAD_DIR: uploadDir, MAX_UPLOAD_BYTES: "1024",
    RAG_SERVICE_URL: process.env.TEST_RAG_SERVICE_URL ?? "http://127.0.0.1:18000",
    RAG_SERVICE_TOKEN: "rag-integration-test-token",
  });
  const { app } = await import("../src/app.js");
  ({ prisma } = await import("../src/configs/db.js"));
  ({ redis } = await import("../src/configs/redis.js"));
  ({ bullmqConnection } = await import("../src/configs/bullmq.js"));
  queueModule = await import("../src/modules/documents/document.queue.js");
  workerModule = await import("../../worker/src/modules/documents/document.worker.js");
  ({ pool: workerPool } = await import("../../worker/src/configs/db.js"));
  const { createTokens } = await import("../src/utils/jwt.js");
  for (const actor of actors) tokens.set(actor.user_id, createTokens(actor).accessToken);
  await prisma.user.createMany({ data: actors.map(actor => ({ ...actor, password_hash: "unused-test-password-hash" })) });
  await prisma.organization.create({
    data: {
      organization_id: organizationId, name: prefix, join_policy: "APPROVAL_REQUIRED",
      invite_code: randomUUID().replaceAll("-", ""),
      memberships: { create: [
        { user_id: admin.user_id, role: "ADMIN", status: "ACTIVE" },
        { user_id: member.user_id, role: "MEMBER", status: "ACTIVE" },
        { user_id: pending.user_id, role: "MEMBER", status: "PENDING" },
      ] },
    },
  });
  await prisma.organization.create({
    data: {
      organization_id: otherOrganizationId, name: prefix + "-other", join_policy: "OPEN",
      invite_code: randomUUID().replaceAll("-", ""),
      memberships: { create: { user_id: admin.user_id, role: "ADMIN", status: "ACTIVE" } },
    },
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
    try {
      await worker?.close();
      if (queueModule) {
        const queue = queueModule.getDocumentQueue();
        assert.equal(queue.opts.prefix, redisPrefix + "bullmq");
        try {
          await queue.obliterate({ force: true });
        } finally {
          await queueModule.closeDocumentQueue();
        }
      }
    } finally {
      if (prisma) {
        await prisma.organization.deleteMany({ where: { organization_id: { in: [organizationId, otherOrganizationId] } } });
        await prisma.user.deleteMany({ where: { user_id: { in: actors.map(actor => actor.user_id) } } });
      }
    }
  } finally {
    if (prisma) await prisma.$disconnect();
    if (workerPool) await workerPool.end();
    if (redis?.isOpen) redis.destroy();
    if (uploadDir) {
      // Verify the absolute deletion target is the specific test directory.
      assert.equal(dirname(resolve(uploadDir)), resolve(tmpdir()));
      assert.ok(basename(uploadDir).startsWith("pikaai-documents-"));
      await rm(uploadDir, { recursive: true, force: true });
    }
  }
});

function request(method: string, actor?: AuthUser, form?: FormData, path = "", org = organizationId) {
  return fetch(baseUrl + "/organizations/" + org + "/documents" + path, {
    method, headers: actor ? { Authorization: "Bearer " + tokens.get(actor.user_id) } : {},
    body: form, signal: AbortSignal.timeout(10000),
  });
}

function fileForm(content = "Document content for a future RAG pipeline.", filename = "notes.txt", field = "file") {
  const form = new FormData();
  form.append(field, new Blob([content], { type: "text/plain" }), filename);
  return form;
}

async function json(response: Response, status: number) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

async function waitFor<T>(read: () => Promise<T>, matches: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const value = await read();
    if (matches(value)) return value;
    await sleep(25);
  }
  throw new Error("Timed out waiting for document processing");
}

test("Organization document uploads through PostgreSQL, disk, Redis, and a real BullMQ worker", async t => {
  let uploaded: DocumentUploadResponse;

  await t.test("authenticates and checks active membership before storing any file", async () => {
    assert.equal((await request("POST", undefined, fileForm())).status, 401);
    for (const actor of [pending, outsider]) {
      assert.equal((await request("POST", actor, fileForm())).status, 403);
      assert.equal((await request("GET", actor, undefined, "/" + randomUUID())).status, 403);
    }
    assert.equal((await request("POST", member, fileForm(), "", "invalid")).status, 400);
    assert.deepEqual(await readdir(uploadDir), []);
    assert.equal(await prisma.document.count({ where: { organization_id: organizationId } }), 0);
  });

  await t.test("rejects missing, empty, oversized, multiple, and unexpected files and cleans up", async () => {
    assert.equal((await request("POST", member, new FormData())).status, 400);
    assert.equal((await request("POST", member, fileForm(""))).status, 400);
    assert.equal((await request("POST", member, fileForm("x".repeat(1025)))).status, 413);
    assert.equal((await request("POST", member, fileForm("test", "x.txt", "wrong-field"))).status, 400);
    assert.equal((await request("POST", member, fileForm("test", "x".repeat(256)))).status, 400);
    const multiple = fileForm();
    multiple.append("file", new Blob(["another"]), "another.txt");
    assert.equal((await request("POST", member, multiple)).status, 400);
    assert.deepEqual(await readdir(uploadDir), []);
  });

  await t.test("returns 400 for malformed multipart input", async () => {
    const response = await fetch(baseUrl + "/organizations/" + organizationId + "/documents", {
      method: "POST", headers: { Authorization: "Bearer " + tokens.get(member.user_id), "Content-Type": "multipart/form-data" },
      body: "invalid multipart body",
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await readdir(uploadDir), []);
  });

  await t.test("persists a member upload and queues only its ID while the worker is offline", async () => {
    const response = await request("POST", member, fileForm(undefined, "../../notes.txt"));
    uploaded = await json(response, 202);
    assert.equal(uploaded.document.organization_id, organizationId);
    assert.equal(uploaded.document.uploaded_by, member.user_id);
    assert.equal(uploaded.document.original_name, "notes.txt");
    assert.equal(uploaded.document.mime_type, "text/plain");
    assert.equal(uploaded.document.status, "QUEUED");
    assert.equal(uploaded.document.size_bytes, Buffer.byteLength("Document content for a future RAG pipeline."));
    assert.equal(uploaded.jobId, uploaded.document.document_id);
    assert.deepEqual(Object.keys(uploaded.document).sort(), [
      "created_at", "document_id", "mime_type", "organization_id", "original_name", "size_bytes", "status", "uploaded_by",
    ]);
    assert.deepEqual(await readdir(uploadDir), [uploaded.document.document_id]);
    assert.equal(await readFile(join(uploadDir, uploaded.document.document_id), "utf8"), "Document content for a future RAG pipeline.");
    const job = await queueModule.getDocumentQueue().getJob(uploaded.jobId);
    assert.ok(job);
    assert.deepEqual(job.data, { documentId: uploaded.document.document_id });
    assert.equal(await job.getState(), "waiting");
    assert.equal(response.headers.get("RateLimit"), null);
  });

  await t.test("exposes status only to active members of the document's organization", async () => {
    const path = "/" + uploaded.document.document_id;
    const body = await json(await request("GET", admin, undefined, path), 200);
    assert.equal(body.document.status, "QUEUED");
    assert.equal((await request("GET", member, undefined, path)).status, 200);
    assert.equal((await request("GET", admin, undefined, path, otherOrganizationId)).status, 404);
    assert.equal((await request("GET", admin, undefined, "/" + randomUUID())).status, 404);
    assert.equal((await request("GET", admin, undefined, "/invalid")).status, 400);
    assert.equal((await fetch(baseUrl + "/uploads/" + uploaded.document.document_id)).status, 404);
  });

  await t.test("a BullMQ worker sends the upload to the Python RAG service and marks it ready", async () => {
    worker = workerModule.createDocumentWorker();
    await worker.waitUntilReady();
    await waitFor(() => prisma.document.findUniqueOrThrow({ where: { document_id: uploaded.jobId } }), doc => doc.status === "READY");
    const job = await queueModule.getDocumentQueue().getJob(uploaded.jobId);
    assert.ok(job);
    await waitFor(() => job.getState(), state => state === "completed");
    const body = await json(await request("GET", member, undefined, "/" + uploaded.jobId), 200);
    assert.equal(body.document.status, "READY");
    assert.equal(await readFile(join(uploadDir, uploaded.jobId), "utf8"), "Document content for a future RAG pipeline.");
  });

  await t.test("retries failed processing three times and records the failure", async () => {
    await worker!.pause();
    const body: DocumentUploadResponse = await json(await request("POST", member, fileForm("Missing file test.")), 202);
    await rm(join(uploadDir, body.jobId));
    await worker!.resume();
    const job = await queueModule.getDocumentQueue().getJob(body.jobId);
    assert.ok(job);
    await waitFor(() => job.getState(), state => state === "failed");
    const final = await queueModule.getDocumentQueue().getJob(body.jobId);
    assert.equal(final?.attemptsMade, 3);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { document_id: body.jobId } })).status, "FAILED");
  });

  await t.test("a redelivered indexed document does not run indexing again", async () => {
    await rm(join(uploadDir, uploaded.jobId));
    const job = await queueModule.getDocumentQueue().getJob(uploaded.jobId);
    assert.ok(job);
    const completed = once(worker!, "completed");
    await job.retry("completed");
    await completed;
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { document_id: uploaded.jobId } })).status, "READY");
  });

  await t.test("an unreachable queue returns 503, cleans up the upload, and recovers", async () => {
    const unused = createServer();
    unused.listen(0, "127.0.0.1");
    await once(unused, "listening");
    const address = unused.address();
    assert.ok(address && typeof address === "object");
    await new Promise<void>((resolve, reject) => unused.close(error => error ? reject(error) : resolve()));
    const original = { host: bullmqConnection.host, port: bullmqConnection.port };
    const beforeFiles = await readdir(uploadDir);
    const beforeCount = await prisma.document.count({ where: { organization_id: organizationId } });
    await queueModule.closeDocumentQueue();
    try {
      bullmqConnection.host = "127.0.0.1";
      bullmqConnection.port = address.port;
      const response = await request("POST", member, fileForm("Queue failure test."));
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "Unable to queue document. Please try again later" });
      assert.deepEqual(await readdir(uploadDir), beforeFiles);
      assert.equal(await prisma.document.count({ where: { organization_id: organizationId } }), beforeCount);
    } finally {
      Object.assign(bullmqConnection, original);
      await queueModule.closeDocumentQueue();
    }
    const recovered: DocumentUploadResponse = await json(await request("POST", admin, fileForm("Recovered upload.")), 202);
    await waitFor(() => prisma.document.findUniqueOrThrow({ where: { document_id: recovered.jobId } }), doc => doc.status === "READY");
  });

  await t.test("queries require active membership and ignore client-supplied organization IDs", async () => {
    const query = (actor?: AuthUser, org = organizationId, question = "What do the documents contain?") => fetch(
      baseUrl + "/organizations/" + org + "/documents/query", {
        method: "POST", headers: { "Content-Type": "application/json", ...(actor ? { Authorization: "Bearer " + tokens.get(actor.user_id) } : {}) },
        body: JSON.stringify({ question, organization_id: organizationId }),
      },
    );
    assert.equal((await query()).status, 401);
    for (const actor of [pending, outsider]) assert.equal((await query(actor)).status, 403);
    assert.equal((await query(member, organizationId, " ")).status, 400);
    const result = await json(await query(member), 200);
    assert.ok(result.answer);
    assert.ok(result.sources.length > 0);
    assert.ok(result.sources.every((source: { document_id: string }) => source.document_id));
    const other = await json(await query(admin, otherOrganizationId), 200);
    assert.deepEqual(other.sources, []);
    assert.equal((await query(member, organizationId, "__provider_error__")).status, 503);
  });
});
