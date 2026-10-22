// lib/metrics against the real seed (docs/domain.md §10 "Expected values for the seed"): a fresh in-memory
// PGlite seeded the way scripts/db-smoke.ts does (migrations, security SQL, db/seed.ts --reset), read through the
// real loader (lib/metrics/load.ts, inside withOrg), with now = 2026-10-19. Every number of the domain table is
// asserted exactly, with the cases behind it, and every metric's inbox filter selects exactly its cases.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { zonedNoon } from "@/lib/dates";
import {
  AREA_NOT_CLASSIFIED,
  NO_REAL_AI_YET,
  applyInboxFilter,
  computeDashboardMetrics,
  inboxHref,
  parseInboxFilter,
  replayCase,
  thisYear,
  type CaseSet,
  type DashboardMetrics,
  type InboxFilter,
  type MetricCase,
  type RoundSet,
} from "@/lib/metrics";
import { startSeededDb, type SeededDb } from "./support/seeded-db";

const NOW = zonedNoon("2026-10-19"); // noon in the display time zone (America/Toronto)
const PERIOD = thisYear(NOW); // 2026-01-01 .. 2026-12-31

let seeded: SeededDb | undefined;
let demoCases: MetricCase[] = [];
let otherCases: MetricCase[] = [];
let projection: { id: string; ref: string; status: string; priority_area: string | null; verified_at: Date | null; received_at: Date; public_summary: string | null }[] = [];
let m: DashboardMetrics;
const saved = { ...process.env };

const refOf = new Map<string, string>();
const refs = (s: { caseIds: string[] }) => s.caseIds.map((id) => refOf.get(id) ?? `?${id}`).sort();
const bar = (...n: number[]) => n.map((x) => `BAR-${String(x).padStart(4, "0")}`).sort();

beforeAll(async () => {
  seeded = await startSeededDb();
  Object.assign(process.env, seeded.env); // db/client reads DATABASE_URL when it is first imported
  const sql = postgres(seeded.url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    const [demo] = await sql<{ id: string }[]>`select id from orgs where slug = 'maple-harbour'`;
    const [other] = await sql<{ id: string }[]>`select id from orgs where slug = 'lakeview-telecom'`;
    projection = await sql`select id, ref, status, priority_area, verified_at, received_at, public_summary
      from cases where org_id = ${demo.id} order by seq`;
    const { loadMetricCases } = await import("@/lib/metrics/load");
    demoCases = await loadMetricCases({ orgId: demo.id, role: "lead" });
    otherCases = await loadMetricCases({ orgId: other.id, role: "lead" });
  } finally {
    await sql.end();
  }
  for (const c of demoCases) refOf.set(c.id, c.ref);
  m = computeDashboardMetrics({ cases: demoCases, period: PERIOD, now: NOW });
}, 240_000);

afterAll(async () => {
  if (seeded) {
    const { db } = await import("@/db/client");
    await db.$client.end({ timeout: 5 }).catch(() => {});
    await seeded.stop();
  }
  process.env = { ...saved };
});

describe("the loader", () => {
  it("reads the 16 seeded Maple Harbour cases with their chains, inside the org (none of Lakeview's)", () => {
    expect(demoCases.map((c) => c.ref)).toEqual(bar(...Array.from({ length: 16 }, (_, i) => i + 1)));
    expect(demoCases.every((c) => c.events.length >= 3 && c.events.every((e) => /^[0-9a-f]{64}$/.test(e.hash ?? "")))).toBe(true);
    expect(otherCases).toEqual([]);
  });

  it("replays every case from its events to the same state as the cases projection", () => {
    for (const row of projection) {
      const c = demoCases.find((x) => x.id === row.id)!;
      const r = replayCase(c);
      expect({ ref: r.ref, status: r.status, area: r.priorityArea, verifiedAt: r.verifiedAt?.getTime() ?? null,
        receivedAt: r.receivedAt.getTime(), publicSummary: r.publicSummary ?? "" }).toEqual({
        ref: row.ref, status: row.status, area: row.priority_area, verifiedAt: row.verified_at?.getTime() ?? null,
        receivedAt: row.received_at.getTime(), publicSummary: row.public_summary ?? "" });
      expect(r.headHash).toBe(c.events[c.events.length - 1].hash);
    }
  });
});

describe("domain §10 expected values (now = 2026-10-19)", () => {
  it("total received: 16 (web 11, email 2, phone 1, mail 1, in person 1)", () => {
    expect(m.total.total.count).toBe(16);
    const by = Object.fromEntries(Object.entries(m.total.byChannel).map(([k, v]) => [k, v.count]));
    expect(by).toEqual({ web: 11, email: 2, phone: 1, mail: 1, in_person: 1, other: 0 });
    expect(refs(m.total.byChannel.email)).toEqual(bar(4, 13));
    expect(refs(m.total.byChannel.phone)).toEqual(bar(2));
    expect(refs(m.total.byChannel.mail)).toEqual(bar(8));
    expect(refs(m.total.byChannel.in_person)).toEqual(bar(6));
    expect(m.channels.map((r) => [r.label, r.cases.count])).toEqual([
      ["Web form", 11], ["Email", 2], ["Phone", 1], ["Mail", 1], ["In person", 1],
    ]);
  });

  it("anonymous: 12", () => {
    expect(m.anonymous.count).toBe(12);
    expect(refs(m.anonymous)).toEqual(bar(1, 3, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16));
  });

  it("status: verified 7, fixed not verified 4, new 1, triaged 1, assigned 1, waiting for reporter 1, closed 1", () => {
    const st = Object.fromEntries(Object.entries(m.statuses).map(([k, v]) => [k, v.count]));
    expect(st).toEqual({ new: 1, triaged: 1, assigned: 1, retest_open: 1, verified: 7, fixed_unverified: 4, closed: 1 });
    expect(refs(m.statuses.verified)).toEqual(bar(1, 3, 4, 5, 7, 9, 12));
    expect(refs(m.statuses.fixed_unverified)).toEqual(bar(2, 6, 8, 10));
    expect(refs(m.statuses.new)).toEqual(bar(16));
    expect(refs(m.statuses.triaged)).toEqual(bar(15));
    expect(refs(m.statuses.assigned)).toEqual(bar(13));
    expect(refs(m.statuses.retest_open)).toEqual(bar(14));
    expect(refs(m.statuses.closed)).toEqual(bar(11));
    expect(m.openBarriers.total.count).toBe(4);
    expect(refs(m.openBarriers.total)).toEqual(bar(13, 14, 15, 16));
  });

  it("verified-fix rate (D6): 7 / 12 (fix logged: 7 verified, 4 fixed not verified, 1 waiting for the reporter BAR-0014); 0 via staff-relayed codes", () => {
    const v = m.verifiedFixRate;
    expect([v.verified.count, v.fixLogged.count]).toEqual([7, 12]);
    expect(v.rate).toBe(7 / 12);
    expect(refs(v.verified)).toEqual(bar(1, 3, 4, 5, 7, 9, 12));
    expect(refs(v.fixLogged)).toEqual(refs(m.funnel.fixLogged));
    expect(refs(v.notVerified)).toEqual(bar(2, 6, 8, 10, 14));
    expect(refs(v.fixedUnverified)).toEqual(bar(2, 6, 8, 10)); // BAR-0010 "can't check"; the other three had no re-test
    expect(refs(v.waiting)).toEqual(bar(14));
    expect([v.backInProgress.count, v.closedAfterFix.count]).toEqual([0, 0]);
    expect(v.verifiedStaffRelayed.count).toBe(0);
    expect(m.outcomes.verifiedStaffRelayed.count).toBe(0);
  });

  it("closed as not accessibility feedback (D6): 0", () => {
    expect(m.notFeedback.count).toBe(0);
    expect(m.notFeedback.filter).toEqual({ from: "2026-01-01", to: "2026-12-31", notFeedback: "yes" });
  });

  it("median days to verified fix: 14 (7, 11, 12, 14, 21, 29, 34)", () => {
    expect(m.medianDaysToVerifiedFix.days).toBe(14);
    expect(m.medianDaysToVerifiedFix.perCase.map((p) => p.days).sort((a, b) => a - b)).toEqual([7, 11, 12, 14, 21, 29, 34]);
    expect(refs(m.medianDaysToVerifiedFix.cases)).toEqual(bar(1, 3, 4, 5, 7, 9, 12));
  });

  it("re-test response rate: 9 / 10 (\"I can't check right now\" counts as answered; the open BAR-0014 does not)", () => {
    const r = m.retestResponse;
    expect([r.answered.rounds, r.requested.rounds]).toEqual([9, 10]);
    expect(r.rate).toBe(0.9);
    expect(refs(r.requested)).toEqual(bar(1, 3, 4, 5, 7, 9, 10, 12, 14)); // BAR-0003 had two rounds
    expect(refs(r.answered)).toEqual(bar(1, 3, 4, 5, 7, 9, 10, 12));
    expect([r.unanswered.rounds, ...refs(r.unanswered)]).toEqual([1, "BAR-0014"]);
    expect([r.sentBack.rounds, ...refs(r.sentBack)]).toEqual([1, "BAR-0003"]); // F_RETEST: "Partly" in round 1
  });

  it("acknowledgement compliance: 4 / 4 non-anonymous cases", () => {
    const a = m.acknowledgement;
    expect([a.acknowledged.count, a.required.count, a.missing.count]).toEqual([4, 4, 0]);
    expect(a.rate).toBe(1);
    expect(refs(a.required)).toEqual(bar(2, 4, 8, 13));
    expect(a.medianHours).toBe(24); // the seed records each manual acknowledgement one day after receipt
    // Phase 7 honesty: the seed's staff records carry no typed date (written when given), so none was recorded late.
    expect(a.recordedLate.count).toBe(0);
  });

  it("reporter-correction rate: \"No real-AI summaries yet\" (all seed summaries are backend \"seed\"): a count of 0, not 0%", () => {
    expect(m.correctionRate.kind).toBe("no_real_ai_yet");
    expect(m.correctionRate.count).toBe(0);
    expect(m.correctionRate.rate).toBeNull();
    if (m.correctionRate.kind === "no_real_ai_yet") expect(m.correctionRate.label).toBe(NO_REAL_AI_YET);
  });

  it("loop funnel: reported 16 -> triaged 14 -> assigned 13 -> fix logged 12 -> verified by reporter 7", () => {
    const f = m.funnel;
    expect([f.reported, f.triaged, f.assigned, f.fixLogged, f.verified].map((s) => s.count)).toEqual([16, 14, 13, 12, 7]);
    expect(refs(f.reported).filter((r) => !refs(f.triaged).includes(r))).toEqual(bar(11, 16));
    expect(refs(f.triaged).filter((r) => !refs(f.assigned).includes(r))).toEqual(bar(15));
    expect(refs(f.assigned).filter((r) => !refs(f.fixLogged).includes(r))).toEqual(bar(13));
  });

  it("received per month (2026): Jan 2, Feb 2, Mar 2, Apr 1, May 2, Jun 2, Jul 1, Aug 0, Sep 3, Oct 1", () => {
    expect(m.monthly.map((r) => r.month)).toEqual(
      ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"].map((mm) => `2026-${mm}`),
    );
    expect(m.monthly.map((r) => r.received.count)).toEqual([2, 2, 2, 1, 2, 2, 1, 0, 3, 1]);
    expect(refs(m.monthly[8].received)).toEqual(bar(13, 14, 15));
  });

  it("verified per month (2026): Jan 1, Mar 3, May 2, Aug 1", () => {
    expect(m.monthly.map((r) => r.verified.count)).toEqual([1, 0, 3, 0, 2, 0, 0, 1, 0, 0]);
    expect(refs(m.monthly[0].verified)).toEqual(bar(1));
    expect(refs(m.monthly[2].verified)).toEqual(bar(3, 4, 5));
    expect(refs(m.monthly[4].verified)).toEqual(bar(7, 9));
    expect(refs(m.monthly[7].verified)).toEqual(bar(12));
  });

  it("by priority area: ICT 5, built environment 3, communication other 2, programs and services 2, employment 1, procurement 1, not classified 2", () => {
    const a = m.areas;
    expect(Object.fromEntries(Object.entries(a.byArea).map(([k, v]) => [k, v.count]))).toEqual({
      ict: 5, built_environment: 3, communication_other: 2, programs_services: 2, employment: 1, procurement: 1, transportation: 0,
    });
    expect(refs(a.notClassified)).toEqual(bar(11, 16)); // BAR-0011 closed as duplicate, BAR-0016 new
    expect(a.rows.map((r) => [r.heading, r.cases.count])).toEqual([
      ["Information and communication technologies", 5],
      ["The built environment", 3],
      ["Communication, other than information and communication technologies", 2],
      ["The design and delivery of programs and services", 2],
      ["Employment", 1],
      ["The procurement of goods, services and facilities", 1],
      [AREA_NOT_CLASSIFIED, 2],
    ]);
  });

  it("needs attention: BAR-0016 (redaction review), BAR-0014 (re-test open 25 days), BAR-0013 (assigned 40 days, no fix); no unacknowledged cases", () => {
    expect(m.needsAttention.items.map((i) => [i.ref, i.reason, i.days])).toEqual([
      ["BAR-0016", "redaction", 5],
      ["BAR-0014", "retest", 25],
      ["BAR-0013", "stalled", 40],
    ]);
    expect(m.needsAttention.byReason.unacknowledged.count).toBe(0);
    expect(refs(m.needsAttention.all)).toEqual(bar(13, 14, 16));
  });

  it("outcomes (F_OUTCOME) split the 16 cases: 7 verified, 4 fixed not verified, 4 in progress, 1 closed", () => {
    const o = m.outcomes;
    expect([o.verified, o.verifiedStaffRelayed, o.fixedUnverified, o.inProgress, o.closed].map((s) => s.count)).toEqual([7, 0, 4, 4, 1]);
  });

  it("the Lakeview org has no cases: zeros, null rates, and no real-AI summaries yet", () => {
    const o = computeDashboardMetrics({ cases: otherCases, period: PERIOD, now: NOW });
    expect(o.total.total.count).toBe(0);
    expect(o.verifiedFixRate.rate).toBeNull();
    expect(o.medianDaysToVerifiedFix.days).toBeNull();
    expect(o.acknowledgement.rate).toBeNull();
    expect(o.correctionRate.kind).toBe("no_real_ai_yet");
    expect(o.needsAttention.items).toEqual([]);
  });
});

/** Every CaseSet / RoundSet anywhere in the metrics, with its path. */
function setsOf(value: unknown, path = "metrics"): [string, CaseSet | RoundSet][] {
  if (!value || typeof value !== "object" || value instanceof Date) return [];
  const v = value as Record<string, unknown>;
  if (Array.isArray(v.caseIds) && v.filter && typeof v.filter === "object") return [[path, v as unknown as CaseSet | RoundSet]];
  return Object.entries(v).flatMap(([k, x]) => setsOf(x, `${path}.${k}`));
}

describe("every number links to exactly its cases (inbox filters)", () => {
  it("each metric's inbox filter selects exactly the case IDs behind the number", () => {
    const all = setsOf(m);
    expect(all.length).toBeGreaterThan(60);
    for (const [path, s] of all) {
      expect(applyInboxFilter(demoCases, s.filter, NOW).sort(), path).toEqual([...s.caseIds].sort());
    }
  });

  it("each filter survives the trip through the inbox URL (inboxHref -> parseInboxFilter)", () => {
    for (const [path, s] of setsOf(m)) {
      const href = inboxHref(s.filter);
      const query = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
      const parsed: InboxFilter = parseInboxFilter(new URLSearchParams(query));
      expect(parsed, `${path}: ${href}`).toEqual(s.filter);
      expect(applyInboxFilter(demoCases, parsed, NOW).sort(), path).toEqual([...s.caseIds].sort());
    }
  });

  it("the CLAUDE.md route params select what they say on the seed", () => {
    const pick = (q: string) => applyInboxFilter(demoCases, parseInboxFilter(new URLSearchParams(q)), NOW).map((id) => refOf.get(id)).sort();
    expect(pick("status=verified")).toEqual(bar(1, 3, 4, 5, 7, 9, 12));
    expect(pick("area=ict")).toEqual(bar(1, 5, 10, 14, 15));
    expect(pick("area=none")).toEqual(bar(11, 16));
    expect(pick("channel=email&channel=mail")).toEqual(bar(4, 8, 13));
    expect(pick("month=2026-09")).toEqual(bar(13, 14, 15));
    expect(pick("attention=retest")).toEqual(bar(14));
    expect(pick("attention=stalled&attention=redaction")).toEqual(bar(13, 16));
    expect(pick("status=bogus&area=nowhere&month=2026-13&attention=x")).toEqual(pick("")); // unknown values ignored
    expect(pick("")).toHaveLength(16);
  });
});
