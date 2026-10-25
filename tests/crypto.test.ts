// lib/crypto.ts (frozen): AES-256-GCM for case_private and contact details, HMACs, sha256 (domain §9).
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decrypt, encrypt, hmacHex, sha256Hex } from "@/lib/crypto";

const key = () => randomBytes(32).toString("base64");

const saved = { ...process.env };
beforeEach(() => {
  process.env.ENCRYPTION_KEY = key();
  process.env.RECEIPT_PEPPER = "pepper-one";
  process.env.IP_SALT = "salt-one";
  process.env.SESSION_SECRET = "session-one";
});
afterEach(() => {
  process.env = { ...saved };
});

/** Flip one bit of the decoded blob at `index` and re-encode it. */
function flip(blob: string, index: number): string {
  const raw = Buffer.from(blob.slice(3), "base64");
  raw[index] ^= 0x01;
  return "v1:" + raw.toString("base64");
}

describe("encrypt / decrypt", () => {
  it("round-trips unicode text exactly", () => {
    for (const text of [
      "",
      "plain ascii",
      "Café, naïve, Montréal: l'accès à la porte ne fonctionne pas.",
      "Emoji ♿🦽🚪 and CJK 日本語 and RTL שלום",
      "line one\nline two\r\n\ttabbed",
      "x".repeat(10_000),
    ]) {
      expect(decrypt(encrypt(text))).toBe(text);
    }
  });

  it("uses the v1 format: iv(12) + tag(16) + ciphertext, never the plaintext", () => {
    const blob = encrypt("Daniel Okafor");
    expect(blob.startsWith("v1:")).toBe(true);
    expect(blob).not.toContain("Daniel");
    expect(Buffer.from(blob.slice(3), "base64")).toHaveLength(12 + 16 + Buffer.byteLength("Daniel Okafor"));
  });

  it("uses a fresh random IV: the same text never gives the same ciphertext", () => {
    const a = encrypt("same text");
    const b = encrypt("same text");
    expect(a).not.toBe(b);
    expect(Buffer.from(a.slice(3), "base64").subarray(0, 12)).not.toEqual(Buffer.from(b.slice(3), "base64").subarray(0, 12));
    expect(decrypt(a)).toBe("same text");
    expect(decrypt(b)).toBe("same text");
  });

  it("throws on tampered ciphertext, tag or IV (GCM authentication)", () => {
    const blob = encrypt("the original report");
    expect(() => decrypt(flip(blob, 30))).toThrow(); // ciphertext byte
    expect(() => decrypt(flip(blob, 15))).toThrow(); // auth tag byte
    expect(() => decrypt(flip(blob, 0))).toThrow(); // IV byte
    const raw = Buffer.from(blob.slice(3), "base64");
    expect(() => decrypt("v1:" + raw.subarray(0, raw.length - 1).toString("base64"))).toThrow(); // truncated
  });

  it("throws with the wrong key", () => {
    const blob = encrypt("secret");
    process.env.ENCRYPTION_KEY = key();
    expect(() => decrypt(blob)).toThrow();
  });

  it("rejects unknown ciphertext versions", () => {
    const blob = encrypt("secret");
    expect(() => decrypt("v2:" + blob.slice(3))).toThrow(/unknown ciphertext version/);
    expect(() => decrypt(blob.slice(3))).toThrow(/unknown ciphertext version/);
  });

  it("refuses a missing key or a key that is not 32 bytes", () => {
    process.env.ENCRYPTION_KEY = randomBytes(16).toString("base64");
    expect(() => encrypt("x")).toThrow(/32 bytes/);
    process.env.ENCRYPTION_KEY = randomBytes(33).toString("base64");
    expect(() => encrypt("x")).toThrow(/32 bytes/);
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt("x")).toThrow(/ENCRYPTION_KEY is not set/);
    expect(() => decrypt("v1:AAAA")).toThrow(/ENCRYPTION_KEY is not set/);
  });
});

describe("hmacHex", () => {
  it("is stable for the same secret and value", () => {
    const a = hmacHex("RECEIPT_PEPPER", "value");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hmacHex("RECEIPT_PEPPER", "value")).toBe(a);
    expect(hmacHex("RECEIPT_PEPPER", "value2")).not.toBe(a);
  });

  it("depends on the secret, and each env name is its own secret", () => {
    const a = hmacHex("RECEIPT_PEPPER", "value");
    process.env.RECEIPT_PEPPER = "pepper-two";
    expect(hmacHex("RECEIPT_PEPPER", "value")).not.toBe(a);
    expect(hmacHex("IP_SALT", "value")).not.toBe(hmacHex("SESSION_SECRET", "value"));
  });

  it("matches the RFC 4231 test vector (HMAC-SHA256, case 2)", () => {
    process.env.SESSION_SECRET = "Jefe";
    expect(hmacHex("SESSION_SECRET", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("throws when the secret is not set", () => {
    delete process.env.IP_SALT;
    expect(() => hmacHex("IP_SALT", "1.2.3.4")).toThrow(/IP_SALT is not set/);
  });
});

describe("sha256Hex", () => {
  it("matches known vectors for strings and buffers", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex(Buffer.from("abc"))).toBe(sha256Hex("abc"));
    expect(sha256Hex("é")).toBe(sha256Hex(Buffer.from("é", "utf8"))); // strings hash as UTF-8
  });
});
