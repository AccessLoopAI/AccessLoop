// The transaction half of the lib/metrics loader: reads an org's cases and their events with a transaction the
// CALLER opened inside withOrg (RLS). It imports only `type Tx`, never the database client, so code that takes a
// transaction (lib/report, tests on PGlite) can import it without DATABASE_URL. lib/metrics/load.ts re-exports it.
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { caseEvents, cases } from "@/db/schema";
import type { MetricCase, MetricEvent } from "./replay";

/**
 * Every case of the org with its whole event chain (hashes included), ordered by case seq (BAR-0001 first). Call it
 * inside a withOrg() transaction (a report snapshot reads it in the same transaction it freezes). `caseIds` limits
 * the read to those cases (still in seq order; unknown ids are simply absent); an empty list reads nothing.
 */
export async function loadMetricCasesTx(tx: Tx, orgId: string, opts: { caseIds?: readonly string[] } = {}): Promise<MetricCase[]> {
  const ids = opts.caseIds ? [...new Set(opts.caseIds)] : null;
  if (ids && ids.length === 0) return [];
  const rows = await tx
    .select({ id: cases.id, ref: cases.ref })
    .from(cases)
    .where(ids ? and(eq(cases.orgId, orgId), inArray(cases.id, ids)) : eq(cases.orgId, orgId))
    .orderBy(asc(cases.seq));
  if (rows.length === 0) return [];
  const events = await tx
    .select({
      caseId: caseEvents.caseId,
      seq: caseEvents.seq,
      type: caseEvents.type,
      payload: caseEvents.payload,
      createdAt: caseEvents.createdAt,
      hash: caseEvents.hash,
    })
    .from(caseEvents)
    .where(ids ? and(eq(caseEvents.orgId, orgId), inArray(caseEvents.caseId, ids)) : eq(caseEvents.orgId, orgId))
    .orderBy(asc(caseEvents.caseId), asc(caseEvents.seq));
  const byCase = new Map<string, MetricEvent[]>();
  for (const e of events) {
    const list = byCase.get(e.caseId) ?? [];
    list.push({ seq: e.seq, type: e.type, payload: e.payload ?? {}, createdAt: e.createdAt, hash: e.hash });
    byCase.set(e.caseId, list);
  }
  return rows.map((r) => ({ id: r.id, ref: r.ref, events: byCase.get(r.id) ?? [] }));
}
