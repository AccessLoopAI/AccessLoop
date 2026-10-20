// FROZEN. Case lifecycle (docs/domain.md §3). The ONLY code allowed to change cases.status.
// Phase 7 (human decisions D1-D4, approved 2026-10-20): close reasons depend on the status, the lead's `retriage`
// and `stop_waiting`, and `reopen` from verified and closed. No new event types (the event_type enum is schema,
// and no schema change was approved for them): a retriage is a `triaged` event with `retriage: true`, and
// stopping the wait is a `retest_expired` event written by the lead with `reason: "reporter_unreachable"`.
// Phase 7 T2 item 8: closing as a duplicate names the original case (the same org, looked up and checked here),
// recorded in the `closed` event as `duplicateOf: { caseId, ref }`. The case page requires it; it stays optional
// here so closes logged before Phase 7 (and the seed's) still replay.
// D8 (approved the same day: "lead sets it on assign"): `assign` may carry the due date (cases.due_at), recorded in
// the `assigned` event's payload as `dueAt` (an ISO instant, or null for none).
// D1, closing the gap a review found (docs/decisions.md 2026-10-21): "spam" and "out of scope" are refused for a
// case that was EVER assigned or had a fix logged, whatever its status now, so a fixed case can't leave the numbers
// by closing it as a duplicate, reopening it (D4: closed -> triaged) and closing it again as spam.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { cases, caseEvents, orgMembers } from "@/db/schema";
import { appendCaseEvent, type EventType } from "./case-events";
import { applyRedaction, detectPatterns } from "./redaction/patterns";

export const MAX_RETEST_ROUNDS = 2;
export const RETEST_EXPIRY_DAYS = 60;
/** D3: the lead may stop waiting for the reporter this many days after the latest `retest_requested`. */
export const STOP_WAITING_DAYS = 14;

const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CaseStatus = (typeof cases.$inferSelect)["status"];
export type CaseRow = typeof cases.$inferSelect;
type ClosedReason = NonNullable<CaseRow["closedReason"]>;
type PriorityArea = NonNullable<CaseRow["priorityArea"]>;

/**
 * D1: the reasons a lead may close a case with, by status. "Spam" and "out of scope" say the submission was never
 * this org's barrier, so they are allowed only before anyone worked on it (new, triaged). Once a case is assigned
 * or fixed, only "duplicate" and "no action possible" remain. Other statuses cannot be closed. A case that was ever
 * assigned or fixed keeps only those two even back in triaged (closeReasonsFor's `workStarted`).
 */
export const CLOSE_REASONS_BY_STATUS: Readonly<Partial<Record<CaseStatus, readonly ClosedReason[]>>> = {
  new: ["duplicate", "out_of_scope", "spam", "no_action_possible"],
  triaged: ["duplicate", "out_of_scope", "spam", "no_action_possible"],
  assigned: ["duplicate", "no_action_possible"],
  fixed_unverified: ["duplicate", "no_action_possible"],
};

/** The reasons that say the submission was never this org's barrier: only before anyone worked on it (D1). */
const NEVER_A_BARRIER: readonly ClosedReason[] = ["spam", "out_of_scope"];

/** The events that mean work started on a case (D1): it was assigned, or a fix was logged. */
export const WORK_STARTED_EVENTS = ["assigned", "fix_logged"] as const satisfies readonly EventType[];

/** True when these events of one case include an assignment or a logged fix (workStarted for closeReasonsFor). */
export function workStartedFrom(events: readonly { type: string }[]): boolean {
  return events.some((e) => (WORK_STARTED_EVENTS as readonly string[]).includes(e.type));
}

/**
 * The close reasons allowed in this status ([] = the case cannot be closed now). `workStarted`: the case was ever
 * assigned or had a fix logged (workStartedFrom its events), so "spam" and "out of scope" are refused in any status.
 */
export function closeReasonsFor(status: CaseStatus, workStarted = false): readonly ClosedReason[] {
  const reasons = CLOSE_REASONS_BY_STATUS[status] ?? [];
  return workStarted ? reasons.filter((r) => !NEVER_A_BARRIER.includes(r)) : reasons;
}

/**
 * D4: where the lead's `reopen` takes a case, or null when it can't be reopened. fixed_unverified and verified go
 * back to assigned (the same assignee); closed goes back to triaged, or to new when it was closed before triage
 * (a triaged case always has an area and a public summary, so a case without them can't be "triaged").
 */
export function reopenTarget(c: Pick<CaseRow, "status" | "priorityArea" | "publicSummary">): CaseStatus | null {
  switch (c.status) {
    case "fixed_unverified":
    case "verified":
      return "assigned";
    case "closed":
      return c.priorityArea && c.publicSummary ? "triaged" : "new";
    default:
      return null;
  }
}

export type Action =
  | { kind: "triage"; priorityArea: PriorityArea; publicSummary: string }
  /** D2: correct the area and/or the public summary of a triaged or assigned case, with a reason. */
  | { kind: "retriage"; priorityArea?: PriorityArea; publicSummary?: string; reason: string }
  /** D8: `dueAt` is the due date the lead sets with the assignment (null: none; left out: the current one stays). */
  | { kind: "assign"; memberId: string; dueAt?: Date | null }
  | { kind: "log_fix"; description: string; evidenceUrl?: string; attachmentIds?: string[] }
  | { kind: "verdict"; verdict: "fixed" | "partly" | "not_fixed" | "cant_check"; comment?: string }
  | { kind: "opt_out" }
  | { kind: "expire_retest" }
  /** D3: the lead stops waiting for a reporter who can't be reached (reason "reporter unreachable"). */
  | { kind: "stop_waiting" }
  | { kind: "reopen"; reason: string }
  /** `duplicateOf`: the id of the original case (reason "duplicate" only; the same org, looked up by transition()). */
  | { kind: "close"; reason: ClosedReason; note?: string; duplicateOf?: string };

export type Actor =
  | { kind: "staff"; memberId: string; role: "lead" | "owner" | "auditor" }
  | { kind: "reporter"; via: "receipt_code" }
  | { kind: "system" };

export class TransitionError extends Error {}

/** Facts plan() needs that live outside the case row. transition() looks them up; tests pass them directly. */
export interface PlanContext {
  hasApprovedRedaction: boolean;
  assigneeRole: "lead" | "owner" | "auditor" | null; // role of action.memberId in THIS org (assign only); null = not a member
  lastRetestRequestedAt: Date | null;                 // latest retest_requested event (expire_retest and stop_waiting)
  now: Date;
  /** close with duplicateOf: that case, looked up in THIS org (null: not found here). */
  duplicateOriginal?: { id: string; ref: string; status: CaseStatus; closedReason: ClosedReason | null } | null;
  /** close: an `assigned` or `fix_logged` event exists for this case (D1; transition() counts them). */
  workStarted?: boolean;
}

/** Free text from people goes into the immutable log, so layer-1 redaction always runs on it first. */
const scrub = (t?: string) => (t === undefined ? undefined : applyRedaction(t, detectPatterns(t)));

interface Plan {
  to: CaseStatus;
  event: EventType;
  patch: Partial<typeof cases.$inferInsert>;
  payload: Record<string, unknown>;
  alsoRequestRetest?: boolean;
}

/** Pure: decide the transition or throw. */
export function plan(c: CaseRow, action: Action, actor: Actor, ctx: PlanContext): Plan {
  const isLead = actor.kind === "staff" && actor.role === "lead";
  const isAssignee = actor.kind === "staff" && actor.memberId === c.assignedTo;
  const deny = (why: string): never => { throw new TransitionError(`${action.kind} from ${c.status}: ${why}`); };

  switch (action.kind) {
    case "triage":
      if (!isLead) deny("lead only");
      if (c.status !== "new") deny("must be new");
      if (!ctx.hasApprovedRedaction) deny("redaction not approved");
      if (!action.publicSummary.trim()) deny("publicSummary required");
      {
        const publicSummary = scrub(action.publicSummary.trim())!;
        return { to: "triaged", event: "triaged",
          patch: { priorityArea: action.priorityArea, publicSummary },
          payload: { priorityArea: action.priorityArea, publicSummary } };
      }

    case "retriage": {
      if (!isLead) deny("lead only");
      if (c.status !== "triaged" && c.status !== "assigned") deny("must be triaged or assigned");
      if (!action.reason.trim()) deny("reason required");
      const typed = action.publicSummary === undefined ? undefined : action.publicSummary.trim();
      if (typed !== undefined && !typed) deny("publicSummary required");
      const priorityArea = action.priorityArea ?? c.priorityArea;
      const publicSummary = typed === undefined ? c.publicSummary : scrub(typed)!;
      if (!priorityArea || !publicSummary) return deny("not triaged yet");
      const changed = [
        ...(priorityArea !== c.priorityArea ? ["priorityArea"] : []),
        ...(publicSummary !== c.publicSummary ? ["publicSummary"] : []),
      ];
      if (!changed.length) deny("nothing to change");
      // The payload carries BOTH resulting values, like `triaged`, so the replay (domain §8) needs no earlier event.
      return { to: c.status, event: "triaged",
        patch: { priorityArea, publicSummary },
        payload: { priorityArea, publicSummary, retriage: true, changed, reason: scrub(action.reason.trim()) } };
    }

    case "assign":
      if (!isLead) deny("lead only");
      if (c.status !== "triaged" && c.status !== "assigned") deny("must be triaged or assigned");
      if (ctx.assigneeRole !== "owner" && ctx.assigneeRole !== "lead") deny("assignee must be an owner or lead in this org");
      if (action.dueAt && Number.isNaN(action.dueAt.getTime())) deny("invalid due date");
      // D8: the due date goes into the log with the assignment, so the replay (domain §8) knows it too.
      if (action.dueAt !== undefined) {
        return { to: "assigned", event: "assigned", patch: { assignedTo: action.memberId, dueAt: action.dueAt },
          payload: { memberId: action.memberId, dueAt: action.dueAt ? action.dueAt.toISOString() : null } };
      }
      return { to: "assigned", event: "assigned", patch: { assignedTo: action.memberId },
        payload: { memberId: action.memberId } };

    case "log_fix": {
      if (!(isLead || isAssignee)) deny("assignee or lead only");
      if (c.status !== "assigned") deny("must be assigned");
      const retest = c.wantsRetest && c.retestRound < MAX_RETEST_ROUNDS;
      return {
        to: retest ? "retest_open" : "fixed_unverified",
        event: "fix_logged",
        patch: retest ? { retestRound: c.retestRound + 1 } : {},
        payload: { description: scrub(action.description), evidenceUrl: action.evidenceUrl,
          attachmentIds: action.attachmentIds, retestRound: retest ? c.retestRound + 1 : c.retestRound },
        alsoRequestRetest: retest,
      };
    }

    case "verdict": {
      if (actor.kind !== "reporter") deny("reporter only");
      if (c.status !== "retest_open") deny("no open re-test");
      const to: CaseStatus =
        action.verdict === "fixed" ? "verified" :
        action.verdict === "cant_check" ? "fixed_unverified" : "assigned";
      return { to, event: "retest_verdict",
        patch: {}, // verifiedAt is set in transition() so seeds can pass a historical time
        payload: { verdict: action.verdict, round: c.retestRound, via: "receipt_code",
          comment: scrub(action.comment) } };
    }

    case "opt_out": // allowed in any state; only changes status when a re-test is open
      if (actor.kind !== "reporter") deny("reporter only");
      if (c.status === "retest_open") {
        return { to: "fixed_unverified", event: "opted_out", patch: { wantsRetest: false }, payload: {} };
      }
      return { to: c.status, event: "opted_out", patch: { wantsRetest: false }, payload: {} };

    case "expire_retest":
      if (actor.kind !== "system") deny("system only");
      if (c.status !== "retest_open") deny("no open re-test");
      if (!ctx.lastRetestRequestedAt ||
        ctx.now.getTime() - ctx.lastRetestRequestedAt.getTime() < RETEST_EXPIRY_DAYS * DAY_MS) deny("not expired yet");
      return { to: "fixed_unverified", event: "retest_expired", patch: {},
        payload: { afterDays: RETEST_EXPIRY_DAYS } };

    case "stop_waiting": {
      if (!isLead) deny("lead only");
      if (c.status !== "retest_open") deny("no open re-test");
      const last = ctx.lastRetestRequestedAt;
      if (!last || ctx.now.getTime() - last.getTime() < STOP_WAITING_DAYS * DAY_MS) return deny("too early to stop waiting");
      // The round ends unanswered, like an expiry: the fix counts as not verified (D3, D6).
      return { to: "fixed_unverified", event: "retest_expired", patch: {},
        payload: { reason: "reporter_unreachable", afterDays: Math.floor((ctx.now.getTime() - last.getTime()) / DAY_MS),
          round: c.retestRound } };
    }

    case "reopen": {
      if (!isLead) deny("lead only");
      const to = reopenTarget(c);
      if (!to) return deny("only fixed_unverified, verified or closed can be reopened");
      if (!action.reason.trim()) deny("reason required");
      // verified -> assigned: the case leaves the verified numbers from now on (D4). closed -> triaged/new: it is
      // nobody's case until the lead assigns it again.
      const patch: Plan["patch"] =
        c.status === "verified" ? { verifiedAt: null }
        : c.status === "closed" ? { closedReason: null, assignedTo: null, dueAt: null }
        : {};
      return { to, event: "reopened", patch, payload: { reason: scrub(action.reason.trim()) } };
    }

    case "close": {
      if (!isLead) deny("lead only");
      const allowed = closeReasonsFor(c.status, ctx.workStarted ?? false);
      if (!allowed.length) deny("not closable");
      if (!allowed.includes(action.reason)) deny(`reason ${action.reason} only before the case is assigned`);
      let duplicateOf: { caseId: string; ref: string } | undefined;
      if (action.duplicateOf !== undefined) {
        // The original is a case of the same org (transition() looked it up there), not this one, and not itself a
        // closed duplicate (point to the case it repeats instead), so "duplicate of" links never form a loop.
        if (action.reason !== "duplicate") return deny("duplicateOf only with reason duplicate");
        const o = ctx.duplicateOriginal;
        if (!o || o.id !== action.duplicateOf) return deny("original not found in this org");
        if (o.id === c.id) return deny("a case can't be a duplicate of itself");
        if (o.status === "closed" && o.closedReason === "duplicate") return deny("the original is itself closed as a duplicate");
        duplicateOf = { caseId: o.id, ref: o.ref };
      }
      return { to: "closed", event: "closed", patch: { closedReason: action.reason },
        payload: { reason: action.reason, note: scrub(action.note), ...(duplicateOf ? { duplicateOf } : {}) } };
    }
  }
}

/** Apply inside withOrg(). Locks the case row, re-plans on fresh state, writes projection + event(s). */
export async function transition(
  tx: Tx, orgId: string, caseId: string, action: Action, actor: Actor,
  opts: { at?: Date } = {}, // `at` is for db/seed.ts only; app code always uses "now"
) {
  const at = opts.at ?? new Date();
  const [c] = await tx.select().from(cases)
    .where(and(eq(cases.orgId, orgId), eq(cases.id, caseId))).for("update");
  if (!c) throw new TransitionError("case not found");

  const [approved] = await tx.select({ n: sql<number>`count(*)::int` }).from(caseEvents)
    .where(and(eq(caseEvents.caseId, caseId), eq(caseEvents.type, "redaction_approved")));
  let assigneeRole: PlanContext["assigneeRole"] = null;
  if (action.kind === "assign") {
    const [m] = await tx.select({ role: orgMembers.role }).from(orgMembers)
      .where(and(eq(orgMembers.id, action.memberId), eq(orgMembers.orgId, orgId)));
    assigneeRole = m?.role ?? null;
  }
  let duplicateOriginal: PlanContext["duplicateOriginal"] = null;
  if (action.kind === "close" && action.duplicateOf !== undefined && UUID.test(action.duplicateOf)) {
    const [o] = await tx.select({ id: cases.id, ref: cases.ref, status: cases.status, closedReason: cases.closedReason })
      .from(cases).where(and(eq(cases.orgId, orgId), eq(cases.id, action.duplicateOf)));
    duplicateOriginal = o ?? null;
  }
  let workStarted = false;
  if (action.kind === "close") {
    const [w] = await tx.select({ n: sql<number>`count(*)::int` }).from(caseEvents)
      .where(and(eq(caseEvents.caseId, caseId), inArray(caseEvents.type, [...WORK_STARTED_EVENTS])));
    workStarted = (w?.n ?? 0) > 0;
  }
  let lastRetestRequestedAt: Date | null = null;
  if (action.kind === "expire_retest" || action.kind === "stop_waiting") {
    const [r] = await tx.select({ at: caseEvents.createdAt }).from(caseEvents)
      .where(and(eq(caseEvents.caseId, caseId), eq(caseEvents.type, "retest_requested")))
      .orderBy(desc(caseEvents.seq)).limit(1);
    lastRetestRequestedAt = r?.at ?? null;
  }
  const p = plan(c, action, actor, {
    hasApprovedRedaction: (approved?.n ?? 0) > 0, assigneeRole, lastRetestRequestedAt, now: at, duplicateOriginal,
    workStarted,
  });

  const actorId = actor.kind === "staff" ? actor.memberId : null;
  const [updated] = await tx.update(cases)
    .set({ ...p.patch, status: p.to, updatedAt: at, ...(p.to === "verified" ? { verifiedAt: at } : {}) })
    .where(eq(cases.id, caseId)).returning();
  const event = await appendCaseEvent(tx, {
    orgId, caseId, type: p.event, actorKind: actor.kind, actorId,
    payload: { ...p.payload, from: c.status, to: p.to }, createdAt: at,
  });
  if (p.alsoRequestRetest) {
    await appendCaseEvent(tx, { orgId, caseId, type: "retest_requested", actorKind: "system", actorId: null,
      payload: { round: updated.retestRound }, createdAt: new Date(at.getTime() + 1) });
  }
  return { case: updated, event, requestRetest: !!p.alsoRequestRetest };
}
