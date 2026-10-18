import { Queue } from "bullmq";
import { bullmqConnection, bullmqPrefix, DOCUMENT_QUEUE_NAME } from "../../configs/bullmq.js";
import { HttpError } from "../../utils/http-error.js";
import type { DocumentJobData } from "./document.types.js";

let queue: Queue<DocumentJobData> | undefined;

export function getDocumentQueue(): Queue<DocumentJobData> {
  if (!queue) {
    queue = new Queue<DocumentJobData>(DOCUMENT_QUEUE_NAME, {
      prefix: bullmqPrefix,
      connection: {
        ...bullmqConnection,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        commandTimeout: 5000,
        retryStrategy: () => null,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    });
    queue.on("error", error => console.error("Document queue error:", error.message));
  }
  return queue;
}

export async function enqueueDocument(documentId: string): Promise<void> {
  const current = getDocumentQueue();
  try {
    await current.add("process-document", { documentId }, { jobId: documentId });
  } catch {
    if (queue === current) queue = undefined;
    await current.close().catch(() => {});
    throw new HttpError(503, "Unable to queue document. Please try again later");
  }
}

export async function closeDocumentQueue(): Promise<void> {
  const current = queue;
  queue = undefined;
  await current?.close();
}
