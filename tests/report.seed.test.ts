// lib/report against the real seed (docs/domain.md §7, §8, §10): a fresh in-memory PGlite seeded the way
// scripts/db-smoke.ts does (migrations, security SQL, db/seed.ts --reset), read inside withOrg, with now = 2026-10-19.
// The snapshot's facts reproduce the dashboard's numbers (the same lib/metrics functions); the validator refuses
// invented numbers, uncited sentences and foreign case refs; a generated draft passes the frozen heading checker for
// Maple Harbour; and replaying the seeded events gives the snapshot back.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { zonedNoon } from "@/lib/dates";
import { computeDashboardMetrics, thisYear, type DashboardMetrics, type MetricCase } from "@/lib/metrics";
import { AiConfigError, AiTimeoutError } from "@/lib/ai/errors";
import { CLAIM, fillTemplate } from "@/lib/report/claims";
import { citedCaseIds, reportChecks, sentenceSources } from "@/lib/report/compose";
import type { GenerateResult } from "@/lib/report/generate";
import type { Prepared } from "@/lib/report/prepare";
import { replaySnapshot } from "@/lib/report/replay";
import { manifestHash } from "@/lib/report/snapshot";
import type { ReportContent, ReportSnapshot } from "@/lib/report/types";
import { contentSentences, revalidateContent, validateSentence, validationContext } from "@/lib/report/validate";
import { startSeededDb, type SeededDb } from "./support/seeded-db";

const NOW = zonedNoon("2026-10-19");
const PERIOD = thisYear(NOW); // 2026-01-01 .. 2026-12-31

type Generate = typeof import("@/lib/report/generate").generateReport;
type WithOrg = typeof import("@/db/tenant").withOrg;
type Tx = Parameters<Parameters<WithOrg>[1]>[0];

let seeded: SeededDb | undefined;
let sql: postgres.Sql;
let orgId = "";
let leadId = "";
let withOrg: WithOrg;
let generateReport: Generate;
let prepareReport: (tx: Tx, a: { orgId: string; period: typeof PERIOD; now: Date }) => Promise<Prepared>;
let loadCases: (tx: Tx, orgId: string) => Promise<MetricCase[]>;
let prep: Extract<Prepared, { ok: true }>;
let all: MetricCase[] = [];
let m: DashboardMetrics;
const saved = { ...process.env };

const bar = (...n: number[]) => n.map((x) => `BAR-${String(x).padStart(4, "0")}`);
const refOf = (snapshot: ReportSnapshot) => new Map(snapshot.cases.map((c) => [c.id, c.ref]));

beforeAll(async () => {
  seeded = await startSeededDb();
  Object.assign(process.env, seeded.env, { FAKE_LLM: "1", AI_BACKEND: "fake" }); // db/client reads DATABASE_URL on first import
  sql = postgres(seeded.url, { prepare: false, max: 1, onnotice: () => {} });
  [{ id: orgId }] = await sql<{ id: string }[]>`select id from orgs where slug = 'maple-harbour'`;
  [{ id: leadId }] = await sql<{ id: string }[]>`select id from org_members where org_id = ${orgId} and role = 'lead'`;
  ({ withOrg } = await import("@/db/tenant"));
  ({ generateReport } = await import("@/lib/report/generate"));
  ({ prepareReport } = await import("@/lib/report/prepare"));
  ({ loadMetricCasesTx: loadCases } = await import("@/lib/metrics/load-tx"));
  const p = await withOrg({ orgId, role: "lead" }, (tx) => prepareReport(tx, { orgId, period: PERIOD, now: NOW }));
  if (!p.ok) throw new Error(`prepareReport refused: ${p.reason}`);
  prep = p;
  all = await withOrg({ orgId, role: "lead" }, (tx) => loadCases(tx, orgId));
  m = computeDashboardMetrics({ cases: all, period: PERIOD, now: NOW });
}, 240_000);

afterAll(async () => {
  await sql?.end().catch(() => {});
  if (seeded) {
    const { db } = await import("@/db/client");
    await db.$client.end({ timeout: 5 }).catch(() => {});
    await seeded.stop();
  }
  process.env = { ...saved };
});

const fact = (id: string) => prep.snapshot.facts.find((f) => f.id === id)!;
const refs = (ids: string[]) => ids.map((id) => refOf(prep.snapshot).get(id) ?? `?${id}`);

describe("the snapshot (domain §7.1)", () => {
  it("holds the 16 non-spam Maple Harbour cases received in 2026, each with its latest event's hash", () => {
    expect(prep.snapshot.cases.map((c) => c.ref)).toEqual(bar(...Array.from({ length: 16 }, (_, i) => i + 1)));
    for (const c of prep.snapshot.cases) {
      const chain = all.find((x) => x.id === c.id)!.events;
      expect(c.headHash).toBe(chain[chain.length - 1].hash);
      expect(Number.isNaN(Date.parse(c.receivedAt))).toBe(false);
    }
    expect(prep.snapshot.cases.find((c) => c.ref === "BAR-0001")).toMatchObject({
      status: "verified",
      priorityArea: "ict",
      publicSummary: "A button in the mobile banking app had no label for screen readers.",
    });
  });
});

describe("facts = the dashboard's lib/metrics numbers (domain §10 seed values)", () => {
  it("F_TOTAL 16 (web 11, email 2, phone 1, mail 1, in person 1) and F_ANON 12", () => {
    expect(fact("F_TOTAL").values).toEqual({ total: 16, web: 11, email: 2, phone: 1, mail: 1, in_person: 1, other: 0 });
    expect(fact("F_TOTAL").values.total).toBe(m.total.total.count);
    expect(fact("F_TOTAL").caseIds).toEqual(m.total.total.caseIds);
    expect(fact("F_ANON").values).toEqual({ anonymous: 12, total: 16 });
    expect(fact("F_ANON").caseIds).toEqual(m.anonymous.caseIds);
  });

  it("F_AREA: ICT 5, built environment 3, communication other 2, programs 2, employment 1, procurement 1, transportation 0", () => {
    const areas = Object.fromEntries(prep.snapshot.facts.filter((f) => f.kind === "F_AREA").map((f) => [f.id.slice(7), f.values.count]));
    expect(areas).toEqual({ employment: 1, built_environment: 3, ict: 5, communication_other: 2, procurement: 1, programs_services: 2, transportation: 0 });
    for (const [a, set] of Object.entries(m.areas.byArea)) expect(fact(`F_AREA:${a}`).caseIds).toEqual(set.caseIds);
    expect(fact("F_AREA:built_environment").values.area).toBe("The built environment");
  });

  it("F_OUTCOME: verified 7, via staff code 0, fixed not verified 4, in progress 4, closed 1", () => {
    expect(fact("F_OUTCOME").values).toEqual({ verified: 7, verifiedViaStaffCode: 0, unverified: 4, open: 4, closed: 1 });
    const o = m.outcomes;
    expect([o.verified, o.verifiedStaffRelayed, o.fixedUnverified, o.inProgress, o.closed].map((s) => s.count)).toEqual([7, 0, 4, 4, 1]);
    expect(fact("F_OUTCOME").caseIds).toEqual(m.total.total.caseIds); // the five outcomes split the period's cases
  });

  it("F_VERIFY_TIME 14 days over 7; F_ACK 4 of 4 in 24 hours; F_RETEST 10 asked, 9 answered, 1 sent back", () => {
    expect(fact("F_VERIFY_TIME").values).toEqual({ medianDays: m.medianDaysToVerifiedFix.days, verified: 7 });
    expect(fact("F_VERIFY_TIME").values.medianDays).toBe(14);
    expect(fact("F_ACK").values).toEqual({ nonAnonymous: 4, acked: 4, medianHours: 24 });
    expect(fact("F_ACK").values.medianHours).toBe(m.acknowledgement.medianHours);
    expect(fact("F_RETEST").values).toEqual({ requested: 10, answered: 9, partlyOrNotFixed: 1 });
    expect(refs(fact("F_RETEST").caseIds)).toEqual(bar(1, 3, 4, 5, 7, 9, 10, 12, 14));
    expect(fact("F_RETEST").values.partlyOrNotFixed).toBe(m.retestResponse.sentBack.rounds);
  });

  it("one F_CASE per verified or fixed case (11), in case order, with its public summary", () => {
    const cases = prep.snapshot.facts.filter((f) => f.kind === "F_CASE");
    expect(cases.map((f) => f.id)).toEqual(bar(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12).map((r) => `F_CASE:${r}`));
    expect(cases.filter((f) => f.values.outcome === "verified").map((f) => f.id.slice(7))).toEqual(bar(1, 3, 4, 5, 7, 9, 12));
    expect(fact("F_CASE:BAR-0002").values).toEqual({ publicSummary: "Phone agents ended calls made through a relay service.", outcome: "fixed_unverified", viaStaffCode: "yes" }); // phone intake: staff passed the code on
  });
});

describe("the validator on the seed's facts (domain §7.5)", () => {
  const check = (text: string, factIds: string[], claimId?: string) => {
    const ctx = validationContext(prep.snapshot);
    const claim = claimId ? prep.claims.find((c) => c.claimId === claimId) : undefined;
    const r = validateSentence({ text, factIds }, ctx, claim);
    return r.ok ? "ok" : r.reasons.map((x) => (x.detail ? `${x.code}:${x.detail}` : x.code)).join(" ");
  };

  it("accepts a correct sentence: the template, and a plain-language rewording that keeps every value", () => {
    for (const c of prep.claims) expect(check(fillTemplate(c), c.factIds, c.claimId), c.claimId).toBe("ok");
    expect(
      check(
        "Of these, 7 were fixed and confirmed by the person who reported them; 4 were fixed but not yet confirmed, 4 are still being worked on, and 1 was closed without a change.",
        ["F_OUTCOME"],
        CLAIM.outcome,
      ),
    ).toBe("ok");
  });

  it("rejects an invented number (and a year outside the period)", () => {
    expect(check("Of these, 9 were fixed and confirmed by the person who reported them.", ["F_OUTCOME"])).toBe("invented_number:9");
    expect(check("In 2025, we received 16 pieces of feedback about accessibility.", ["F_TOTAL"])).toBe("invented_number:2025");
    expect(check("In 2026, we received 16 pieces of feedback about accessibility.", ["F_TOTAL"])).toBe("ok");
  });

  it("rejects an uncited sentence and a citation of a fact that is not in the snapshot", () => {
    expect(check("We take accessibility seriously.", [])).toBe("no_facts");
    expect(check("Feedback received in this area: 0.", ["F_AREA:parking"])).toMatch(/^unknown_fact:F_AREA:parking( |$)/);
  });

  it("rejects a foreign or uncited case ref, and allows a cited one", () => {
    const own = "Fixed and confirmed by the person who reported it: A button in the mobile banking app had no label for screen readers.";
    expect(check(`${own} See BAR-0001.`, ["F_CASE:BAR-0001"])).toBe("ok");
    expect(check(`${own} See BAR-0003.`, ["F_CASE:BAR-0001"])).toBe("uncited_case_ref:BAR-0003");
    expect(check(`${own} See BAR-0099.`, ["F_CASE:BAR-0001"])).toBe("uncited_case_ref:BAR-0099");
  });

  it("rejects placeholders, contact details, dropped slots and empty text", () => {
    expect(check("Of these, [NUMBER] were fixed and confirmed by the person who reported them.", ["F_OUTCOME"])).toBe("placeholder");
    expect(check("Of these, {verified} were fixed and confirmed by the person who reported them.", ["F_OUTCOME"])).toBe("placeholder");
    expect(check("[PERSON] reported 7 barriers that were fixed and confirmed.", ["F_OUTCOME"])).toBe("placeholder");
    expect(check("Call 416-555-0188 for details.", ["F_OUTCOME"])).toMatch(/^contact_detail:PHONE( |$)/);
    expect(check("Most were fixed and confirmed by the person who reported them.", ["F_OUTCOME"], CLAIM.outcome)).toMatch(/^dropped_slot:verified/);
    expect(check("Seven were fixed and confirmed by the person who reported them, 4 were fixed but not yet confirmed, 4 are still in progress, and 1 was closed without a change.", ["F_OUTCOME"], CLAIM.outcome)).toBe("dropped_slot:verified");
    expect(check("   ", ["F_OUTCOME"])).toBe("empty");
  });
});

describe("a generated draft for Maple Harbour (domain §7.6, §7.7)", () => {
  let first: Extract<GenerateResult, { ok: true }>;
  let row: { snapshot: ReportSnapshot; manifest_hash: string; content: ReportContent; heading_check: unknown; title: string; status: string; area_text: unknown };

  beforeAll(async () => {
    const r = await generateReport({ orgId, memberId: leadId, period: PERIOD, now: NOW });
    if (!r.ok) throw new Error(r.message);
    first = r;
    [row] = await sql`select snapshot, manifest_hash, content, heading_check, title, status, area_text from reports where id = ${r.id}`;
  }, 120_000);

  it("is stored as a draft whose snapshot survives the jsonb round trip with the same fingerprint", () => {
    expect(row.status).toBe("draft");
    expect(row.title).toBe("Accessibility progress report 2026, version 1");
    expect(row.area_text).toEqual({});
    expect(manifestHash(row.snapshot)).toBe(row.manifest_hash);
    expect(row.manifest_hash).toBe(manifestHash(prep.snapshot));
    expect(row.heading_check).toEqual(first.checks.results);
  });

  it("is worded by the fake backend, which returns each template, so no sentence falls back", () => {
    expect(row.content.phrase).toMatchObject({ ok: true, backend: "fake", fallbacks: 0 });
    const sentences = contentSentences(row.content);
    expect(sentences.length).toBe(prep.claims.length);
    for (const s of sentences) expect(s.text).toBe(fillTemplate(prep.claims.find((c) => c.claimId === s.id)!));
    expect(revalidateContent(row.content, row.snapshot)).toEqual({ ok: true, failed: [] });
  });

  it("passes the frozen heading checker with only warnings while the text boxes are empty", () => {
    const checks = reportChecks(row.content, {}, null);
    expect(checks.passes).toBe(true);
    expect(checks.results.filter((r) => !r.ok).every((r) => r.severity === "warning")).toBe(true);
    expect(checks.results.filter((r) => !r.ok).map((r) => r.id).sort()).toEqual(
      ["W:built_environment", "W:communication_other", "W:consultations", "W:employment", "W:ict", "W:procurement", "W:programs_services"],
    );
    expect(checks.results.filter((r) => r.id.startsWith("R5")).every((r) => r.ok)).toBe(true);
    expect(checks).toMatchObject({ toWrite: 7, blockers: [], canSignOff: false });
    const areaText = Object.fromEntries(row.content.settings.planAreas.map((a) => [a, "Our progress in this area."]));
    expect(reportChecks(row.content, areaText, "We consulted our advisory group of people with disabilities.").canSignOff).toBe(true);
  });

  it("has the demo's headings and a Feedback section of cited sentences that says 'confirmed by the person who reported'", () => {
    const headings = row.content.sections.map((s) => s.heading);
    expect(headings).toEqual([
      "General",
      "Employment",
      "The built environment",
      "Information and communication technologies",
      "Communication, other than information and communication technologies",
      "The procurement of goods, services and facilities",
      "The design and delivery of programs and services",
      "Consultations",
      "Feedback",
    ]);
    const feedback = row.content.sections.find((s) => s.key === "feedback")!;
    const sentences = contentSentences({ sections: [feedback] });
    expect(sentences.length).toBeGreaterThan(2);
    expect(sentences.every((s) => s.factIds.length > 0)).toBe(true);
    expect(sentences.map((s) => s.text).join(" ")).toContain("confirmed by the person who reported");
    expect(sentences.map((s) => s.text).join(" ")).not.toContain("Daniel");
    const total = sentences[0];
    expect(total.id).toBe(CLAIM.total);
    expect(sentenceSources(total, row.snapshot).map((c) => c.ref)).toEqual(bar(...Array.from({ length: 16 }, (_, i) => i + 1)));
    const built = row.content.sections.find((s) => s.key === "area:built_environment")!;
    expect(contentSentences({ sections: [built] }).map((s) => s.text)).toEqual(["Feedback received in this area: 3."]);
    const general = row.content.sections[0].blocks.map((b) => (b.kind === "org" ? b.text : "")).join(" ");
    for (const v of ["Director, Accessibility and Inclusion", "100 Example Street, Toronto, ON M5V 0A0", "1-800-555-0100", "accessibility@example.com", "alternate format"]) {
      expect(general).toContain(v);
    }
    expect(citedCaseIds(row.content, row.snapshot)).toHaveLength(16);
  });

  it("numbers each new version of the same period", async () => {
    const again = await generateReport({ orgId, memberId: leadId, period: PERIOD, now: NOW });
    expect(again.ok && again.title).toBe("Accessibility progress report 2026, version 2");
  });

  it("uses every template, says so, when the AI wording step fails; an unknown AI backend stays loud", async () => {
    const r = await generateReport({ orgId, memberId: leadId, period: PERIOD, now: NOW, phrase: () => Promise.reject(new AiTimeoutError("claude-cli", 60_000)) });
    expect(r.ok && r.phraseOk).toBe(false);
    if (!r.ok) return;
    const [{ content }] = await sql<{ content: ReportContent }[]>`select content from reports where id = ${r.id}`;
    expect(content.phrase).toMatchObject({ ok: false, error: "AiTimeoutError", fallbacks: prep.claims.length });
    expect(contentSentences(content).every((s) => s.fallback)).toBe(true);
    await expect(generateReport({ orgId, memberId: leadId, period: PERIOD, now: NOW, phrase: () => Promise.reject(new AiConfigError("bad")) })).rejects.toThrow(AiConfigError);
  });

  it("a fixed case whose reporter chose \"Don't use AI on my report\" keeps its template: its sentence is never sent to the AI", async () => {
    const sent: string[] = [];
    await sql`update cases set ai_opt_out = true where org_id = ${orgId} and ref = 'BAR-0003'`; // test fixture only
    try {
      const r = await generateReport({
        orgId, memberId: leadId, period: PERIOD, now: NOW,
        phrase: async (claims) => {
          sent.push(...claims.map((c) => c.claimId));
          return { value: claims.map((c) => ({ claimId: c.claimId, text: fillTemplate(c) })), meta: { backend: "api", model: "stub", promptSha: "x", latencyMs: 1 } };
        },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(sent).not.toContain(CLAIM.case("BAR-0003"));
      expect(sent).toContain(CLAIM.case("BAR-0001"));
      expect(sent).toHaveLength(prep.claims.length - 1);
      const [{ content }] = await sql<{ content: ReportContent }[]>`select content from reports where id = ${r.id}`;
      const own = contentSentences(content).find((x) => x.id === CLAIM.case("BAR-0003"))!;
      expect(own.fallback).toBe(true);
      expect(own.text).toBe(fillTemplate(prep.claims.find((c) => c.claimId === CLAIM.case("BAR-0003"))!));
    } finally {
      await sql`update cases set ai_opt_out = false where org_id = ${orgId} and ref = 'BAR-0003'`;
    }
  });

  it("a period with no feedback still makes a draft that passes the required checks", async () => {
    const r = await generateReport({ orgId, memberId: leadId, period: { start: "2020-01-01", end: "2020-12-31" }, now: NOW });
    expect(r.ok && r.checks.passes).toBe(true);
    if (!r.ok) return;
    const [{ content }] = await sql<{ content: ReportContent }[]>`select content from reports where id = ${r.id}`;
    const feedback = content.sections.find((s) => s.key === "feedback")!;
    expect(contentSentences({ sections: [feedback] }).map((s) => s.text)).toEqual(["We received no feedback about accessibility in this reporting period."]);
  });
});

describe("replay of the seeded events (domain §8 check 3)", () => {
  it("matches the snapshot for every case, recomputes the same facts, and agrees with the cases projection", async () => {
    const r = replaySnapshot(prep.snapshot, all);
    expect(r.ok).toBe(true);
    expect(r.facts).toEqual({ ok: true, mismatched: [] });
    expect(r.rows.every((x) => x.ok && x.headFound && x.laterUpdates === 0)).toBe(true);
    const projection = await sql<{ id: string; status: string; priority_area: string | null; public_summary: string | null }[]>`
      select id, status, priority_area, public_summary from cases where org_id = ${orgId}`;
    for (const p of projection) {
      const row = r.rows.find((x) => x.caseId === p.id)!;
      expect({ status: row.replayed!.status, area: row.replayed!.priorityArea, summary: row.replayed!.publicSummary ?? "" }).toEqual({
        status: p.status,
        area: p.priority_area,
        summary: p.public_summary ?? "",
      });
    }
  });

  it("after one more event, replaying to the old head still matches (1 later update) and a new snapshot is fingerprinted differently", async () => {
    const { transition } = await import("@/lib/state-machine");
    const [{ id: facilities }] = await sql<{ id: string }[]>`select id from org_members where org_id = ${orgId} and display_name = 'Facilities team'`;
    const bar15 = prep.snapshot.cases.find((c) => c.ref === "BAR-0015")!;
    await withOrg({ orgId, role: "lead" }, (tx) =>
      transition(tx, orgId, bar15.id, { kind: "assign", memberId: facilities }, { kind: "staff", memberId: leadId, role: "lead" }),
    );
    const now = await withOrg({ orgId, role: "lead" }, (tx) => loadCases(tx, orgId));
    const r = replaySnapshot(prep.snapshot, now);
    expect(r.ok).toBe(true);
    expect(r.rows.find((x) => x.ref === "BAR-0015")).toMatchObject({ ok: true, laterUpdates: 1 });
    expect(r.rows.filter((x) => x.laterUpdates > 0).map((x) => x.ref)).toEqual(["BAR-0015"]);

    const later = await withOrg({ orgId, role: "lead" }, (tx) => prepareReport(tx, { orgId, period: PERIOD, now: NOW }));
    if (!later.ok) throw new Error(later.reason);
    expect(later.snapshot.cases.find((c) => c.ref === "BAR-0015")!.status).toBe("assigned");
    expect(manifestHash(later.snapshot)).not.toBe(manifestHash(prep.snapshot));
    expect(later.snapshot.facts).toEqual(prep.snapshot.facts); // still "in progress": the facts do not move
  });

  it("refuses to build a report over a case history that does not check out", async () => {
    const bar3 = prep.snapshot.cases.find((c) => c.ref === "BAR-0003")!;
    // Only possible with the append-only trigger switched off (domain §8 demo beat): a superuser on this throwaway DB.
    await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL session_replication_role = replica");
      const hit = await tx`update case_events set payload = payload || '{"note":"edited"}'::jsonb
        where case_id = ${bar3.id} and seq = 4 returning id`;
      expect(hit).toHaveLength(1);
    });
    const r = await generateReport({ orgId, memberId: leadId, period: PERIOD, now: NOW });
    expect(r).toMatchObject({ ok: false, code: "broken_chain", refs: ["BAR-0003"] });
    if (!r.ok) expect(r.message).toBe("The records for BAR-0003 don't check out, so a report can't be built from it. Open that case to see the history.");
  });
});
