// /verify (docs/domain.md §8) on a freshly seeded PGlite (the tests/report.seed.test.ts pattern): a generated draft
// checks out for its lead ("All records match", one row per cited case); the `cases` projection is never trusted
// (changing it changes nothing); who may see a check (lead and auditor of the org for a draft; anyone for a published
// report; never an owner's draft view or another org); a later event is information only; the demo's tampering
// (jsonb_set inflating the verified count) turns check 1 red with the plain explanation; UPDATE on case_events is
// refused by the append-only trigger; and with the trigger switched off (only possible on this throwaway database),
// an edited event turns check 2 red at exactly the record verifyCaseChain names, and the drawing breaks there too.
// The report is signed off and published half-way through, so from then on the sign-off lock (D7(a)) refuses the
// tampering UPDATE and the test switches triggers off for it; check 5 (the signature) turns red with check 1.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { zonedNoon } from "@/lib/dates";
import { thisYear } from "@/lib/metrics";
import type { EvidenceCheck } from "@/lib/report/evidence";
import type { ReportContent, ReportSnapshot } from "@/lib/report/types";
import { startSeededDb, type SeededDb } from "./support/seeded-db";

const NOW = zonedNoon("2026-10-19");
const PERIOD = thisYear(NOW);

type WithOrg = typeof import("@/db/tenant").withOrg;
type Verify = typeof import("@/lib/report/verify");
type Access = typeof import("@/lib/report/access");

let seeded: SeededDb | undefined;
let sql: postgres.Sql;
let orgId = "";
let otherOrgId = "";
let leadId = "";
let reportId = "";
let withOrg: WithOrg;
let verify: Verify;
let access: Access;
const saved = { ...process.env };

const bar = (...n: number[]) => n.map((x) => `BAR-${String(x).padStart(4, "0")}`);

async function checkAsLead(): Promise<EvidenceCheck> {
  return withOrg({ orgId, role: "lead" }, async (tx) => {
    const target = await verify.loadVerifyTarget(tx, orgId, reportId, { publishedOnly: false });
    if (!target) throw new Error("report not found");
    return verify.runEvidenceCheck(tx, orgId, target);
  });
}

beforeAll(async () => {
  seeded = await startSeededDb();
  // AUTH_MODE=local + SESSION_SECRET: sign-off derives its signing key (lib/report/signing-key.ts).
  Object.assign(process.env, seeded.env, { FAKE_LLM: "1", AI_BACKEND: "fake", AUTH_MODE: "local", SESSION_SECRET: "test-session-secret" }); // db/client reads DATABASE_URL on first import
  sql = postgres(seeded.url, { prepare: false, max: 1, onnotice: () => {} });
  [{ id: orgId }] = await sql<{ id: string }[]>`select id from orgs where slug = 'maple-harbour'`;
  [{ id: otherOrgId }] = await sql<{ id: string }[]>`select id from orgs where slug = 'lakeview-telecom'`;
  [{ id: leadId }] = await sql<{ id: string }[]>`select id from org_members where org_id = ${orgId} and role = 'lead'`;
  ({ withOrg } = await import("@/db/tenant"));
  verify = await import("@/lib/report/verify");
  access = await import("@/lib/report/access");
  const { generateReport } = await import("@/lib/report/generate");
  const r = await generateReport({ orgId, memberId: leadId, period: PERIOD, now: NOW });
  if (!r.ok) throw new Error(`generateReport refused: ${r.code}`);
  reportId = r.id;
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

describe("the evidence check of a fresh draft", () => {
  it("all four checks pass: one row per cited case (all 16), every history intact, 'All records match.'", async () => {
    const c = await checkAsLead();
    expect(c.line).toBe("All records match.");
    expect(c.allOk).toBe(true);
    expect(c.rows.map((r) => r.ref)).toEqual(bar(...Array.from({ length: 16 }, (_, i) => i + 1)));
    expect(new Set(c.rows.map((r) => r.ref)).size).toBe(c.rows.length);
    for (const r of c.rows) {
      expect(r).toMatchObject({ unchanged: true, intact: { ok: true }, matches: { ok: true, headFound: true }, laterUpdates: 0 });
      expect(r.chain.length).toBe(r.intact.length);
      expect(r.chain[r.chain.length - 1].head).toBe(true);
    }
    // Public words only: the drawing carries kinds, dates and hashes, never payloads.
    expect(JSON.stringify(c.rows.map((r) => r.chain))).not.toMatch(/payload|Original viewed|actor/i);
  });

  it("never trusts the cases projection: changing it changes nothing", async () => {
    const before = await checkAsLead();
    await sql.begin(async (tx) => {
      const hit = await tx`update cases set status = 'new', public_summary = 'Changed in the projection only' where org_id = ${orgId} and ref = 'BAR-0001' returning id`;
      expect(hit).toHaveLength(1);
    });
    try {
      expect(await checkAsLead()).toEqual(before);
    } finally {
      const [{ s }] = await sql<{ s: ReportSnapshot }[]>`select snapshot as s from reports where id = ${reportId}`;
      const c1 = s.cases.find((c) => c.ref === "BAR-0001")!;
      await sql`update cases set status = ${c1.status}, public_summary = ${c1.publicSummary} where org_id = ${orgId} and ref = 'BAR-0001'`;
    }
  });
});

describe("who may see a check", () => {
  it("a draft: the org's lead and auditor only; never an owner, another org or the public", async () => {
    expect(await access.loadStaffEvidence({ orgId, role: "lead" }, reportId)).not.toBeNull();
    expect(await access.loadStaffEvidence({ orgId, role: "auditor" }, reportId)).not.toBeNull();
    expect(await access.loadStaffEvidence({ orgId, role: "owner" }, reportId)).toBeNull();
    expect(await access.loadStaffEvidence({ orgId: otherOrgId, role: "lead" }, reportId)).toBeNull();
    expect(await access.loadPublicEvidence(reportId)).toBeNull();
    expect(await access.loadPublicEvidence("not-a-report")).toBeNull();
    expect(await access.loadStaffEvidence({ orgId, role: "lead" }, "not-a-report")).toBeNull();
  });

  it("once signed off and published, anyone: the org comes from resolvePublishedReport()", async () => {
    const edit = await import("@/lib/report/edit");
    const [row] = await sql<{ content: ReportContent }[]>`select content from reports where id = ${reportId}`;
    await withOrg({ orgId, role: "lead" }, async (tx) => {
      for (const area of row.content.settings.planAreas) {
        expect((await edit.saveLeadText(tx, { orgId, reportId, key: `area:${area}`, text: "We worked on it." })).ok).toBe(true);
      }
      expect((await edit.saveLeadText(tx, { orgId, reportId, key: "consultations", text: "We met our advisory group." })).ok).toBe(true);
      expect((await edit.signOffReport(tx, { orgId, reportId, memberId: leadId, now: NOW })).ok).toBe(true);
      expect((await edit.publishReport(tx, { orgId, reportId, now: NOW })).ok).toBe(true);
    });
    const pub = await access.loadPublicEvidence(reportId);
    expect(pub?.org).toMatchObject({ id: orgId, slug: "maple-harbour" });
    expect(pub?.target.publishedAt).toBeInstanceOf(Date);
    expect(pub?.check.line).toBe("All records match."); // the lead's text is outside the snapshot and the sentences
    expect(await access.loadStaffEvidence({ orgId: otherOrgId, role: "lead" }, reportId)).toBeNull();
  });
});

describe("later updates and tampering", () => {
  it("an event after the report is information only", async () => {
    const { transition } = await import("@/lib/state-machine");
    const [{ id: facilities }] = await sql<{ id: string }[]>`select id from org_members where org_id = ${orgId} and display_name = 'Facilities team'`;
    const [{ id: bar15 }] = await sql<{ id: string }[]>`select id from cases where org_id = ${orgId} and ref = 'BAR-0015'`;
    await withOrg({ orgId, role: "lead" }, (tx) =>
      transition(tx, orgId, bar15, { kind: "assign", memberId: facilities }, { kind: "staff", memberId: leadId, role: "lead" }),
    );
    const c = await checkAsLead();
    expect(c.allOk).toBe(true);
    expect(c.line).toBe("All records match (1 update since this report).");
    const row = c.rows.find((r) => r.ref === "BAR-0015")!;
    expect(row.laterUpdates).toBe(1);
    expect(row.chain.at(-1)).toMatchObject({ after: true, head: false, word: "Assigned", state: "ok" });
    expect(row.chain.at(-2)).toMatchObject({ head: true, after: false });
  });

  it("the demo beat: jsonb_set inflating the verified count turns check 1 red, with the plain explanation", async () => {
    const [{ original }] = await sql<{ original: string }[]>`select snapshot::text as original from reports where id = ${reportId}`;
    const facts = (JSON.parse(original) as ReportSnapshot).facts;
    const i = facts.findIndex((f) => f.id === "F_OUTCOME");
    const verified = Number(facts[i].values.verified);
    // The report is signed off: the sign-off lock refuses it, even for the owner...
    await expect(sql.begin((tx) => tx`update reports set snapshot = jsonb_set(snapshot, ${["facts", String(i), "values", "verified"]}::text[], to_jsonb(${verified + 5}::int))
      where id = ${reportId}`)).rejects.toThrow(/signed off and locked/);
    // ...so tamper the way whoever controls the database could: with triggers switched off.
    const hit = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL session_replication_role = replica");
      return tx`update reports set snapshot = jsonb_set(snapshot, ${["facts", String(i), "values", "verified"]}::text[], to_jsonb(${verified + 5}::int))
        where id = ${reportId} returning id`;
    });
    expect(hit).toHaveLength(1);
    try {
      const c = await checkAsLead();
      expect(c.fingerprint.ok).toBe(false);
      expect(c.unchanged).toBe(false);
      expect(c.rows.every((r) => !r.unchanged)).toBe(true);
      expect(c.intact.ok).toBe(true);
      expect(c.matches.facts.mismatched).toEqual(["F_OUTCOME"]);
      expect(c.line).toMatch(/^Problems found: the report was changed after it was generated/);
      expect(c.line).not.toMatch(/all records match/i);
      // The signature sealed the fingerprint too (check 5).
      expect(c.signed).toMatchObject({ state: "checked", ok: false, signature: { parts: { manifest: false, content: true, leadText: true } } });
      expect(c.line).toContain("it no longer matches what AccessLoop signed at sign-off (its frozen records changed)");
      // The public sees the same red check.
      expect((await access.loadPublicEvidence(reportId))?.check.line).toBe(c.line);
    } finally {
      // ::text first: postgres.js would JSON-encode a string sent as a jsonb parameter.
      const [back] = (await sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL session_replication_role = replica");
        return tx<{ same: boolean }[]>`update reports set snapshot = ${original}::text::jsonb where id = ${reportId}
          returning snapshot::text = ${original}::text as same`;
      })) as { same: boolean }[];
      expect(back.same).toBe(true);
    }
    expect((await checkAsLead()).allOk).toBe(true);
  });

  it("UPDATE on case_events is refused by the append-only trigger", async () => {
    const [{ id }] = await sql<{ id: string }[]>`select id::text as id from case_events where org_id = ${orgId} order by id limit 1`;
    await expect(sql`update case_events set payload = payload where id = ${id}::bigint`).rejects.toThrow(/append-only/);
    await expect(sql`delete from case_events where id = ${id}::bigint`).rejects.toThrow(/append-only/);
  });

  it("with the trigger off (this throwaway database only), an edited record breaks check 2 exactly where verifyCaseChain says", async () => {
    const [{ id: bar3 }] = await sql<{ id: string }[]>`select id from cases where org_id = ${orgId} and ref = 'BAR-0003'`;
    await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL session_replication_role = replica");
      const hit = await tx`update case_events set payload = payload || '{"note":"edited"}'::jsonb where case_id = ${bar3} and seq = 4 returning id`;
      expect(hit).toHaveLength(1);
    });
    const { verifyCaseChain } = await import("@/lib/case-events");
    const chain = await withOrg({ orgId, role: "lead" }, (tx) => verifyCaseChain(tx, orgId, bar3));
    expect(chain).toMatchObject({ ok: false, brokenAtSeq: 4 });

    const c = await checkAsLead();
    const row = c.rows.find((r) => r.ref === "BAR-0003")!;
    expect(row.intact).toMatchObject({ ok: false, brokenAtSeq: 4 });
    expect(row.chain.map((l) => l.state)).toEqual(row.chain.map((l) => (l.seq < 4 ? "ok" : l.seq === 4 ? "broken" : "unchecked")));
    expect(c.rows.filter((r) => !r.intact.ok).map((r) => r.ref)).toEqual(["BAR-0003"]);
    expect(c.unchanged).toBe(true); // the report itself was not touched
    expect(c.line).toContain("1 case history has a broken link (BAR-0003)");
    expect(c.allOk).toBe(false);
  });
});
