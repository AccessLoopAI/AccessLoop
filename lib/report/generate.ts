// Build a new draft progress report (docs/domain.md §7): choose period -> freeze snapshot -> compile claims -> phrase
// -> validate -> store the draft. Server-only (Node runtime): it opens its own withOrg() transactions. The org and
// the member come from the staff session (never from the request). The AI step runs BETWEEN the two transactions,
// so no database transaction is held open while a model answers. Nothing here logs claim text or summaries.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { cases, reports } from "@/db/schema";
import { withOrg } from "@/db/tenant";
import { phraseClaims, type AiContext } from "@/lib/ai";
import { buildContent, reportChecks, type ReportChecks } from "./compose";
import { reportPeriodLabel } from "./period";
import { caseClaimRefs, claimsForAi, phraseOrTemplates, type PhraseClaimsFn } from "./phrase";
import { prepareReport } from "./prepare";
import { manifestHash } from "./snapshot";
import type { ReportPeriod } from "./types";
import { chooseSentences, validationContext } from "./validate";

export type GenerateResult =
  | { ok: true; id: string; title: string; checks: ReportChecks; phraseOk: boolean }
  | { ok: false; code: "no_org" | "broken_chain"; message: string; refs?: string[] };

/** Of these refs, the cases whose reporter chose "Don't use AI on my report" (inside the caller's withOrg). */
async function aiOptedOutRefs(tx: Tx, orgId: string, refs: string[]): Promise<Set<string>> {
  if (refs.length === 0) return new Set();
  const rows = await tx
    .select({ ref: cases.ref })
    .from(cases)
    .where(and(eq(cases.orgId, orgId), eq(cases.aiOptOut, true), inArray(cases.ref, refs)));
  return new Set(rows.map((r) => r.ref));
}

/** "BAR-0003", "BAR-0003 and BAR-0007", "BAR-0003, BAR-0007 and 2 more". */
function refList(refs: string[]): string {
  if (refs.length <= 2) return refs.join(" and ");
  return `${refs.slice(0, 2).join(", ")} and ${refs.length - 2} more`;
}

export async function generateReport(a: {
  orgId: string;
  memberId: string;
  period: ReportPeriod;
  now?: Date;
  /** The request's AiContext (aiRequestContext(await headers())); claude-cli refuses without one. */
  ai?: AiContext;
  /** For tests: the phrasing function (default: lib/ai phraseClaims, i.e. the effective backend). */
  phrase?: PhraseClaimsFn;
}): Promise<GenerateResult> {
  const now = a.now ?? new Date();
  const { prep, optedOut } = await withOrg({ orgId: a.orgId, role: "lead" }, async (tx) => {
    const prep = await prepareReport(tx, { orgId: a.orgId, period: a.period, now });
    return { prep, optedOut: prep.ok ? await aiOptedOutRefs(tx, a.orgId, caseClaimRefs(prep.claims)) : new Set<string>() };
  });
  if (!prep.ok) {
    if (prep.reason === "no_org") return { ok: false, code: "no_org", message: "This organization isn't set up in AccessLoop yet." };
    const refs = prep.broken.map((b) => b.ref);
    const many = refs.length > 1;
    return {
      ok: false,
      code: "broken_chain",
      refs,
      message: `The records for ${refList(refs)} don't check out, so a report can't be built from ${many ? "them" : "it"}. Open ${many ? "those cases" : "that case"} to see the history.`,
    };
  }

  // Outside any transaction: the AI may take a while (claude-cli up to 60 s). A case whose reporter opted out of AI
  // keeps its own sentence's template: it is never sent (domain §4).
  const phrased = await phraseOrTemplates(claimsForAi(prep.claims, optedOut), a.ai, a.phrase ?? phraseClaims);
  const sentences = chooseSentences(prep.claims, phrased.sentences, validationContext(prep.snapshot));
  const content = buildContent(prep.settings, a.period, prep.claims, sentences, phrased.meta);
  const checks = reportChecks(content, {}, null);
  const hash = manifestHash(prep.snapshot);

  const row = await withOrg({ orgId: a.orgId, role: "lead" }, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"reports:" + a.orgId}))`);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(reports)
      .where(and(eq(reports.orgId, a.orgId), eq(reports.periodStart, a.period.start), eq(reports.periodEnd, a.period.end)));
    const title = `Accessibility progress report ${reportPeriodLabel(a.period)}, version ${n + 1}`;
    const [ins] = await tx
      .insert(reports)
      .values({
        orgId: a.orgId,
        periodStart: a.period.start,
        periodEnd: a.period.end,
        status: "draft",
        title,
        snapshot: prep.snapshot,
        manifestHash: hash,
        content,
        headingCheck: checks.results,
        areaText: {},
        consultationsText: null,
        createdBy: a.memberId,
      })
      .returning({ id: reports.id, title: reports.title });
    return ins;
  });
  return { ok: true, id: row.id, title: row.title, checks, phraseOk: phrased.meta.ok };
}
