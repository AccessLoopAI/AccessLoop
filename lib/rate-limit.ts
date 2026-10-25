// Rate limits and spend limits for the public routes (CLAUDE.md "Security rules", domain §9; docs/phase7-prompt.md
// T3 item 7), on the `rate_limits` table. Server-only. `rate_limits` is NOT tenant-scoped, so it is used with `db`
// (never inside withOrg); its RLS policy lets the app role read and write it with no org context (D7(b)).
//
// Three kinds of row, one table:
//   per client   key = hmacHex("IP_SALT", bucket + "|" + UTC date) + ":" + route, fixed windows aligned to the epoch.
//                The bucket is the IPv4 address, or the /64 network of an IPv6 address (one home or phone network
//                gets 2^64 addresses, so per-address buckets would be unlimited). A raw IP is never stored or logged.
//   AI budget    key = "budget:ai_calls", one-hour windows: AI calls the public report form may make in an hour,
//                across every visitor and organization (AI_GLOBAL_HOURLY_LIMIT, default 300). Past it, intake takes
//                the manual path (no AI; a person redacts and triages) and the reporter is told so in plain words.
//   per org      key = "org_web_reports:" + org id, one window per day (America/Toronto): reports the org's public
//                form accepts in a day (ORG_DAILY_SUBMISSION_LIMIT, default 200), shown on the dashboard.
// Rows older than 2 days are deleted now and then (the app role may DELETE from rate_limits, nothing else).
//
// The client address is platform-aware (clientIp): on Vercel the platform's own `x-real-ip`; anywhere else the LAST
// `x-forwarded-for` entry, the one the nearest proxy appended (the first entry is whatever the client wrote).
//
// Two documented allowances keep the e2e suite (and the local prototype) inside the new, lower limits without
// weakening them where they matter:
//   - the preview limit is 20 per 10 minutes when a real AI backend answers (each preview is 2-3 paid model calls);
//     with the fake backend (FAKE_LLM=1: Playwright, CI, Vercel previews) a preview costs nothing and keeps the old
//     limit of 120. The AI budget, likewise, counts real model calls only.
//   - the per-org daily cap is not applied to requests from this computer in the local prototype: AUTH_MODE=local,
//     VERCEL unset and a loopback client address. That is impossible on Vercel (lib/env.ts refuses AUTH_MODE=local
//     there) and from anywhere else: a tunnel or proxy appends the real, non-loopback client address.
import { isIP } from "node:net";
import { and, eq, lt, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { rateLimits } from "@/db/schema";
import { effectiveBackend } from "@/lib/ai/backend";
import { isLoopbackAddress } from "@/lib/auth/local-request";
import { hmacHex } from "@/lib/crypto";
import { DISPLAY_TIME_ZONE } from "@/lib/format";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export type RateLimitEnv = Readonly<Record<string, string | undefined>>;

/**
 * Requests allowed per client and window. Generous on purpose (a person who reloads, goes back and tries again
 * never meets them), except the preview, which is the one public step that spends money on a model.
 */
export const RATE_LIMITS = {
  /** Step 3 "Next" of the report form (redaction + AI summary): 2-3 model calls each. See previewLimit(). */
  intake_preview: { limit: 20, windowMs: 10 * MINUTE },
  /** "Send report". */
  intake_submit: { limit: 60, windowMs: 10 * MINUTE },
  /** /check: a typed receipt code. The tightest, because it is the obvious place to guess codes. */
  check: { limit: 30, windowMs: 10 * MINUTE },
  /** Rendering /r/[code] (a code in a URL can be guessed too). */
  receipt_view: { limit: 240, windowMs: 10 * MINUTE },
  /**
   * Rendering /o/[orgSlug]/receipt with a code in its cookie (a cookie can be forged to guess codes). Twice the
   * submit limit, so a person who sends reports (one receipt each, plus a reload) meets the submit limit first.
   */
  receipt_page: { limit: 120, windowMs: 10 * MINUTE },
  /** A re-test answer or "Stop contact" on /r/[code]. */
  verdict: { limit: 60, windowMs: 10 * MINUTE },
  /** Rendering /p/[orgSlug] and a published report /p/[orgSlug]/reports/[id] (Phase 4). */
  public_report: { limit: 240, windowMs: 10 * MINUTE },
  /** The public plain-text download of a published report. */
  report_text: { limit: 60, windowMs: 10 * MINUTE },
  /** /verify/[reportId] for anyone who is not the report's own lead or auditor (it re-hashes every cited history). */
  verify_view: { limit: 120, windowMs: 10 * MINUTE },
} as const satisfies Record<string, { limit: number; windowMs: number }>;

export type RateLimitRoute = keyof typeof RATE_LIMITS;

/** The preview limit when the fake backend answers (no model is paid): the limit before Phase 7. */
export const FAKE_AI_PREVIEW_LIMIT = 120;

/** Default AI calls per hour from the public form, all visitors and orgs together (AI_GLOBAL_HOURLY_LIMIT). */
export const AI_GLOBAL_HOURLY_DEFAULT = 300;

/** Default reports one org's public form accepts per day (ORG_DAILY_SUBMISSION_LIMIT). */
export const ORG_DAILY_SUBMISSION_DEFAULT = 200;

export { AI_PAUSED_MESSAGE, RATE_LIMITED_MESSAGE, orgFullMessage } from "./rate-limit-message";

/** Rows this old are deleted (the longest window is a day, so anything past two is useless). */
export const RATE_LIMIT_KEEP_MS = 2 * 86_400_000;

/** About one request in this many also deletes old rows. */
const PRUNE_ONE_IN = 50;

export interface RateLimitResult {
  ok: boolean;
  /** Requests counted in this window, this one included. */
  count: number;
  limit: number;
}

/* ------------------------------------------------------------------ the client's address */

export interface HeaderGetter {
  get(name: string): string | null;
}

const entries = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");

/**
 * The client's address, platform-aware. On Vercel (VERCEL set): `x-real-ip`, which the platform sets to the
 * connecting client (else its own `x-forwarded-for`, which it also overwrites). Anywhere else: the LAST
 * `x-forwarded-for` entry, appended by the proxy in front of the app; the first entries are whatever the client sent
 * and are never trusted. `next start` fills `x-forwarded-for` in with the socket address when a request has none.
 * Normalized (lowercase, no brackets, port or zone); "unknown" when nothing usable is there, so every such client
 * shares one bucket, which only makes the limit stricter. Only ever hashed, never stored or logged.
 */
export function clientIp(headers: HeaderGetter, env: RateLimitEnv = process.env): string {
  const forwarded = entries(headers.get("x-forwarded-for"));
  const raw = env.VERCEL ? (entries(headers.get("x-real-ip"))[0] ?? forwarded[0]) : forwarded[forwarded.length - 1];
  return (raw && normalizeAddress(raw)) || "unknown";
}

/** An IP literal from a header entry: quotes, brackets, a port and an IPv6 zone removed. Null if it isn't one. */
export function normalizeAddress(raw: string): string | null {
  let a = raw.trim().replace(/^"(.*)"$/, "$1").toLowerCase().slice(0, 100);
  if (a.startsWith("[")) {
    const end = a.indexOf("]");
    if (end < 0) return null;
    a = a.slice(1, end);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(a)) {
    a = a.slice(0, a.lastIndexOf(":"));
  }
  a = a.split("%")[0];
  return isIP(a) ? a : null;
}

/** The 8 groups of an IPv6 address (an embedded dotted IPv4 tail included), or null. */
function ipv6Groups(ip: string): number[] | null {
  let s = ip;
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const o = v4.slice(1).map(Number);
    s = `${s.slice(0, v4.index)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const gap = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (halves.length === 1 ? head.length !== 8 : gap < 1) return null;
  const groups = [...head, ...Array<string>(gap).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * What a limit counts by: an IPv4 address as is (an IPv4-mapped IPv6 address too), an IPv6 address by its /64
 * network ("2001:db8:0:1::/64"), anything else "unknown".
 */
export function rateLimitBucket(ip: string): string {
  const a = normalizeAddress(ip);
  if (!a) return "unknown";
  if (isIP(a) === 4) return a;
  const g = ipv6Groups(a);
  if (!g) return "unknown";
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  }
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}

/** The local prototype's own requests: AUTH_MODE=local, VERCEL unset, a loopback client. Never true on Vercel. */
export function localLoopbackClient(ip: string, env: RateLimitEnv = process.env): boolean {
  return (env.AUTH_MODE ?? "").trim() === "local" && !env.VERCEL && isLoopbackAddress(ip);
}

/* ------------------------------------------------------------------ per-client limits */

/** True when the effective AI backend is the fake one (no model is paid). An unknown AI_BACKEND counts as real. */
function fakeAi(env: RateLimitEnv): boolean {
  try {
    return effectiveBackend(env) === "fake";
  } catch {
    return false;
  }
}

/** The limit for a route: RATE_LIMITS, except the preview with the fake backend (FAKE_AI_PREVIEW_LIMIT). */
export function routeLimit(route: RateLimitRoute, env: RateLimitEnv = process.env): number {
  if (route === "intake_preview" && fakeAi(env)) return FAKE_AI_PREVIEW_LIMIT;
  return RATE_LIMITS[route].limit;
}

/** The start of the fixed window that `now` falls in. */
export function windowStart(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/** HMAC of the address's bucket and the UTC day, plus the route. Contains no raw IP. */
export function rateLimitKey(ip: string, route: RateLimitRoute, now: Date): string {
  return `${hmacHex("IP_SALT", `${rateLimitBucket(ip)}|${now.toISOString().slice(0, 10)}`)}:${route}`;
}

/** Count one request and say whether it is within the limit. One atomic upsert: safe under concurrency. */
export async function consumeRateLimit(
  database: Pick<DB, "insert">,
  route: RateLimitRoute,
  ip: string,
  now: Date = new Date(),
  limit: number = routeLimit(route),
): Promise<RateLimitResult> {
  const { windowMs } = RATE_LIMITS[route];
  const [row] = await database
    .insert(rateLimits)
    .values({ key: rateLimitKey(ip, route, now), windowStart: windowStart(now, windowMs), count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  const count = row?.count ?? 1;
  return { ok: count <= limit, count, limit };
}

/** Delete windows that started more than 2 days before `now`. Returns how many rows went. */
export async function pruneRateLimits(database: Pick<DB, "delete">, now: Date = new Date()): Promise<number> {
  const gone = await database
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, new Date(now.getTime() - RATE_LIMIT_KEEP_MS)))
    .returning({ key: rateLimits.key });
  return gone.length;
}

/**
 * Add `n` to a shared counter only while it stays within `limit` (one atomic upsert; a refused request adds
 * nothing, so the count is exactly what was let through). Returns the new count, or null when refused.
 */
async function takeFromCounter(
  database: Pick<DB, "insert">,
  key: string,
  start: Date,
  n: number,
  limit: number,
): Promise<number | null> {
  if (n > limit) return null;
  const [row] = await database
    .insert(rateLimits)
    .values({ key, windowStart: start, count: n })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + ${n}` },
      setWhere: sql`${rateLimits.count} + ${n} <= ${limit}`,
    })
    .returning({ count: rateLimits.count });
  return row ? row.count : null;
}

/** A shared counter's value in a window (0 when nothing was counted). */
async function readCounter(database: Pick<DB, "select">, key: string, start: Date): Promise<number> {
  const [row] = await database
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(and(eq(rateLimits.key, key), eq(rateLimits.windowStart, start)))
    .limit(1);
  return row?.count ?? 0;
}

/** A whole-number setting, or its default when unset (lib/env.ts refuses any other value at boot). */
function wholeNumber(value: string | undefined, fallback: number): number {
  const v = (value ?? "").trim();
  return /^\d{1,9}$/.test(v) ? Number(v) : fallback;
}

/* ------------------------------------------------------------------ the global AI budget */

export const AI_BUDGET_KEY = "budget:ai_calls";

/** AI calls a public preview makes: flagPii on the report (and on "Where exactly?" when given), then structure. */
export const previewAiCalls = (hasDetail: boolean): number => (hasDetail ? 3 : 2);

export function aiHourlyLimit(env: RateLimitEnv = process.env): number {
  return wholeNumber(env.AI_GLOBAL_HOURLY_LIMIT, AI_GLOBAL_HOURLY_DEFAULT);
}

export interface AiBudgetResult {
  /** The calls may be made. */
  ok: boolean;
  /** False with the fake backend: nothing is paid, nothing is counted. */
  counted: boolean;
  /** Calls counted this hour after this request (null when refused or not counted). */
  used: number | null;
  limit: number;
}

/**
 * Reserve `calls` real model calls from this hour's budget, before they are made. With the fake backend nothing is
 * counted. Refused once the hour's total would pass AI_GLOBAL_HOURLY_LIMIT (0 turns the public form's AI off).
 */
export async function reserveAiCalls(
  database: Pick<DB, "insert">,
  calls: number,
  now: Date = new Date(),
  env: RateLimitEnv = process.env,
): Promise<AiBudgetResult> {
  const limit = aiHourlyLimit(env);
  if (fakeAi(env)) return { ok: true, counted: false, used: null, limit };
  const used = await takeFromCounter(database, AI_BUDGET_KEY, windowStart(now, HOUR), calls, limit);
  return { ok: used !== null, counted: true, used, limit };
}

/* ------------------------------------------------------------------ the per-org daily cap */

export const orgDayKey = (orgId: string) => `org_web_reports:${orgId}`;

const DAY_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Midnight of `now`'s calendar day in the display time zone (America/Toronto), as an instant. */
export function zonedDayStart(now: Date): Date {
  const p = Object.fromEntries(DAY_PARTS.formatToParts(now).map((x) => [x.type, x.value]));
  const guess = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  // The zone's offset a few hours before its midnight (Toronto changes its clocks at 2 AM, never around midnight).
  const q = Object.fromEntries(DAY_PARTS.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asIfUtc = Date.UTC(Number(q.year), Number(q.month) - 1, Number(q.day), Number(q.hour), Number(q.minute), Number(q.second));
  return new Date(guess - (asIfUtc - guess));
}

export function orgDailyLimit(env: RateLimitEnv = process.env): number {
  return wholeNumber(env.ORG_DAILY_SUBMISSION_LIMIT, ORG_DAILY_SUBMISSION_DEFAULT);
}

export interface OrgCapResult {
  ok: boolean;
  /** False for the local prototype's own requests (localLoopbackClient): not counted, never refused. */
  counted: boolean;
  /** Reports counted today after this one (null when refused or not counted). */
  used: number | null;
  limit: number;
}

/** Count one web report against the org's daily cap, or refuse it. Exactly `limit` are let through a day. */
export async function consumeOrgSubmission(
  database: Pick<DB, "insert">,
  orgId: string,
  now: Date = new Date(),
  env: RateLimitEnv = process.env,
): Promise<OrgCapResult> {
  const limit = orgDailyLimit(env);
  const used = await takeFromCounter(database, orgDayKey(orgId), zonedDayStart(now), 1, limit);
  return { ok: used !== null, counted: true, used, limit };
}

export interface OrgCapToday {
  /** Web reports counted against today's cap. */
  used: number;
  limit: number;
  /** The form is refusing reports for the rest of the day. */
  reached: boolean;
  /** AUTH_MODE=local off Vercel: this computer's own reports are not counted (the dashboard says so). */
  localAllowance: boolean;
}

/** For the dashboard: today's count against the org's cap. `orgId` comes from the signed-in member. */
export async function orgCapToday(
  database: Pick<DB, "select">,
  orgId: string,
  now: Date = new Date(),
  env: RateLimitEnv = process.env,
): Promise<OrgCapToday> {
  const limit = orgDailyLimit(env);
  const used = await readCounter(database, orgDayKey(orgId), zonedDayStart(now));
  return { used, limit, reached: used >= limit, localAllowance: (env.AUTH_MODE ?? "").trim() === "local" && !env.VERCEL };
}

/* ------------------------------------------------------------------ for server actions, pages and route handlers */

async function requestContext() {
  const [{ headers }, { db }] = await Promise.all([import("next/headers"), import("@/db/client")]);
  return { ip: clientIp(await headers()), db, now: new Date() };
}

/**
 * Count this request against `route`, using the request's own headers. Configuration problems (IP_SALT not set)
 * and database errors are thrown, never swallowed: the caller shows its own "could not do it just now" message,
 * and the server log says why (no data in it).
 */
export async function limitRequest(route: RateLimitRoute): Promise<RateLimitResult> {
  const { ip, db, now } = await requestContext();
  const result = await consumeRateLimit(db, route, ip, now);
  if (Math.floor(Math.random() * PRUNE_ONE_IN) === 0) {
    try {
      await pruneRateLimits(db, now);
    } catch (err) {
      logRateLimitFailure("pruning old rows failed", err);
    }
  }
  return result;
}

/** Reserve the model calls of one public preview (the report, plus "Where exactly?" when given). */
export async function reserveAiForPreview(hasDetail: boolean): Promise<AiBudgetResult> {
  const { db, now } = await requestContext();
  return reserveAiCalls(db, previewAiCalls(hasDetail), now);
}

/** Count one web report against its org's daily cap (`orgId` from the slug lookup, never from the request). */
export async function limitOrgSubmission(orgId: string): Promise<OrgCapResult> {
  const { ip, db, now } = await requestContext();
  if (localLoopbackClient(ip)) return { ok: true, counted: false, used: null, limit: orgDailyLimit() };
  return consumeOrgSubmission(db, orgId, now);
}

/** The dashboard's line: today's count against the signed-in member's org cap. */
export async function loadOrgCapToday(orgId: string): Promise<OrgCapToday> {
  const { db } = await import("@/db/client");
  return orgCapToday(db, orgId);
}

/** Logs the error class (and lib/crypto.ts's text-free "IP_SALT is not set"), never request data. */
export function logRateLimitFailure(what: string, err: unknown): void {
  const name = err instanceof Error ? err.name : "UnknownError";
  const config = err instanceof Error && /^IP_SALT /.test(err.message) ? `: ${err.message}` : "";
  console.error(`[rate-limit] ${what} (${name}${config})`);
}
