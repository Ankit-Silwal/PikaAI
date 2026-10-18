import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const envPath = new URL("../../../.env", import.meta.url);
const template = await readFile(new URL("../../../.env.example", import.meta.url), "utf8");
let existing: string;
try {
  existing = await readFile(envPath, "utf8");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  existing = template;
}
for (const line of template.split(/\r?\n/)) {
  const key = line.match(/^([A-Z_]+)=/u)?.[1];
  if (key && !new RegExp(`^${key}=`, "m").test(existing)) existing += `\n${line}`;
}
for (const key of ["JWT_SECRET", "REDIS_PASSWORD"]) {
  existing = existing.replace(new RegExp(`^${key}=\\s*$`, "m"), `${key}=${randomBytes(32).toString("hex")}`);
}
await writeFile(envPath, existing.trimEnd() + "\n", { mode: 0o600 });
console.info("Local .env is ready. Existing settings and populated secrets were preserved.");
