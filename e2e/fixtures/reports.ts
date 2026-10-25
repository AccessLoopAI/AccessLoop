// E2E-only fixture (never imported by the app): builds a progress report straight through the app's own report code
// (lib/report/generate.ts with the fake AI backend, then lib/report/edit.ts inside withOrg), so specs that only need
// a draft or a published report get one in milliseconds. The UI path (Generate draft, the text boxes, Sign off,
// Publish) is covered by e2e/reports.spec.ts itself. It shares the app's one db/client pool: never end it in a spec.
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orgMembers, orgs, reports } from "@/db/schema";
import { withOrg } from "@/db/tenant";
import { publishReport, saveLeadText, signOffReport } from "@/lib/report/edit";
import { generateReport } from "@/lib/report/generate";
import type { ReportContent, ReportPeriod, ReportSnapshot } from "@/lib/report/types";
import { ownerSql, withSql } from "../db";

export interface MadeReport {
  id: string;
  title: string;
}

/**
 * A report of `slug` (2026 unless `period` says otherwise): a draft; with `signOff`, every part written and signed off by
 * the org's lead (not published); with `publish`, written, signed off and published.
 */
export async function makeReport(
  slug: string,
  opts: { publish?: boolean; signOff?: boolean; period?: ReportPeriod } = {},
): Promise<MadeReport> {
  process.env.FAKE_LLM = "1"; // fakes only, whatever .env.local says (like Playwright's web server)
  const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, slug)).limit(1);
  if (!org) throw new Error(`org ${slug} is not in the database (run npm run local:setup)`);
  const orgId = org.id;
  const [lead] = await withOrg({ orgId, role: "system" }, (tx) =>
    tx.select({ id: orgMembers.id }).from(orgMembers).where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, "lead"))).limit(1),
  );
  if (!lead) throw new Error(`org ${slug} has no lead`);
  const r = await generateReport({ orgId, memberId: lead.id, period: opts.period ?? { start: "2026-01-01", end: "2026-12-31" } });
  if (!r.ok) throw new Error(`could not build a report for ${slug}: ${r.code}`);
  if (!opts.publish && !opts.signOff) return { id: r.id, title: r.title };

  await withOrg({ orgId, role: "lead" }, async (tx) => {
    // The plan areas the draft was built from are frozen in its content.
    const [row] = await tx.select({ content: reports.content }).from(reports).where(and(eq(reports.id, r.id), eq(reports.orgId, orgId)));
    for (const area of (row.content as ReportContent).settings.planAreas) {
      const s = await saveLeadText(tx, { orgId, reportId: r.id, key: `area:${area}`, text: `This year we worked on ${area.replace(/_/g, " ")}.` });
      if (!s.ok) throw new Error(`could not write ${area}: ${s.reason}`);
    }
    const c = await saveLeadText(tx, { orgId, reportId: r.id, key: "consultations", text: "We met our advisory group of people with disabilities twice." });
    if (!c.ok) throw new Error(`could not write Consultations: ${c.reason}`);
    const so = await signOffReport(tx, { orgId, reportId: r.id, memberId: lead.id, now: new Date() });
    if (!so.ok) throw new Error(`could not sign off: ${so.reason}`);
    if (!opts.publish) return;
    const p = await publishReport(tx, { orgId, reportId: r.id, now: new Date() });
    if (!p.ok) throw new Error(`could not publish: ${p.reason}`);
  });
  return { id: r.id, title: r.title };
}

/** A report's stored snapshot, read through the owner connection inside its org's RLS context. */
export async function storedSnapshot(id: string): Promise<{ orgId: string; snapshot: ReportSnapshot }> {
  return withSql(ownerSql, async (sql) => {
    const [r] = await sql<{ orgId: string }[]>`select org_id as "orgId" from reports where id = ${id}`;
    if (!r) throw new Error("no such report");
    const [row] = (await sql.begin(async (tx) => {
      await tx`select set_config('app.org_id', ${r.orgId}, true)`;
      return tx<{ snapshot: string }[]>`select snapshot::text as snapshot from reports where id = ${id}`;
    })) as { snapshot: string }[];
    return { orgId: r.orgId, snapshot: JSON.parse(row.snapshot) as ReportSnapshot };
  });
}

/**
 * The demo beat (docs/domain.md §8): through MIGRATION_DATABASE_URL, inflate the report's verified count with
 * jsonb_set. Returns the function that puts the snapshot back exactly as it was (call it in `finally`, so neither the
 * dashboard nor the screenshots ever show a red report afterwards). The update runs in the org's RLS context (tables
 * FORCE row level security, so a non-superuser owner would otherwise change 0 rows silently) and must hit 1 row.
 */
export async function inflateVerifiedCount(id: string, by = 5): Promise<() => Promise<void>> {
  const { orgId } = await storedSnapshot(id);
  return withSql(ownerSql, async (sql) => {
    const original = (await sql.begin(async (tx) => {
      await tx`select set_config('app.org_id', ${orgId}, true)`;
      const [row] = await tx<{ snapshot: string }[]>`select snapshot::text as snapshot from reports where id = ${id}`;
      const facts = (JSON.parse(row.snapshot) as ReportSnapshot).facts;
      const i = facts.findIndex((f) => f.id === "F_OUTCOME");
      if (i < 0) throw new Error("the snapshot has no F_OUTCOME fact");
      const verified = Number(facts[i].values.verified);
      const hit = await tx`update reports
        set snapshot = jsonb_set(snapshot, ${["facts", String(i), "values", "verified"]}::text[], to_jsonb(${verified + by}::int))
        where id = ${id} returning id`;
      if (hit.length !== 1) throw new Error(`the tamper update changed ${hit.length} rows`);
      return row.snapshot;
    })) as string;
    return async () => {
      await withSql(ownerSql, (s) =>
        s.begin(async (tx) => {
          await tx`select set_config('app.org_id', ${orgId}, true)`;
          // ::text first: postgres.js would JSON-encode a string sent as a jsonb parameter (a jsonb STRING, not the object).
          const back = await tx<{ same: boolean }[]>`update reports set snapshot = ${original}::text::jsonb where id = ${id}
            returning snapshot::text = ${original}::text as same`;
          if (back.length !== 1 || !back[0].same) throw new Error("the snapshot was not restored exactly");
        }),
      );
    };
  });
}
