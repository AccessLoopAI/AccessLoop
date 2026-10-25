// lib/rate-limit.ts against a real Postgres (PGlite, with the real migrations): the atomic upsert, the fixed
// windows, separate routes, pruning, and that no raw IP ever reaches the table; the platform-aware client address
// and IPv6 /64 buckets; the preview limit (20 with a real AI backend); the global hourly AI budget and the per-org
// daily cap (exact counts, nothing counted for a refused request); the local prototype's loopback allowance.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db/client";
import * as schema from "@/db/schema";
import {
  AI_BUDGET_KEY,
  AI_GLOBAL_HOURLY_DEFAULT,
  FAKE_AI_PREVIEW_LIMIT,
  ORG_DAILY_SUBMISSION_DEFAULT,
  RATE_LIMITS,
  aiHourlyLimit,
  clientIp,
  consumeOrgSubmission,
  consumeRateLimit,
  localLoopbackClient,
  normalizeAddress,
  orgCapToday,
  orgDailyLimit,
  orgDayKey,
  orgFullMessage,
  previewAiCalls,
  pruneRateLimits,
  rateLimitBucket,
  rateLimitKey,
  reserveAiCalls,
  routeLimit,
  windowStart,
  zonedDayStart,
  type RateLimitRoute,
} from "@/lib/rate-limit";
import { startTestDb, type TestDb } from "./support/pglite-db";

let t: TestDb;
let database: DB;
const saved = { ...process.env };

beforeAll(async () => {
  process.env.IP_SALT = "test-ip-salt";
  t = await startTestDb();
  database = t.db as unknown as DB; // the limiter only uses insert/delete from the query builder
}, 60_000);

afterAll(async () => {
  await t.close();
  process.env = { ...saved };
});

beforeEach(async () => {
  await t.client.exec("delete from rate_limits");
});

const NOW = new Date("2026-10-19T15:03:20.000Z");
const IP = "203.0.113.7";

async function hits(route: RateLimitRoute, n: number, ip = IP, now = NOW) {
  const results = [];
  for (let i = 0; i < n; i++) results.push(await consumeRateLimit(database, route, ip, now));
  return results;
}

describe("consumeRateLimit (fixed windows, atomic upsert)", () => {
  it("allows N requests in a window and refuses request N+1", async () => {
    const { limit } = RATE_LIMITS.check;
    const results = await hits("check", limit + 1);
    expect(results.slice(0, limit).every((r) => r.ok)).toBe(true);
    expect(results.map((r) => r.count)).toEqual(Array.from({ length: limit + 1 }, (_, i) => i + 1));
    expect(results[limit]).toEqual({ ok: false, count: limit + 1, limit });
    // One row per key and window, counting every request.
    const rows = await t.db.select().from(schema.rateLimits);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(limit + 1);
  });

  it("counts each route separately", async () => {
    const { limit } = RATE_LIMITS.check;
    await hits("check", limit + 1);
    expect((await consumeRateLimit(database, "verdict", IP, NOW)).ok).toBe(true);
    expect((await consumeRateLimit(database, "intake_submit", IP, NOW)).count).toBe(1);
  });

  it("counts each address separately", async () => {
    await hits("check", RATE_LIMITS.check.limit + 1);
    expect((await consumeRateLimit(database, "check", "198.51.100.20", NOW)).ok).toBe(true);
  });

  it("starts again in the next window, and windows start on fixed boundaries", async () => {
    const { limit, windowMs } = RATE_LIMITS.check;
    await hits("check", limit + 1);
    const later = new Date(windowStart(NOW, windowMs).getTime() + windowMs); // first instant of the next window
    expect(await consumeRateLimit(database, "check", IP, later)).toEqual({ ok: true, count: 1, limit });
    expect(windowStart(NOW, windowMs).toISOString()).toBe("2026-10-19T15:00:00.000Z");
    expect(windowStart(new Date("2026-10-19T15:09:59.999Z"), windowMs).toISOString()).toBe("2026-10-19T15:00:00.000Z");
    const rows = await t.db.select().from(schema.rateLimits);
    expect(rows.map((r) => r.windowStart.toISOString()).sort()).toEqual([
      "2026-10-19T15:00:00.000Z",
      "2026-10-19T15:10:00.000Z",
    ]);
  });

  it("is safe under concurrency: parallel requests each get their own count", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => consumeRateLimit(database, "verdict", IP, NOW)));
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("stores no raw IP: the key is an HMAC of the address and the UTC day, plus the route", async () => {
    await hits("receipt_view", 1, "2001:db8::42");
    await hits("receipt_view", 1, IP);
    const rows = await t.db.select().from(schema.rateLimits);
    for (const r of rows) {
      expect(r.key).toMatch(/^[0-9a-f]{64}:receipt_view$/);
      expect(r.key).not.toContain(IP);
      expect(r.key).not.toContain("2001:db8");
      expect(r.key).not.toContain("203.0");
    }
    // A new UTC day gives the same address a new, unlinkable key.
    expect(rateLimitKey(IP, "check", NOW)).not.toBe(rateLimitKey(IP, "check", new Date("2026-10-20T00:00:00.000Z")));
    expect(rateLimitKey(IP, "check", NOW)).toBe(rateLimitKey(IP, "check", new Date("2026-10-19T23:59:59.000Z")));
    // And the key depends on the secret salt.
    const key = rateLimitKey(IP, "check", NOW);
    process.env.IP_SALT = "another-salt";
    expect(rateLimitKey(IP, "check", NOW)).not.toBe(key);
    process.env.IP_SALT = "test-ip-salt";
  });

  it("refuses to work without IP_SALT (never an unsalted hash)", async () => {
    delete process.env.IP_SALT;
    await expect(consumeRateLimit(database, "check", IP, NOW)).rejects.toThrow(/IP_SALT is not set/);
    process.env.IP_SALT = "test-ip-salt";
  });
});

describe("pruneRateLimits", () => {
  it("deletes only windows that started more than 2 days ago", async () => {
    const old = new Date(NOW.getTime() - 3 * 86_400_000);
    const recent = new Date(NOW.getTime() - 86_400_000);
    await consumeRateLimit(database, "check", IP, old);
    await consumeRateLimit(database, "check", IP, recent);
    await consumeRateLimit(database, "check", IP, NOW);
    expect(await pruneRateLimits(database, NOW)).toBe(1);
    const rows = await t.db.select().from(schema.rateLimits);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.windowStart.getTime() > old.getTime())).toBe(true);
  });
});

describe("clientIp (platform-aware)", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  const OFF = {};
  const ON_VERCEL = { VERCEL: "1" };

  it("off Vercel: the LAST x-forwarded-for entry (the nearest proxy's), never the first one a client wrote", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }), OFF)).toBe("10.0.0.1");
    expect(clientIp(h({ "x-forwarded-for": "198.51.100.99, 203.0.113.7" }), OFF)).toBe("203.0.113.7");
    expect(clientIp(h({ "x-forwarded-for": " 2001:DB8::1 " }), OFF)).toBe("2001:db8::1");
    // x-real-ip is whatever the client sent unless a proxy overwrites it: not read off Vercel.
    expect(clientIp(h({ "x-real-ip": "198.51.100.4" }), OFF)).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "", "x-real-ip": "198.51.100.4" }), OFF)).toBe("unknown");
    expect(clientIp(h({}), OFF)).toBe("unknown");
  });

  it("on Vercel: the platform's x-real-ip, else its x-forwarded-for", () => {
    expect(clientIp(h({ "x-real-ip": "198.51.100.4", "x-forwarded-for": "203.0.113.7" }), ON_VERCEL)).toBe("198.51.100.4");
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.7" }), ON_VERCEL)).toBe("203.0.113.7");
    expect(clientIp(h({}), ON_VERCEL)).toBe("unknown");
  });

  it("normalizes an entry and refuses anything that is not an IP literal", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.7:51234" }), OFF)).toBe("203.0.113.7");
    expect(clientIp(h({ "x-forwarded-for": "[2001:db8::7]:443" }), OFF)).toBe("2001:db8::7");
    expect(clientIp(h({ "x-forwarded-for": '"[2001:db8::7]"' }), OFF)).toBe("2001:db8::7");
    expect(clientIp(h({ "x-forwarded-for": "fe80::1%eth0" }), OFF)).toBe("fe80::1");
    for (const bad of ["x".repeat(500), "example.com", "unknown", "999.1.1.1", "1.2.3", "::g"]) {
      expect(clientIp(h({ "x-forwarded-for": bad }), OFF), bad).toBe("unknown");
    }
    expect(normalizeAddress("127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeAddress("[::1")).toBeNull();
  });
});

describe("rateLimitBucket (IPv6 by /64)", () => {
  it("keeps an IPv4 address and maps an IPv4-mapped IPv6 address to it", () => {
    expect(rateLimitBucket("203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitBucket("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitBucket("::ffff:cb00:7107")).toBe("203.0.113.7");
  });

  it("groups every address of one /64 together, and only those", () => {
    const a = rateLimitBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    expect(a).toBe("2001:db8:1:2::/64");
    expect(rateLimitBucket("2001:0db8:0001:0002::1")).toBe(a);
    expect(rateLimitBucket("2001:DB8:1:2:ffff::")).toBe(a);
    expect(rateLimitBucket("2001:db8:1:3::1")).toBe("2001:db8:1:3::/64");
    expect(rateLimitBucket("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitBucket("2001:db8::")).toBe("2001:db8:0:0::/64");
    expect(rateLimitBucket("64:ff9b::192.0.2.1")).toBe("64:ff9b:0:0::/64");
  });

  it("is 'unknown' for anything that is not an address", () => {
    for (const bad of ["unknown", "", "nope", "1:2:3:4:5:6:7:8:9", "2001:db8:::1"]) expect(rateLimitBucket(bad), bad).toBe("unknown");
  });

  it("so two addresses of one /64 share a count, and another /64 has its own", async () => {
    const { limit } = RATE_LIMITS.check;
    for (let i = 0; i < limit; i++) await consumeRateLimit(database, "check", `2001:db8:5:6::${(i + 1).toString(16)}`, NOW);
    expect((await consumeRateLimit(database, "check", "2001:db8:5:6:ffff::1", NOW)).ok).toBe(false);
    expect((await consumeRateLimit(database, "check", "2001:db8:5:7::1", NOW)).ok).toBe(true);
    expect(rateLimitKey("2001:db8:5:6::1", "check", NOW)).toBe(rateLimitKey("2001:db8:5:6:9::2", "check", NOW));
    const rows = await t.db.select().from(schema.rateLimits);
    for (const r of rows) expect(r.key).not.toContain("2001");
  });
});

describe("the limits", () => {
  it("windows of 10 minutes; checking codes is the tightest after the preview; the receipt page outlasts the submit", () => {
    for (const r of Object.values(RATE_LIMITS)) expect(r.windowMs).toBe(10 * 60_000);
    expect(RATE_LIMITS.intake_preview.limit).toBe(20);
    expect(RATE_LIMITS.intake_submit.limit).toBeGreaterThanOrEqual(60);
    expect(RATE_LIMITS.receipt_view.limit).toBeGreaterThanOrEqual(240);
    // Every report sent shows one receipt: the submit limit must bind before the receipt page's does.
    expect(RATE_LIMITS.receipt_page.limit).toBeGreaterThanOrEqual(2 * RATE_LIMITS.intake_submit.limit);
    expect(RATE_LIMITS.verdict.limit).toBeGreaterThanOrEqual(60);
    const others = Object.entries(RATE_LIMITS).filter(([route]) => route !== "intake_preview");
    expect(RATE_LIMITS.check.limit).toBe(Math.min(...others.map(([, r]) => r.limit)));
  });

  it("the preview: 20 with a real AI backend; the old 120 only when the fake backend answers (nothing is paid)", () => {
    expect(routeLimit("intake_preview", { FAKE_LLM: "0", AI_BACKEND: "api" })).toBe(20);
    expect(routeLimit("intake_preview", { FAKE_LLM: "0", AI_BACKEND: "claude-cli" })).toBe(20);
    expect(routeLimit("intake_preview", { FAKE_LLM: "0", AI_BACKEND: "gpt" })).toBe(20); // unknown: never the allowance
    expect(routeLimit("intake_preview", { FAKE_LLM: "1", AI_BACKEND: "api" })).toBe(FAKE_AI_PREVIEW_LIMIT);
    expect(routeLimit("intake_preview", {})).toBe(FAKE_AI_PREVIEW_LIMIT);
    expect(FAKE_AI_PREVIEW_LIMIT).toBe(120);
    // Every other route is the same whatever the backend.
    expect(routeLimit("check", { FAKE_LLM: "1" })).toBe(RATE_LIMITS.check.limit);
    expect(routeLimit("intake_submit", {})).toBe(RATE_LIMITS.intake_submit.limit);
  });

  it("the preview refuses request 21 in a window with a real backend", async () => {
    const real = routeLimit("intake_preview", { FAKE_LLM: "0", AI_BACKEND: "api" });
    const results = [];
    for (let i = 0; i < real + 1; i++) results.push(await consumeRateLimit(database, "intake_preview", IP, NOW, real));
    expect(results.filter((r) => r.ok)).toHaveLength(20);
    expect(results[20]).toEqual({ ok: false, count: 21, limit: 20 });
  });
});

describe("the global hourly AI budget", () => {
  const REAL = { FAKE_LLM: "0", AI_BACKEND: "api" };

  it("defaults to 300 calls an hour; a preview is 2 calls, 3 with 'Where exactly?'", () => {
    expect(AI_GLOBAL_HOURLY_DEFAULT).toBe(300);
    expect(aiHourlyLimit({})).toBe(300);
    expect(aiHourlyLimit({ AI_GLOBAL_HOURLY_LIMIT: "40" })).toBe(40);
    expect(aiHourlyLimit({ AI_GLOBAL_HOURLY_LIMIT: "lots" })).toBe(300);
    expect(previewAiCalls(false)).toBe(2);
    expect(previewAiCalls(true)).toBe(3);
  });

  it("counts nothing with the fake backend", async () => {
    expect(await reserveAiCalls(database, 3, NOW, { FAKE_LLM: "1", AI_GLOBAL_HOURLY_LIMIT: "1" })).toEqual({ ok: true, counted: false, used: null, limit: 1 });
    expect(await t.db.select().from(schema.rateLimits)).toHaveLength(0);
  });

  it("lets exactly the hour's calls through, across every client and org; a refused request uses nothing", async () => {
    const env = { ...REAL, AI_GLOBAL_HOURLY_LIMIT: "7" };
    const r1 = await reserveAiCalls(database, 3, NOW, env);
    const r2 = await reserveAiCalls(database, 3, NOW, env);
    expect([r1.used, r2.used]).toEqual([3, 6]);
    const refused = await reserveAiCalls(database, 2, NOW, env);
    expect(refused).toEqual({ ok: false, counted: true, used: null, limit: 7 });
    // The refused request added nothing, so a smaller one still fits.
    expect((await reserveAiCalls(database, 1, NOW, env)).used).toBe(7);
    expect((await reserveAiCalls(database, 1, NOW, env)).ok).toBe(false);
    const rows = await t.db.select().from(schema.rateLimits);
    expect(rows).toEqual([{ key: AI_BUDGET_KEY, windowStart: new Date("2026-10-19T15:00:00.000Z"), count: 7 }]);
    // The next hour starts again.
    expect((await reserveAiCalls(database, 2, new Date("2026-10-19T16:00:00.000Z"), env)).used).toBe(2);
  });

  it("is exact under concurrency", async () => {
    const env = { ...REAL, AI_GLOBAL_HOURLY_LIMIT: "20" };
    const results = await Promise.all(Array.from({ length: 15 }, () => reserveAiCalls(database, 2, NOW, env)));
    expect(results.filter((r) => r.ok)).toHaveLength(10);
  });

  it("AI_GLOBAL_HOURLY_LIMIT=0 turns the public form's AI off", async () => {
    expect((await reserveAiCalls(database, 2, NOW, { ...REAL, AI_GLOBAL_HOURLY_LIMIT: "0" })).ok).toBe(false);
    expect(await t.db.select().from(schema.rateLimits)).toHaveLength(0);
  });
});

describe("the per-org daily cap", () => {
  const ORG_A = "8f6b0f5e-2a43-4c1e-9d6a-0b7c1e2f3a4b";
  const ORG_B = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

  it("a day is the calendar day in Toronto", () => {
    // EDT (UTC-4) in October, EST (UTC-5) in January.
    expect(zonedDayStart(new Date("2026-10-19T15:03:20.000Z")).toISOString()).toBe("2026-10-19T04:00:00.000Z");
    expect(zonedDayStart(new Date("2026-10-20T03:59:59.000Z")).toISOString()).toBe("2026-10-19T04:00:00.000Z");
    expect(zonedDayStart(new Date("2026-10-20T04:00:00.000Z")).toISOString()).toBe("2026-10-20T04:00:00.000Z");
    expect(zonedDayStart(new Date("2026-01-15T12:00:00.000Z")).toISOString()).toBe("2026-01-15T05:00:00.000Z");
    // The days the clocks change (March 8 and November 1, 2026, at 2 AM).
    expect(zonedDayStart(new Date("2026-03-08T12:00:00.000Z")).toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(zonedDayStart(new Date("2026-11-01T12:00:00.000Z")).toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("defaults to 200 reports a day", () => {
    expect(ORG_DAILY_SUBMISSION_DEFAULT).toBe(200);
    expect(orgDailyLimit({})).toBe(200);
    expect(orgDailyLimit({ ORG_DAILY_SUBMISSION_LIMIT: "5" })).toBe(5);
  });

  it("lets exactly the day's reports through, per org; the dashboard reads the same count", async () => {
    const env = { ORG_DAILY_SUBMISSION_LIMIT: "3" };
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consumeOrgSubmission(database, ORG_A, NOW, env));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.used)).toEqual([1, 2, 3, null]);
    expect(await orgCapToday(database, ORG_A, NOW, env)).toEqual({ used: 3, limit: 3, reached: true, localAllowance: false });
    // Another org is not affected, and the next Toronto day starts again.
    expect((await consumeOrgSubmission(database, ORG_B, NOW, env)).ok).toBe(true);
    expect(await orgCapToday(database, ORG_B, NOW, env)).toMatchObject({ used: 1, reached: false });
    const tomorrow = new Date("2026-10-20T04:00:00.000Z");
    expect((await consumeOrgSubmission(database, ORG_A, tomorrow, env)).used).toBe(1);
    expect(await orgCapToday(database, ORG_A, tomorrow, { ...env, AUTH_MODE: "local" })).toEqual({ used: 1, limit: 3, reached: false, localAllowance: true });
    const keys = (await t.db.select().from(schema.rateLimits)).map((r) => r.key);
    expect(new Set(keys)).toEqual(new Set([orgDayKey(ORG_A), orgDayKey(ORG_B)]));
  });

  it("is exact under concurrency", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => consumeOrgSubmission(database, ORG_A, NOW, { ORG_DAILY_SUBMISSION_LIMIT: "5" })));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
  });

  it("tells the reporter in plain words, with the org's other ways to reach it", () => {
    const text = orgFullMessage({ name: "Maple Harbour Bank", contactPhone: "1-800-555-0101", contactEmail: "access@example.org" });
    expect(text).toBe(
      "This form has taken all the reports it can for today. Your answers are still here. Please try again tomorrow, " +
        "or tell Maple Harbour Bank by phone at 1-800-555-0101 or by email at access@example.org.",
    );
    expect(orgFullMessage({ name: "X", contactPhone: "", contactEmail: null })).toContain("or contact X another way.");
  });
});

describe("localLoopbackClient (the local prototype's allowance)", () => {
  it("only in AUTH_MODE=local, off Vercel, for a loopback client", () => {
    const local = { AUTH_MODE: "local" };
    for (const ip of ["127.0.0.1", "127.44.3.2", "::1", "::ffff:127.0.0.1"]) expect(localLoopbackClient(ip, local), ip).toBe(true);
    for (const ip of ["203.0.113.7", "10.0.0.1", "unknown", "2001:db8::1"]) expect(localLoopbackClient(ip, local), ip).toBe(false);
    expect(localLoopbackClient("127.0.0.1", { AUTH_MODE: "local", VERCEL: "1" })).toBe(false);
    expect(localLoopbackClient("127.0.0.1", { AUTH_MODE: "clerk" })).toBe(false);
    expect(localLoopbackClient("127.0.0.1", {})).toBe(false);
  });
});
