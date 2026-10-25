// Receipt codes on the device (domain §4): the same rules as the server's frozen lib/receipt-code.ts, so the app
// can say "that doesn't look right" before anything is sent. The server checks again; this file never logs.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U

/** Case-insensitive, spaces/hyphens ignored, I/L -> 1, O -> 0. Returns 16 characters, or null if invalid. */
export function normalizeReceiptCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (s.length !== 16) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return s;
}

/** XXXX-XXXX-XXXX-XXXX */
export function formatReceiptCode(normalized: string): string {
  return (normalized.match(/.{1,4}/g) ?? []).join("-");
}

/** The code in two groups of eight, for two short lines on screen: ["XXXX-XXXX", "XXXX-XXXX"]. */
export function codeLines(normalized: string): [string, string] {
  const f = formatReceiptCode(normalized);
  return [f.slice(0, 9), f.slice(10)];
}

/**
 * The code read one character at a time, a short pause between groups: "7 K 3 M, 9 Q 2 D, ...". Used as the
 * spoken label (screen readers otherwise read "7K3M" as a word) and as the visible "Read it as" line.
 */
export function spellCode(normalized: string): string {
  return (normalized.match(/.{1,4}/g) ?? []).map((group) => group.split("").join(" ")).join(", ");
}
