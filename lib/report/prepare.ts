// Everything a new draft needs that comes from the database, inside the caller's withOrg() transaction: the org's
// settings, the frozen snapshot (lib/report/snapshot.ts) and the compiled claims. No AI call and no write happens
// here, so tests can drive it on PGlite and the AI step can run after the transaction ends. Takes a tx only.
import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { orgs } from "@/db/schema";
import { absoluteUrl } from "@/lib/app-url";
import { compileClaims } from "./claims";
import { reportSettings } from "./compose";
import { buildSnapshot, type BuiltSnapshot } from "./snapshot";
import type { ReportClaim, ReportPeriod, ReportSettings } from "./types";

export type Prepared =
  | ({ ok: true; settings: ReportSettings; claims: ReportClaim[] } & Omit<BuiltSnapshot, "broken">)
  | { ok: false; reason: "no_org" }
  | { ok: false; reason: "broken_chain"; broken: BuiltSnapshot["broken"] };

/** The public form's address as the General section writes it (from configuration, never the Host header). */
export const feedbackFormUrl = (slug: string) => absoluteUrl(`/o/${slug}/report`);

export async function prepareReport(tx: Tx, a: { orgId: string; period: ReportPeriod; now: Date }): Promise<Prepared> {
  const [org] = await tx.select().from(orgs).where(eq(orgs.id, a.orgId));
  if (!org) return { ok: false, reason: "no_org" };
  const built = await buildSnapshot(tx, a.orgId, a.period, a.now);
  // Fail closed (docs/decisions.md): a report is never built over a case history that does not check out.
  if (built.broken.length) return { ok: false, reason: "broken_chain", broken: built.broken };
  const settings = reportSettings(org, feedbackFormUrl(org.slug));
  return { ok: true, settings, snapshot: built.snapshot, cases: built.cases, claims: compileClaims(built.snapshot, settings) };
}
