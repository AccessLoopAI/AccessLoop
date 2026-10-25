// What a receipt code opens (docs/domain.md §3, §4): the reporter's view of their own case. Server-only.
// The org is resolved from the code by the SECURITY DEFINER resolve_receipt() (db/tenant.ts), never taken from
// the request; the case is then read inside withOrg({ orgId, role: "reporter" }). Expired codes (the case was
// verified or closed more than 30 days ago) open nothing, exactly like unknown ones.
// A one-round re-test link (/r/t/{token}, lib/retest-link.ts) opens the same view through loadReporterCaseById():
// its org and case come from a token this server signed, never from what a browser chose.
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { caseEvents, cases, orgs } from "@/db/schema";
import { resolveReceipt, withOrg } from "@/db/tenant";
import { hashReceiptCode } from "@/lib/receipt-code";
import { receiptExpired } from "@/lib/retest";
import type { CaseStatus } from "@/lib/status";

export interface ReporterCase {
  orgId: string;
  caseId: string;
  orgName: string;
  orgSlug: string;
  /** e.g. "We offer a $25 gift card to thank you for checking a fix." (domain §3); null when not set. */
  retestOfferText: string | null;
  ref: string;
  status: CaseStatus;
  closedReason: string | null;
  receivedAt: Date;
  wantsRetest: boolean;
  /** cases.retestRound: the re-test round the case is in (0 before the first fix with a re-test). */
  retestRound: number;
  /** The latest fix description (layer-1 scrubbed by transition() before it entered the log), or null. */
  fixDescription: string | null;
}

/** Decode a URL segment without throwing on a stray "%". */
export function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The case behind a NORMALIZED receipt code (lib/receipt-code.ts normalizeReceiptCode), or null when the code
 * is unknown or expired. Callers treat both the same way (a 404, or one calm "we couldn't find" message), so a
 * response never says whether a code ever existed.
 */
export async function loadReporterCase(normalized: string, now: Date = new Date()): Promise<ReporterCase | null> {
  const hash = hashReceiptCode(normalized);
  if (!hash) return null;
  const found = await resolveReceipt(hash);
  if (!found) return null;
  return loadReporterCaseById(found, now);
}

/**
 * The reporter's view of a case the server has already identified (resolve_receipt(), or a re-test link's signed
 * token), or null when it is gone or its code has expired. Never call it with ids taken from a request.
 */
export async function loadReporterCaseById(found: { orgId: string; caseId: string }, now: Date = new Date()): Promise<ReporterCase | null> {
  const row = await withOrg({ orgId: found.orgId, role: "reporter" }, async (tx) => {
    const [c] = await tx
      .select({
        ref: cases.ref,
        status: cases.status,
        closedReason: cases.closedReason,
        receivedAt: cases.receivedAt,
        wantsRetest: cases.wantsRetest,
        retestRound: cases.retestRound,
        verifiedAt: cases.verifiedAt,
      })
      .from(cases)
      .where(and(eq(cases.orgId, found.orgId), eq(cases.id, found.caseId)))
      .limit(1);
    if (!c) return null;

    const latest = async (type: "fix_logged" | "closed") => {
      const [e] = await tx
        .select({ payload: caseEvents.payload, at: caseEvents.createdAt })
        .from(caseEvents)
        .where(and(eq(caseEvents.orgId, found.orgId), eq(caseEvents.caseId, found.caseId), eq(caseEvents.type, type)))
        .orderBy(desc(caseEvents.seq))
        .limit(1);
      return e ?? null;
    };
    const terminalAt = c.status === "verified" ? c.verifiedAt : c.status === "closed" ? ((await latest("closed"))?.at ?? null) : null;
    const fix = await latest("fix_logged");
    const description = fix?.payload.description;
    return { ...c, terminalAt, fixDescription: typeof description === "string" && description.trim() ? description : null };
  });
  if (!row || receiptExpired(row.status, row.terminalAt, now)) return null;

  // `orgs` is not tenant-scoped (domain §9): the public profile is read with `db`, by the resolved id.
  const [org] = await db
    .select({ name: orgs.name, slug: orgs.slug, retestOfferText: orgs.retestOfferText })
    .from(orgs)
    .where(eq(orgs.id, found.orgId))
    .limit(1);
  if (!org) return null;

  return {
    orgId: found.orgId,
    caseId: found.caseId,
    orgName: org.name,
    orgSlug: org.slug,
    retestOfferText: org.retestOfferText?.trim() || null,
    ref: row.ref,
    status: row.status,
    closedReason: row.closedReason,
    receivedAt: row.receivedAt,
    wantsRetest: row.wantsRetest,
    retestRound: row.retestRound,
    fixDescription: row.fixDescription,
  };
}
