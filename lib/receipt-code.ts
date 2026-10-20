// FROZEN. Reporter receipt codes: the reporter's only capability (docs/domain.md §4).
// 80 random bits -> 16 Crockford base32 chars, shown as XXXX-XXXX-XXXX-XXXX. Only an HMAC is stored.
import { randomBytes } from "node:crypto";
import { hmacHex } from "./crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford: no I, L, O, U

export function generateReceiptCode(): string {
  const bytes = randomBytes(10); // 80 bits = 16 x 5 bits
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return formatReceiptCode(out);
}

/** Accepts user-typed input: case-insensitive, spaces/hyphens ignored, I/L->1, O->0. Returns null if invalid. */
export function normalizeReceiptCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (s.length !== 16) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return s;
}

export function formatReceiptCode(normalized: string): string {
  return normalized.match(/.{1,4}/g)!.join("-");
}

export function hashReceiptCode(input: string): string | null {
  const n = normalizeReceiptCode(input);
  return n ? hmacHex("RECEIPT_PEPPER", n) : null;
}
