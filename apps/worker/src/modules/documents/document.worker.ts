import { openAsBlob } from "node:fs";
import { join } from "node:path";
import { Job, Worker } from "bullmq";
import { DOCUMENT_QUEUE_NAME, type DocumentJobData } from "@pikaai/queues";
import { bullmqConnection, bullmqPrefix } from "../../configs/bullmq.js";
import { pool } from "../../configs/db.js";
import { env } from "../../configs/env.js";

async function processDocument(job: Job<DocumentJobData>): Promise<void> {
  const { rows: [document] } = await pool.query<{
    document_id: string; status: string; organization_id: string; original_name: string; mime_type: string;
  }>(
    "SELECT document_id, status, organization_id, original_name, mime_type FROM auth_documents WHERE document_id = $1", [job.data.documentId],
  );
  // A failed upload may have been cleaned up; completed indexing is safe to replay.
  if (!document || document.status === "READY") return;
  try {
    await pool.query("UPDATE auth_documents SET status = $2 WHERE document_id = $1", [document.document_id, "PROCESSING"]);
    if (!env.ragServiceToken) throw new Error("RAG_SERVICE_TOKEN is required for indexing");
    const form = new FormData();
    form.set("document_id", document.document_id);
    form.set("organization_id", document.organization_id);
    form.set("file", await openAsBlob(join(env.documentUploadDir, document.document_id), { type: document.mime_type }), document.original_name);
    const response = await fetch(env.ragServiceUrl + "/documents/index", {
      method: "POST", headers: { Authorization: "Bearer " + env.ragServiceToken },
      body: form, signal: AbortSignal.timeout(300000),
    });
    if (!response.ok) throw new Error("RAG indexing failed with status " + response.status);
    const result = await response.json() as { document_id?: string; chunk_count?: number };
    if (result.document_id !== document.document_id || typeof result.chunk_count !== "number" || !Number.isSafeInteger(result.chunk_count) || result.chunk_count < 1) {
      throw new Error("RAG service returned an invalid indexing result");
    }
    await pool.query("UPDATE auth_documents SET status = $2 WHERE document_id = $1", [document.document_id, "READY"]);
  } catch (error) {
    const retrying = job.attemptsMade + 1 < (job.opts.attempts ?? 1);
    await pool.query("UPDATE auth_documents SET status = $2 WHERE document_id = $1", [
      document.document_id, retrying ? "QUEUED" : "FAILED",
    ]);
    throw error;
  }
}

export function createDocumentWorker(): Worker<DocumentJobData, void> {
  const worker = new Worker<DocumentJobData, void>(DOCUMENT_QUEUE_NAME, processDocument, {
    prefix: bullmqPrefix,
    connection: { ...bullmqConnection, maxRetriesPerRequest: null },
  });
  worker.on("error", error => console.error("Document worker error:", error.message));
  worker.on("failed", (job, error) => console.error("Document job failed:", job?.id, error.message));
  return worker;
}
