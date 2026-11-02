// One-round re-test links (lib/retest-link.ts; docs/archive/phase7-prompt.md T3 item 11): a token only this server can make,
// that names one round of one case and an expiry, and opens nothing else: tampering with any byte, another secret,
// another length, another version or a made-up token reads as nothing. The expiry is 30 days after the email or the
// round's end (60 days after its request), whichever comes first; the secret is the shared lib/env.ts one.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveLocalSecret } from "@/lib/env";
import {
  RETEST_LINK_DAYS,
  RETEST_LINK_PATH,
  RETEST_LINK_TOKEN_LENGTH,
  RETEST_ROUND_DAYS,
  readRetestLink,
  retestLinkExpired,
  retestLinkExpiry,
  retestLinkSecret,
  retestLinkUrl,
  signRetestLink,
} from "@/lib/retest-link";

const SECRET = "a-retest-link-secret-of-at-least-32-characters";
const ORG = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CASE = "0a1b2c3d-4e5f-4061-8728-394a5b6c7d8e";
const DAY = 86_400_000;
const claims = { orgId: ORG, caseId: CASE, round: 1, expiresAt: new Date("2026-11-19T15:30:00.000Z") };

describe("signRetestLink / readRetestLink", () => {
  it("round-trips the org, the case, the round and the expiry (whole seconds), as a URL-safe token of fixed length", () => {
    const token = signRetestLink(claims, SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).toHaveLength(RETEST_LINK_TOKEN_LENGTH);
    expect(RETEST_LINK_TOKEN_LENGTH).toBe(72);
    expect(readRetestLink(token, SECRET)).toEqual(claims);
    const round2 = signRetestLink({ ...claims, round: 2, expiresAt: new Date("2026-11-19T15:30:00.999Z") }, SECRET);
    expect(readRetestLink(round2, SECRET)).toEqual({ ...claims, round: 2 });
  });

  it("reads nothing from a changed byte, another secret, another length or a made-up token", () => {
    const token = signRetestLink(claims, SECRET);
    const raw = Buffer.from(token, "base64url");
    for (let i = 0; i < raw.length; i++) {
      const changed = Buffer.from(raw);
      changed[i] ^= 0x01;
      expect(readRetestLink(changed.toString("base64url"), SECRET), `byte ${i}`).toBeNull();
    }
    expect(readRetestLink(token, `${SECRET}x`)).toBeNull();
    expect(readRetestLink(token, "")).toBeNull();
    expect(readRetestLink(token.slice(0, -1), SECRET)).toBeNull();
    expect(readRetestLink(`${token}A`, SECRET)).toBeNull();
    expect(readRetestLink("A".repeat(RETEST_LINK_TOKEN_LENGTH), SECRET)).toBeNull();
    expect(readRetestLink(`${token.slice(0, -1)}=`, SECRET)).toBeNull();
    expect(readRetestLink("../../etc/passwd", SECRET)).toBeNull();
  });

  it("refuses another version even with a valid MAC over it, and round 0", () => {
    const payload = Buffer.from(signRetestLink(claims, SECRET), "base64url").subarray(0, 38);
    const sign = (p: Buffer) =>
      Buffer.concat([
        p,
        createHmac("sha256", SECRET).update("accessloop/retest-link/v1\n").update(p).digest().subarray(0, 16),
      ]).toString("base64url");
    expect(readRetestLink(sign(payload), SECRET)).toEqual(claims); // the construction the module uses
    const v2 = Buffer.from(payload);
    v2[0] = 2;
    expect(readRetestLink(sign(v2), SECRET)).toBeNull();
    const round0 = Buffer.from(payload);
    round0[33] = 0;
    expect(readRetestLink(sign(round0), SECRET)).toBeNull();
  });

  it("refuses to sign without a secret, a bad round or ids that are not uuids", () => {
    expect(() => signRetestLink(claims, "")).toThrow();
    expect(() => signRetestLink({ ...claims, round: 0 }, SECRET)).toThrow();
    expect(() => signRetestLink({ ...claims, round: 256 }, SECRET)).toThrow();
    expect(() => signRetestLink({ ...claims, caseId: "BAR-0042" }, SECRET)).toThrow();
  });
});

describe("expiry", () => {
  const now = new Date("2026-10-20T12:00:00.000Z");

  it("30 days after the email, unless the round ends first (60 days after its request)", () => {
    expect(RETEST_LINK_DAYS).toBe(30);
    expect(RETEST_ROUND_DAYS).toBe(60);
    // The request email: the round was just requested, so 30 days.
    expect(retestLinkExpiry(now, now)).toEqual(new Date(now.getTime() + 30 * DAY));
    // A reminder 7 days into the round: still 30 days from the reminder (day 37 < day 60).
    expect(retestLinkExpiry(new Date(now.getTime() - 7 * DAY), now)).toEqual(new Date(now.getTime() + 30 * DAY));
    // A reminder 45 days into the round: the round ends at day 60, 15 days from now.
    expect(retestLinkExpiry(new Date(now.getTime() - 45 * DAY), now)).toEqual(new Date(now.getTime() + 15 * DAY));
  });

  it("an expired link is still ours (it reads), and retestLinkExpired says it is over", () => {
    const old = signRetestLink({ ...claims, expiresAt: new Date(now.getTime() - 1000) }, SECRET);
    const read = readRetestLink(old, SECRET)!;
    expect(read).not.toBeNull();
    expect(retestLinkExpired(read, now)).toBe(true);
    expect(retestLinkExpired({ ...read, expiresAt: new Date(now.getTime() + 1000) }, now)).toBe(false);
    expect(retestLinkExpired({ ...read, expiresAt: now }, now)).toBe(true);
  });
});

describe("the secret and the URL", () => {
  const local = { AUTH_MODE: "local", SESSION_SECRET: "a-session-secret-of-at-least-32-characters!!", APP_URL: "https://accessloop.example" };

  it("uses RETEST_LINK_SECRET when set, else (local mode only) the HKDF derivation from SESSION_SECRET", () => {
    expect(retestLinkSecret({ ...local, RETEST_LINK_SECRET: SECRET })).toBe(SECRET);
    expect(retestLinkSecret(local)).toBe(deriveLocalSecret(local.SESSION_SECRET, "RETEST_LINK_SECRET").toString("base64url"));
    expect(() => retestLinkSecret({ ...local, AUTH_MODE: "clerk" })).toThrow(/RETEST_LINK_SECRET/);
    expect(() => retestLinkSecret({ ...local, VERCEL: "1" })).toThrow(/RETEST_LINK_SECRET/);
  });

  it("builds an absolute /r/t/{token} URL on APP_URL that opens this round of this case", () => {
    const now = new Date("2026-10-20T12:00:00.000Z");
    const url = retestLinkUrl({ orgId: ORG, caseId: CASE, round: 2, requestedAt: now }, now, { ...local, RETEST_LINK_SECRET: SECRET });
    expect(url.startsWith(`https://accessloop.example${RETEST_LINK_PATH}`)).toBe(true);
    const token = url.slice(`https://accessloop.example${RETEST_LINK_PATH}`.length);
    expect(readRetestLink(token, SECRET)).toEqual({ orgId: ORG, caseId: CASE, round: 2, expiresAt: new Date(now.getTime() + 30 * DAY) });
  });
});
