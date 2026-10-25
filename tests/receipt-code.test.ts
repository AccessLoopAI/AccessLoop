// lib/receipt-code.ts (frozen): the reporter's only capability (docs/domain.md §4).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatReceiptCode,
  generateReceiptCode,
  hashReceiptCode,
  normalizeReceiptCode,
} from "@/lib/receipt-code";

const SHAPE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const saved = { ...process.env };
beforeEach(() => {
  process.env.RECEIPT_PEPPER = "test-receipt-pepper";
});
afterEach(() => {
  process.env = { ...saved };
});

describe("generateReceiptCode", () => {
  it("always gives XXXX-XXXX-XXXX-XXXX in Crockford base32 (no I, L, O, U)", () => {
    for (let i = 0; i < 2000; i++) {
      const code = generateReceiptCode();
      expect(code).toMatch(SHAPE);
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it("is unique over many draws (80 random bits)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) seen.add(generateReceiptCode());
    expect(seen.size).toBe(20_000);
  });

  it("uses the whole alphabet, so no character is stuck", () => {
    const chars = new Set<string>();
    for (let i = 0; i < 2000; i++) for (const ch of generateReceiptCode().replace(/-/g, "")) chars.add(ch);
    expect([...chars].sort().join("")).toBe(ALPHABET);
  });

  it("round-trips through normalize and format", () => {
    const code = generateReceiptCode();
    const n = normalizeReceiptCode(code);
    expect(n).toHaveLength(16);
    expect(formatReceiptCode(n!)).toBe(code);
  });
});

describe("normalizeReceiptCode (what a person types)", () => {
  const CANON = "ABCD1234EFGH5678";

  it("accepts lowercase, spaces and hyphens in any arrangement", () => {
    for (const typed of [
      "ABCD-1234-EFGH-5678",
      "abcd-1234-efgh-5678",
      "abcd 1234 efgh 5678",
      "  AbCd1234eFgH5678  ",
      "ab-cd 12-34 ef gh-56 78",
      "ABCD\t1234\nEFGH 5678",
    ]) {
      expect(normalizeReceiptCode(typed)).toBe(CANON);
    }
  });

  it("maps I and L to 1 and O to 0 (easy to misread)", () => {
    expect(normalizeReceiptCode("ABCD-I234-EFGH-5678")).toBe(CANON);
    expect(normalizeReceiptCode("abcd-l234-efgh-5678")).toBe(CANON);
    expect(normalizeReceiptCode("OOOO-OOOO-OOOO-OOOO")).toBe("0".repeat(16));
    expect(normalizeReceiptCode("iiii-llll-oooo-0000")).toBe("11111111" + "0".repeat(8));
  });

  it("rejects the wrong length", () => {
    expect(normalizeReceiptCode("")).toBeNull();
    expect(normalizeReceiptCode("ABCD-1234-EFGH-567")).toBeNull(); // 15
    expect(normalizeReceiptCode("ABCD-1234-EFGH-56789")).toBeNull(); // 17
    expect(normalizeReceiptCode("ABCD-1234")).toBeNull();
  });

  it("rejects letters outside the alphabet (U) and any punctuation", () => {
    expect(normalizeReceiptCode("ABCD-1234-EFGH-567U")).toBeNull();
    expect(normalizeReceiptCode("uuuu-uuuu-uuuu-uuuu")).toBeNull();
    expect(normalizeReceiptCode("ABCD.1234.EFGH.5678")).toBeNull();
    expect(normalizeReceiptCode("ABCD_1234_EFGH_5678")).toBeNull();
    expect(normalizeReceiptCode("ABCD-1234-EFGH-567!")).toBeNull();
    expect(normalizeReceiptCode("ABCD-1234-EFGH-567É")).toBeNull();
  });
});

describe("formatReceiptCode", () => {
  it("groups 16 characters in fours", () => {
    expect(formatReceiptCode("ABCD1234EFGH5678")).toBe("ABCD-1234-EFGH-5678");
  });
});

describe("hashReceiptCode (only this is stored)", () => {
  it("is a 64-character hex HMAC, never the code itself", () => {
    const h = hashReceiptCode("ABCD-1234-EFGH-5678");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("ABCD");
  });

  it("is stable for every way of typing the same code", () => {
    const h = hashReceiptCode("ABCD-1234-EFGH-5678");
    expect(hashReceiptCode("abcd 1234 efgh 5678")).toBe(h);
    expect(hashReceiptCode("ABCD1234EFGH5678")).toBe(h);
    expect(hashReceiptCode("abcd-i234-efgh-5678")).toBe(h); // I -> 1
    expect(hashReceiptCode("abcd-l234-efgh-5678")).toBe(h); // L -> 1
    expect(hashReceiptCode("0000-0000-0000-0000")).toBe(hashReceiptCode("oooo-OOOO-oooo-OOOO"));
  });

  it("differs for different codes", () => {
    expect(hashReceiptCode("ABCD-1234-EFGH-5678")).not.toBe(hashReceiptCode("ABCD-1234-EFGH-5679"));
  });

  it("is null for invalid input", () => {
    expect(hashReceiptCode("")).toBeNull();
    expect(hashReceiptCode("ABCD-1234-EFGH-567U")).toBeNull();
    expect(hashReceiptCode("ABCD-1234-EFGH-567")).toBeNull();
    expect(hashReceiptCode("not a code at all")).toBeNull();
  });

  it("depends on RECEIPT_PEPPER, and refuses to run without it", () => {
    const h = hashReceiptCode("ABCD-1234-EFGH-5678");
    process.env.RECEIPT_PEPPER = "another-pepper";
    expect(hashReceiptCode("ABCD-1234-EFGH-5678")).not.toBe(h);
    delete process.env.RECEIPT_PEPPER;
    expect(() => hashReceiptCode("ABCD-1234-EFGH-5678")).toThrow(/RECEIPT_PEPPER/);
  });
});
