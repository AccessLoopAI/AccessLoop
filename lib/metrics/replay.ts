// A case's reportable state, replayed from its events ALONE (docs/domain.md §8: "a case's reportable state can be
// replayed from its events alone"; /verify never trusts the `cases` projection). Every metric in lib/metrics reads
// these replayed facts, so the dashboard, the report's facts (§7.2) and /verify's recomputation (§8 check 3) all
// see the same thing. Pure and client-safe: no database, no Next.
import { instantForDate, isIsoDate, zonedDate } from "@/lib/dates";
import { PRIORITY_AREAS, type PriorityArea } from "@/lib/report/headings";
import { CASE_STATUSES, CLOSED_REASONS, type CaseStatus, type ClosedReason } from "@/lib/status";

/** One case_events row, as the metrics need it. Payloads hold redacted content only (domain §8). */
export interface MetricEvent {
  seq: number;
  /** case_events.type (lib/case-events.ts EventType). */
  type: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  /** case_events.hash, when the caller has it (the replay reports the head hash for report snapshots). */
  hash?: string;
}

/** A case and its whole event chain (any order; the replay sorts by seq). Treat it as immutable. */
export interface MetricCase {
  id: string;
  /** The org-scoped reference (BAR-0017). Not in any event, so it comes from the cases row. */
  ref: string;
  events: readonly MetricEvent[];
}

export const INTAKE_CHANNELS = ["web", "email", "phone", "mail", "in_person", "other"] as const;
export type IntakeChannel = (typeof INTAKE_CHANNELS)[number];

/** How a re-test round ended. "open": still waiting; "expired": 60 days passed (expire_retest). */
export type RetestOutcome = "open" | "fixed" | "partly" | "not_fixed" | "cant_check" | "opted_out" | "expired";

export interface RetestRound {
  /** retest_requested.payload.round (1 or 2). */
  round: number;
  requestedAt: Date;
  outcome: RetestOutcome;
  /** When the reporter answered (or the round expired); null while open. */
  closedAt: Date | null;
}

export interface ReplayedCase {
  id: string;
  ref: string;
  /** The `submitted` event's time (createCase writes it at the received date, also for staff-logged intake). */
  receivedAt: Date;
  /** receivedAt as a calendar date in the display time zone. */
  receivedOn: string;
  channel: IntakeChannel;
  isAnonymous: boolean;
  /** submitted.payload.codeRelayedByStaff: staff saw or read out the receipt code (domain §3). */
  codeRelayedByStaff: boolean;
  /** The `to` of the last status-changing event; "new" when there is none. */
  status: CaseStatus;
  /** Why it was closed, while it is closed (null after a reopen). */
  closedReason: ClosedReason | null;
  /** From the latest `triaged` event, a retriage included (null: not classified yet). */
  priorityArea: PriorityArea | null;
  publicSummary: string | null;
  triagedAt: Date | null;
  firstAssignedAt: Date | null;
  firstFixLoggedAt: Date | null;
  /** The retest_verdict that moved the case to verified (null again after the lead reopens it, D4). */
  verifiedAt: Date | null;
  /** Start of the current stretch in "assigned" (a reassignment does not restart it); null unless assigned now. */
  assignedSince: Date | null;
  /** The member of the latest `assigned` event (cases.assigned_to); null before one, and after a reopen from closed. */
  assignedTo: string | null;
  /** D8: the due date set with the latest assignment that gave one (cases.due_at); cleared like assignedTo. */
  dueAt: Date | null;
  redactionApprovedAt: Date | null;
  /**
   * Every ack_recorded event: its channel ("web_screen", "email", "phone", ...), when it was given (`at`: the day a
   * staff record says, see ackInstant), when it was recorded (`recordedAt`: the event's own time) and the day a staff
   * record typed (`givenOn`, YYYY-MM-DD; null for the on-screen receipt and AccessLoop's own emails).
   */
  acks: { channel: string; at: Date; recordedAt: Date; givenOn: string | null }[];
  /** The first acknowledgement given in the same means the feedback came in (ACR s.9(4)), or null. */
  ackInIntakeChannelAt: Date | null;
  retestRounds: RetestRound[];
  /** The ai_structured event: which backend made the summary and what the reporter did with it (domain §6). */
  ai: { backend: string; summarySource: string | null } | null;
  /** Hash of the last event (null when the caller gave no hashes). */
  headHash: string | null;
  eventCount: number;
}

/** Event types that change the status (lib/state-machine.ts); transition() writes `from`/`to` into each payload. */
const STATUS_EVENTS = new Set([
  "triaged",
  "assigned",
  "fix_logged",
  "retest_verdict",
  "reopened",
  "closed",
  "retest_expired",
  "opted_out",
]);

const isStatus = (v: unknown): v is CaseStatus => typeof v === "string" && (CASE_STATUSES as readonly string[]).includes(v);
const isArea = (v: unknown): v is PriorityArea => typeof v === "string" && (PRIORITY_AREAS as readonly string[]).includes(v);
const isChannel = (v: unknown): v is IntakeChannel => typeof v === "string" && (INTAKE_CHANNELS as readonly string[]).includes(v);
const isClosedReason = (v: unknown): v is ClosedReason =>
  typeof v === "string" && (CLOSED_REASONS as readonly string[]).includes(v);

/** The ack_recorded channel that counts as "the same means" for an intake channel (web: the on-screen receipt). */
export function ackChannelFor(channel: IntakeChannel): string {
  return channel === "web" ? "web_screen" : channel;
}

/**
 * When an acknowledgement was given. A staff-recorded one carries the day it was given (`on`), which may be before
 * the day it was recorded: the same instant the case page stores in cases.ackAt (lib/dates.ts instantForDate).
 */
function ackInstant(e: MetricEvent): Date {
  const on = e.payload.on;
  return typeof on === "string" && isIsoDate(on) ? instantForDate(on, e.createdAt) : e.createdAt;
}

const VERDICTS = new Set(["fixed", "partly", "not_fixed", "cant_check"]);

/** An `assigned` event's dueAt (an ISO instant, D8), or null when it is null or unreadable. */
function dueDateOf(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Replay one case from its events. Never throws: a chain without `submitted` falls back to its first event. */
export function replayCase(c: MetricCase): ReplayedCase {
  const events = [...c.events].sort((a, b) => a.seq - b.seq);
  const first = events[0];
  const s: ReplayedCase = {
    id: c.id,
    ref: c.ref,
    receivedAt: first?.createdAt ?? new Date(0),
    receivedOn: "",
    channel: "other",
    isAnonymous: true,
    codeRelayedByStaff: false,
    status: "new",
    closedReason: null,
    priorityArea: null,
    publicSummary: null,
    triagedAt: null,
    firstAssignedAt: null,
    firstFixLoggedAt: null,
    verifiedAt: null,
    assignedSince: null,
    assignedTo: null,
    dueAt: null,
    redactionApprovedAt: null,
    acks: [],
    ackInIntakeChannelAt: null,
    retestRounds: [],
    ai: null,
    headHash: events.length ? (events[events.length - 1].hash ?? null) : null,
    eventCount: events.length,
  };

  const openRound = () => {
    const last = s.retestRounds[s.retestRounds.length - 1];
    return last && last.outcome === "open" ? last : null;
  };
  const closeRound = (outcome: RetestOutcome, at: Date) => {
    const r = openRound();
    if (r) {
      r.outcome = outcome;
      r.closedAt = at;
    }
  };

  let submitted = false;
  for (const e of events) {
    const p = e.payload ?? {};
    switch (e.type) {
      case "submitted":
        if (!submitted) {
          submitted = true;
          s.receivedAt = e.createdAt;
          s.channel = isChannel(p.channel) ? p.channel : "other";
          s.isAnonymous = p.isAnonymous !== false;
          s.codeRelayedByStaff = p.codeRelayedByStaff === true;
        }
        break;
      case "ack_recorded":
        s.acks.push({
          channel: String(p.channel ?? ""),
          at: ackInstant(e),
          recordedAt: e.createdAt,
          givenOn: typeof p.on === "string" && isIsoDate(p.on) ? p.on : null,
        });
        break;
      case "ai_structured": {
        const confirmed = p.confirmedValue as { summarySource?: unknown } | undefined;
        s.ai = {
          backend: String(p.backend ?? ""),
          summarySource: typeof confirmed?.summarySource === "string" ? confirmed.summarySource : null,
        };
        break;
      }
      case "redaction_approved":
        s.redactionApprovedAt ??= e.createdAt;
        break;
      case "retest_requested":
        s.retestRounds.push({
          round: typeof p.round === "number" ? p.round : s.retestRounds.length + 1,
          requestedAt: e.createdAt,
          outcome: "open",
          closedAt: null,
        });
        break;
    }

    if (!STATUS_EVENTS.has(e.type) || !isStatus(p.to)) continue;
    const from = isStatus(p.from) ? p.from : s.status;
    const to = p.to;
    switch (e.type) {
      case "triaged":
        s.triagedAt ??= e.createdAt;
        if (isArea(p.priorityArea)) s.priorityArea = p.priorityArea;
        if (typeof p.publicSummary === "string") s.publicSummary = p.publicSummary;
        break;
      case "assigned":
        s.firstAssignedAt ??= e.createdAt;
        s.assignedTo = typeof p.memberId === "string" ? p.memberId : null;
        // D8: an assignment that says nothing about a due date keeps the one before (events written before D8).
        if ("dueAt" in p) s.dueAt = dueDateOf(p.dueAt);
        break;
      case "fix_logged":
        s.firstFixLoggedAt ??= e.createdAt;
        break;
      case "retest_verdict":
        if (typeof p.verdict === "string" && VERDICTS.has(p.verdict)) closeRound(p.verdict as RetestOutcome, e.createdAt);
        if (to === "verified") s.verifiedAt = e.createdAt;
        break;
      case "opted_out":
        if (from === "retest_open") closeRound("opted_out", e.createdAt);
        break;
      case "retest_expired":
        closeRound("expired", e.createdAt);
        break;
      case "closed":
        s.closedReason = isClosedReason(p.reason) ? p.reason : null;
        break;
      case "reopened":
        // D4: a reopened verified case is not verified any more from this event on (the report frozen before it
        // keeps it: /verify replays only up to its head).
        if (from === "verified") s.verifiedAt = null;
        // D4: a closed case reopens as nobody's case, with no due date (lib/state-machine.ts clears both).
        if (from === "closed") {
          s.assignedTo = null;
          s.dueAt = null;
        }
        break;
    }
    if (to !== "closed") s.closedReason = null; // D4: a reopened closed case has no closing reason
    if (to === "assigned") {
      if (s.status !== "assigned") s.assignedSince = e.createdAt;
    } else {
      s.assignedSince = null;
    }
    s.status = to;
  }

  s.receivedOn = zonedDate(s.receivedAt);
  const expected = ackChannelFor(s.channel);
  const inChannel = s.acks.filter((a) => a.channel === expected).map((a) => a.at.getTime());
  s.ackInIntakeChannelAt = inChannel.length ? new Date(Math.min(...inChannel)) : null;
  return s;
}

// Each metric replays the same cases; remember the replay per (immutable) input object.
const memo = new WeakMap<MetricCase, ReplayedCase>();

/** replayCase, remembered per input object (the inputs are treated as immutable). */
export function replayed(c: MetricCase): ReplayedCase {
  let r = memo.get(c);
  if (!r) {
    r = replayCase(c);
    memo.set(c, r);
  }
  return r;
}
