// FROZEN. AES-256-GCM for case_private and reporter contact details. Node runtime only.
import { createCipheriv, createDecipheriv, randomBytes, createHmac, createHash } from "node:crypto";

function key(): Buffer {
  const b64 = process.env.ENCRYPTION_KEY;
  if (!b64) throw new Error("ENCRYPTION_KEY is not set (32 random bytes, base64)");
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("ENCRYPTION_KEY must decode to 32 bytes");
  return k;
}

/** Returns "v1:" + base64(iv[12] | tag[16] | ciphertext). */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return "v1:" + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decrypt(blob: string): string {
  if (!blob.startsWith("v1:")) throw new Error("unknown ciphertext version");
  const raw = Buffer.from(blob.slice(3), "base64");
  const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

export function hmacHex(secretEnv: "RECEIPT_PEPPER" | "IP_SALT" | "SESSION_SECRET", value: string): string {
  const s = process.env[secretEnv];
  if (!s) throw new Error(`${secretEnv} is not set`);
  return createHmac("sha256", s).update(value).digest("hex");
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
