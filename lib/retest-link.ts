// One-round re-test links /r/t/{token} (docs/phase7-prompt.md T3 item 11; docs/domain.md §3, §4; docs/decisions.md
// 2026-10-20). The re-test request and reminder emails carry a link that answers THAT round's question only, so the
// receipt code never has to be typed (or put in a URL) to answer a re-test, and a link that leaks (a forwarded email,
// a host's request log) opens one question for a limited time instead of the whole report for as long as it exists.
//
//   token = base64url( payload || HMAC-SHA256(RETEST_LINK_SECRET, CONTEXT || payload)[0..16) )
//   payload = version (1 byte) | orgId (16 bytes) | caseId (16 bytes) | round (1 byte) | expiry (uint32, Unix seconds)
//
// The org and case come from a token only this server can make (the MAC), never from anything a browser chose:
// the same idea as the sealed preview token (lib/intake/preview-token.ts). The expiry is 30 days after the email, or
// the round's own end (60 days after its retest_requested: expire_retest), whichever comes first. Single use comes
// from the state machine, as with the receipt code: once the round is answered the case is no longer waiting for
// this round's answer, so the link can't answer again; and a later round needs a new email with a new link.
// The token is a capability like the receipt code: never stored, never logged; the Outbox shows LINK_PLACEHOLDER.
//
// Server-only (node:crypto). The pure functions take the secret, so tests pass their own.
import { createHmac, timingSafeEqual } from "node:crypto";
import { absoluteUrl } from "@/lib/app-url";
import { secretFromEnv, type EnvSource } from "@/lib/env";
import { RETEST_EXPIRY_DAYS } from "@/lib/state-machine";

/** A link works for at most this many days after the email that carries it. */
export const RETEST_LINK_DAYS = 30;
/** expire_retest's own limit (frozen lib/state-machine.ts): a round ends then at the latest. */
export const RETEST_ROUND_DAYS = RETEST_EXPIRY_DAYS;
/** Where a link opens. app/r/t/[token]. */
export const RETEST_LINK_PATH = "/r/t/";

const VERSION = 1;
const MAC_BYTES = 16; // 128 bits
const PAYLOAD_BYTES = 1 + 16 + 16 + 1 + 4;
/** A token is always this long (base64url of 54 bytes, no padding). */
export const RETEST_LINK_TOKEN_LENGTH = Math.ceil(((PAYLOAD_BYTES + MAC_BYTES) * 4) / 3);
// Domain separation: this key signs nothing else, but the context keeps it that way if it ever does.
const CONTEXT = Buffer.from("accessloop/retest-link/v1\n", "utf8");
const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = new RegExp(`^[A-Za-z0-9_-]{${RETEST_LINK_TOKEN_LENGTH}}$`);

export interface RetestLinkClaims {
  orgId: string;
  caseId: string;
  /** The re-test round this link answers (cases.retestRound when the email went out). */
  round: number;
  /** Whole seconds: the link stops working after this instant. */
  expiresAt: Date;
}

function uuidBytes(id: string): Buffer {
  if (!UUID.test(id)) throw new Error("retest link: not a uuid");
  return Buffer.from(id.replace(/-/g, ""), "hex");
}

function uuidString(bytes: Buffer): string {
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function mac(secret: string, payload: Buffer): Buffer {
  return createHmac("sha256", Buffer.from(secret, "utf8")).update(CONTEXT).update(payload).digest().subarray(0, MAC_BYTES);
}

/** The token for one round of one case. */
export function signRetestLink(claims: RetestLinkClaims, secret: string): string {
  if (!secret) throw new Error("retest link: no secret");
  if (!Number.isInteger(claims.round) || claims.round < 1 || claims.round > 255) throw new Error("retest link: bad round");
  const seconds = Math.floor(claims.expiresAt.getTime() / 1000);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 0xffffffff) throw new Error("retest link: bad expiry");
  const payload = Buffer.alloc(PAYLOAD_BYTES);
  payload.writeUInt8(VERSION, 0);
  uuidBytes(claims.orgId).copy(payload, 1);
  uuidBytes(claims.caseId).copy(payload, 17);
  payload.writeUInt8(claims.round, 33);
  payload.writeUInt32BE(seconds, 34);
  return Buffer.concat([payload, mac(secret, payload)]).toString("base64url");
}

/**
 * The claims of a token this server made, or null for anything else (wrong length or alphabet, another version, a
 * MAC that does not match). It does NOT check the expiry: retestLinkExpired() does, so the page can tell an
 * expired link (ours, kindly explained) from a made-up one (a 404, without touching the database).
 */
export function readRetestLink(token: string, secret: string): RetestLinkClaims | null {
  if (!secret || typeof token !== "string" || !TOKEN.test(token)) return null;
  const raw = Buffer.from(token, "base64url");
  if (raw.length !== PAYLOAD_BYTES + MAC_BYTES) return null;
  const payload = raw.subarray(0, PAYLOAD_BYTES);
  const given = raw.subarray(PAYLOAD_BYTES);
  if (!timingSafeEqual(given, mac(secret, payload))) return null;
  if (payload.readUInt8(0) !== VERSION) return null;
  const round = payload.readUInt8(33);
  if (round < 1) return null;
  return {
    orgId: uuidString(payload.subarray(1, 17)),
    caseId: uuidString(payload.subarray(17, 33)),
    round,
    expiresAt: new Date(payload.readUInt32BE(34) * 1000),
  };
}

export function retestLinkExpired(claims: RetestLinkClaims, now: Date = new Date()): boolean {
  return now.getTime() >= claims.expiresAt.getTime();
}

/** When a link sent `now` for a round requested at `requestedAt` stops working: 30 days, or the round's end. */
export function retestLinkExpiry(requestedAt: Date, now: Date = new Date()): Date {
  const linkEnd = now.getTime() + RETEST_LINK_DAYS * DAY_MS;
  const roundEnd = requestedAt.getTime() + RETEST_ROUND_DAYS * DAY_MS;
  return new Date(Math.floor(Math.min(linkEnd, roundEnd) / 1000) * 1000);
}

/** RETEST_LINK_SECRET (lib/env.ts: derived from SESSION_SECRET in local mode, required elsewhere). */
export function retestLinkSecret(env: EnvSource = process.env): string {
  return secretFromEnv("RETEST_LINK_SECRET", env);
}

/** The absolute link for an email (lib/app-url.ts), for one round of one case. */
export function retestLinkUrl(
  input: { orgId: string; caseId: string; round: number; requestedAt: Date },
  now: Date = new Date(),
  env: EnvSource = process.env,
): string {
  const token = signRetestLink(
    { orgId: input.orgId, caseId: input.caseId, round: input.round, expiresAt: retestLinkExpiry(input.requestedAt, now) },
    retestLinkSecret(env),
  );
  return absoluteUrl(`${RETEST_LINK_PATH}${token}`, env);
}
