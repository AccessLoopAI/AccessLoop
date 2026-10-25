// Retention of the private copy (docs/phase7-prompt.md T3 item 13; docs/domain.md §1.3 ACR s.19, §9; docs/decisions.md
// 2026-10-20). Run by `npm run db:retention` (scripts/retention.ts) as the database OWNER, never by the app (its role
// can't do this: no grant is needed beyond what case_private's policies already allow a lead transaction).
//
// Two rules, each recorded on the case's own log (appendCaseEvent, so the hash chain says when and what):
//   1. After `cases.retention_until` (received + 7 years, ACR s.19): the private copy is wiped. The original words are
//      replaced by PRIVATE_TOMBSTONE (encrypted like any original, so "Show original" keeps working and says what
//      happened), and the reporter's email and contact details are removed. The redacted copy, the public summary and
//      the log stay: they hold no personal details (domain §5, §8).
//   2. 30 days after a case reached verified or closed (the receipt code stops working then too, lib/retest.ts): the
//      reporter's email and contact details are removed. Nobody contacts them about a finished report after that.
// The event is `note_added` from the system with `kind: "retention_purged"`: case_events.type has no
// `retention_purged` value, and adding one is a schema change (db/schema.ts + a migration) outside decision D8
// (docs/decisions.md 2026-10-20 says how to switch). Idempotent: a wiped case or a case with no contact details left
// is not a candidate again. Nothing here logs case text, an address or a code.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { caseEvents, casePrivate, cases } from "@/db/schema";
import { appendCaseEvent } from "@/lib/case-events";
import { encrypt } from "@/lib/crypto";
import { zonedDate } from "@/lib/dates";
import { RECEIPT_VALID_AFTER_TERMINAL_DAYS, isTerminal } from "@/lib/retest";

/** Contact details are kept this many days after a case is verified or closed (as long as its receipt code works). */
export const CONTACT_DAYS_AFTER_FINISHED = RECEIPT_VALID_AFTER_TERMINAL_DAYS;

/** note_added.payload.kind of a retention event (see the header: there is no event type of its own yet). */
export const RETENTION_EVENT_KIND = "retention_purged";

/** What replaces the original words after the retention period: shown by "Show original" from then on. */
export const PRIVATE_TOMBSTONE =
  "The original words of this report were removed after its retention period ended (ACR s.19: seven years from the day it was received). The copy with details hidden and the case history are kept.";

export type RetentionRule = "retention_ended" | "contact_after_finished";
export type PrivatePart = "original_text" | "reporter_email" | "reporter_contact";

export interface RetentionCandidate {
  caseId: string;
  ref: string;
  rule: RetentionRule;
  /** What applying it removes (only what is still there). */
  removes: PrivatePart[];
}

const DAY_MS = 86_400_000;

const NOTES: Record<RetentionRule, string> = {
  retention_ended:
    "Private copy removed: the retention period ended (ACR s.19: seven years), so the original words and the reporter's contact details were deleted. The copy with details hidden and this history are kept.",
  contact_after_finished:
    "Contact details removed: 30 days after this report was finished, the reporter's email address and contact details were deleted. The report itself is kept (ACR s.19).",
};

/** The cases of one org that a rule applies to at `now` (inside the caller's org transaction, app.role lead). */
export async function retentionCandidates(tx: Tx, orgId: string, now: Date = new Date()): Promise<RetentionCandidate[]> {
  const today = zonedDate(now);
  const rows = await tx
    .select({
      id: cases.id,
      ref: cases.ref,
      status: cases.status,
      retentionUntil: cases.retentionUntil,
      hasEmail: sql<boolean>`${casePrivate.reporterEmailEnc} is not null`,
      hasContact: sql<boolean>`${casePrivate.reporterContactEnc} is not null`,
    })
    .from(cases)
    .innerJoin(casePrivate, and(eq(casePrivate.caseId, cases.id), eq(casePrivate.orgId, cases.orgId)))
    .where(eq(cases.orgId, orgId))
    .orderBy(cases.seq);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const purged = new Set(
    (
      await tx
        .select({ caseId: caseEvents.caseId })
        .from(caseEvents)
        .where(
          and(
            eq(caseEvents.orgId, orgId),
            inArray(caseEvents.caseId, ids),
            eq(caseEvents.type, "note_added"),
            sql`${caseEvents.payload}->>'kind' = ${RETENTION_EVENT_KIND}`,
            sql`${caseEvents.payload}->>'rule' = ${"retention_ended"}`,
          ),
        )
    ).map((r) => r.caseId),
  );

  // When each finished case reached its status: its latest status event INTO that status (a reopened case is not
  // finished, so only the current status counts).
  const finished = rows.filter((r) => isTerminal(r.status) && (r.hasEmail || r.hasContact) && !purged.has(r.id));
  const finishedAt = new Map<string, number>();
  if (finished.length > 0) {
    const moves = await tx
      .select({ caseId: caseEvents.caseId, to: sql<string | null>`${caseEvents.payload}->>'to'`, at: caseEvents.createdAt })
      .from(caseEvents)
      .where(and(eq(caseEvents.orgId, orgId), inArray(caseEvents.caseId, finished.map((r) => r.id))));
    const statusOf = new Map(finished.map((r) => [r.id, r.status as string]));
    for (const m of moves) {
      if (m.to !== statusOf.get(m.caseId)) continue;
      finishedAt.set(m.caseId, Math.max(finishedAt.get(m.caseId) ?? 0, m.at.getTime()));
    }
  }

  const out: RetentionCandidate[] = [];
  for (const r of rows) {
    const contact: PrivatePart[] = [...(r.hasEmail ? (["reporter_email"] as const) : []), ...(r.hasContact ? (["reporter_contact"] as const) : [])];
    if (String(r.retentionUntil) < today) {
      if (!purged.has(r.id)) out.push({ caseId: r.id, ref: r.ref, rule: "retention_ended", removes: ["original_text", ...contact] });
      continue;
    }
    const at = finishedAt.get(r.id);
    if (contact.length > 0 && at !== undefined && now.getTime() - at > CONTACT_DAYS_AFTER_FINISHED * DAY_MS) {
      out.push({ caseId: r.id, ref: r.ref, rule: "contact_after_finished", removes: contact });
    }
  }
  return out;
}

/**
 * Apply one candidate (inside the caller's org transaction, app.role lead): lock the case, check again that the rule
 * still applies, update case_private and append the retention event. Returns false when there was nothing to do.
 */
export async function applyRetention(tx: Tx, orgId: string, candidate: RetentionCandidate, now: Date = new Date()): Promise<boolean> {
  const [locked] = await tx
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.orgId, orgId), eq(cases.id, candidate.caseId)))
    .for("update");
  if (!locked) return false;
  const fresh = (await retentionCandidates(tx, orgId, now)).find((c) => c.caseId === candidate.caseId && c.rule === candidate.rule);
  if (!fresh) return false;

  await tx
    .update(casePrivate)
    .set(
      fresh.rule === "retention_ended"
        ? { rawTextEnc: encrypt(PRIVATE_TOMBSTONE), reporterEmailEnc: null, reporterContactEnc: null }
        : { reporterEmailEnc: null, reporterContactEnc: null },
    )
    .where(and(eq(casePrivate.orgId, orgId), eq(casePrivate.caseId, fresh.caseId)));
  await appendCaseEvent(tx, {
    orgId,
    caseId: fresh.caseId,
    type: "note_added",
    actorKind: "system",
    actorId: null,
    payload: { kind: RETENTION_EVENT_KIND, rule: fresh.rule, removed: fresh.removes, note: NOTES[fresh.rule] },
  });
  return true;
}

export interface RetentionOrg {
  id: string;
  name: string;
}

/** Runs `fn` in one transaction in this org's context with app.role = 'lead' (the policies on case_private). */
export type RetentionTxRunner = <T>(orgId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;

export interface RetentionResult {
  org: RetentionOrg;
  candidates: RetentionCandidate[];
  applied: number;
  failed: number;
}

/** Every org: find the candidates; with `apply`, apply each one in its own transaction. */
export async function runRetention(options: {
  orgs: RetentionOrg[];
  inOrgTx: RetentionTxRunner;
  apply: boolean;
  now?: Date;
}): Promise<RetentionResult[]> {
  const now = options.now ?? new Date();
  const results: RetentionResult[] = [];
  for (const org of options.orgs) {
    const candidates = await options.inOrgTx(org.id, (tx) => retentionCandidates(tx, org.id, now));
    const result: RetentionResult = { org, candidates, applied: 0, failed: 0 };
    if (options.apply) {
      for (const c of candidates) {
        try {
          if (await options.inOrgTx(org.id, (tx) => applyRetention(tx, org.id, c, now))) result.applied++;
        } catch (err) {
          result.failed++;
          console.error(`[retention] could not apply a rule to ${c.ref} (${err instanceof Error ? err.name : "UnknownError"})`);
        }
      }
    }
    results.push(result);
  }
  return results;
}
