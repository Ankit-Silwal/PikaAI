import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// OWASP scrypt setting: 32 MiB memory, r=8, p=3. Never block the event loop.
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$32768$8$3$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const match = /^scrypt\$32768\$8\$3\$([a-f\d]{32})\$([a-f\d]{128})$/u.exec(encoded);
  if (!match?.[1] || !match[2]) return false;
  const actual = await derive(password, Buffer.from(match[1], "hex"));
  return timingSafeEqual(actual, Buffer.from(match[2], "hex"));
}

// Unknown emails still perform a real password derivation to reduce timing leaks.
export async function verifyUnknownPassword(password: string): Promise<void> {
  await derive(password, Buffer.alloc(16));
}
