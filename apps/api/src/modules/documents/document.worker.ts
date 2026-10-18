import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { Job, Worker } from "bullmq";
import { bullmqConnection, bullmqPrefix, DOCUMENT_QUEUE_NAME } from "../../configs/bullmq.js";
import { prisma } from "../../configs/db.js";
import { env } from "../../configs/env.js";
import type { DocumentJobData } from "./document.types.js";

async function processDocument(job: Job<DocumentJobData>): Promise<void> {
  const document = await prisma.document.findUnique({ where: { document_id: job.data.documentId } });
  // A failed upload may have been cleaned up; completed preparation is safe to replay.
  if (!document || document.status === "AWAITING_RAG") return;
  try {
    await prisma.document.update({ where: { document_id: document.document_id }, data: { status: "PROCESSING" } });
    await access(join(env.documentUploadDir, document.document_id), constants.R_OK);

    // Future RAG pipeline: extract text, chunk, embed, and index this stored file here.
    await prisma.document.update({ where: { document_id: document.document_id }, data: { status: "AWAITING_RAG" } });
  } catch (error) {
    const retrying = job.attemptsMade + 1 < (job.opts.attempts ?? 1);
    await prisma.document.updateMany({
      where: { document_id: document.document_id },
      data: { status: retrying ? "QUEUED" : "FAILED" },
    });
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
