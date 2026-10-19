import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { Job, Worker } from "bullmq";
import { DOCUMENT_QUEUE_NAME, type DocumentJobData } from "@pikaai/queues";
import { bullmqConnection, bullmqPrefix } from "../../configs/bullmq.js";
import { pool } from "../../configs/db.js";
import { env } from "../../configs/env.js";

async function processDocument(job: Job<DocumentJobData>): Promise<void> {
  const { rows: [document] } = await pool.query<{ document_id: string; status: string }>(
    "SELECT document_id, status FROM auth_documents WHERE document_id = $1", [job.data.documentId],
  );
  // A failed upload may have been cleaned up; completed preparation is safe to replay.
  if (!document || document.status === "AWAITING_RAG") return;
  try {
    await pool.query("UPDATE auth_documents SET status = $2 WHERE document_id = $1", [document.document_id, "PROCESSING"]);
    await access(join(env.documentUploadDir, document.document_id), constants.R_OK);

    // Future RAG pipeline: extract text, chunk, embed, and index this stored file here.
    await pool.query("UPDATE auth_documents SET status = $2 WHERE document_id = $1", [document.document_id, "AWAITING_RAG"]);
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
