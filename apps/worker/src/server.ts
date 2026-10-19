import { pool } from "./configs/db.js";
import { createDocumentWorker } from "./modules/documents/document.worker.js";

await pool.query("SELECT 1");
const worker = createDocumentWorker();
await worker.waitUntilReady();
console.log("Document worker ready");

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  await worker.close();
  await pool.end();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdown().catch(error => {
      console.error("Document worker shutdown failed:", error.message);
      process.exitCode = 1;
    });
  });
}
