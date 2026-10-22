// Server-only: the "duplicate of" links between cases (docs/phase7-prompt.md T2 item 8; docs/domain.md §3).
// Closing a case as a duplicate names the original, a case of the SAME org: the state machine looks it up inside
// the org and records `duplicateOf: { caseId, ref }` in the `closed` event (lib/state-machine.ts). These helpers
// read both directions of that link inside the caller's withOrg() transaction, so another org's case is never found.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { caseEvents, cases } from "@/db/schema";
import { duplicateOfPayload } from "./history";
import { CASE_REF } from "./labels";

export interface CaseLinkTarget {
  id: string;
  ref: string;
  status: (typeof cases.$inferSelect)["status"];
  closedReason: (typeof cases.$inferSelect)["closedReason"];
  assignedTo: string | null;
}

const TARGET = {
  id: cases.id,
  ref: cases.ref,
  status: cases.status,
  closedReason: cases.closedReason,
  assignedTo: cases.assignedTo,
};

/** The case behind `ref` in this org (refs repeat across orgs, domain §9), or null. */
export async function caseByRef(tx: Tx, orgId: string, ref: string): Promise<CaseLinkTarget | null> {
  if (!CASE_REF.test(ref)) return null;
  const [row] = await tx.select(TARGET).from(cases).where(and(eq(cases.orgId, orgId), eq(cases.ref, ref))).limit(1);
  return row ?? null;
}

/**
 * The original of a case closed as a duplicate: the case its LATEST close names. null when it is not closed as a
 * duplicate now (never closed, reopened, or closed for another reason) or its close named no original (before Phase 7).
 */
export async function duplicateOriginalOf(tx: Tx, orgId: string, caseId: string): Promise<CaseLinkTarget | null> {
  const [self] = await tx
    .select({ status: cases.status, closedReason: cases.closedReason })
    .from(cases)
    .where(and(eq(cases.orgId, orgId), eq(cases.id, caseId)))
    .limit(1);
  if (self?.status !== "closed" || self.closedReason !== "duplicate") return null;
  const [last] = await tx
    .select({ payload: caseEvents.payload })
    .from(caseEvents)
    .where(and(eq(caseEvents.orgId, orgId), eq(caseEvents.caseId, caseId), eq(caseEvents.type, "closed")))
    .orderBy(desc(caseEvents.seq))
    .limit(1);
  const link = last?.payload.reason === "duplicate" ? duplicateOfPayload(last.payload) : null;
  if (!link) return null;
  const [row] = await tx.select(TARGET).from(cases).where(and(eq(cases.orgId, orgId), eq(cases.id, link.caseId))).limit(1);
  return row ?? null;
}

export interface DuplicateCase extends CaseLinkTarget {
  /** When it was closed as a duplicate of this case. */
  closedAt: Date;
}

/**
 * The other direction: the cases closed as duplicates of `caseId` that still are (their latest close names this
 * case, and they are still closed as duplicates: a reopened one is not listed), oldest close first.
 */
export async function duplicatesOf(tx: Tx, orgId: string, caseId: string): Promise<DuplicateCase[]> {
  const pointing = await tx
    .select({ caseId: caseEvents.caseId })
    .from(caseEvents)
    .where(
      and(
        eq(caseEvents.orgId, orgId),
        eq(caseEvents.type, "closed"),
        sql`${caseEvents.payload} -> 'duplicateOf' ->> 'caseId' = ${caseId}`,
      ),
    );
  const ids = [...new Set(pointing.map((p) => p.caseId))].filter((id) => id !== caseId);
  if (!ids.length) return [];
  const [rows, closes] = await Promise.all([
    tx.select(TARGET).from(cases).where(and(eq(cases.orgId, orgId), inArray(cases.id, ids))),
    tx
      .select({ caseId: caseEvents.caseId, payload: caseEvents.payload, createdAt: caseEvents.createdAt })
      .from(caseEvents)
      .where(and(eq(caseEvents.orgId, orgId), inArray(caseEvents.caseId, ids), eq(caseEvents.type, "closed")))
      .orderBy(asc(caseEvents.seq)),
  ]);
  const lastClose = new Map<string, (typeof closes)[number]>();
  for (const e of closes) lastClose.set(e.caseId, e); // ordered by seq: the last one wins
  return rows
    .flatMap((r) => {
      const e = lastClose.get(r.id);
      const still = r.status === "closed" && r.closedReason === "duplicate" && e && duplicateOfPayload(e.payload)?.caseId === caseId;
      return still ? [{ ...r, closedAt: e.createdAt }] : [];
    })
    .sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime() || a.ref.localeCompare(b.ref));
}
