// Inbox filters (CLAUDE.md "Routes": /app/inbox accepts status, area, channel, month and attention, so dashboard
// links land on exactly the cases behind a number). Every CaseSet a metric returns carries the InboxFilter that
// selects exactly its cases; applyInboxFilter() uses the same predicates (lib/metrics/predicates.ts) as the metric.
// Query values are zod-validated; unknown keys and invalid values are ignored, never an error. Pure, client-safe.
import { z } from "zod";
import { AREA_HEADINGS, PRIORITY_AREAS, type PriorityArea } from "@/lib/report/headings";
import { INTAKE_CHANNEL_LABELS } from "@/lib/cases/labels";
import { CASE_STATUSES, STAFF_STATUS_LABELS, type CaseStatus } from "@/lib/status";
import { isIsoDate } from "@/lib/dates";
import { isMonth, monthLabel, periodLabel, type Period } from "./period";
import {
  ATTENTION_REASONS,
  FUNNEL_STAGES,
  ackRecordedLate,
  acknowledgedInChannel,
  aiCorrectedByReporter,
  aiReviewedByReporter,
  attentionReasons,
  closedAsNotFeedback,
  isSpam,
  reachedStage,
  receivedInPeriod,
  receivedMonth,
  retestOffered,
  roundAnswered,
  roundSentBack,
  verifiedMonth,
  type AttentionReason,
  type FunnelStage,
} from "./predicates";
import { AGE_FILTERS, caseAgeDays, inAgeRange, type AgeFilter } from "./queue";
import { INTAKE_CHANNELS, replayed, type IntakeChannel, type MetricCase, type ReplayedCase } from "./replay";

export const AREA_NONE = "none";
export type AreaFilterValue = PriorityArea | typeof AREA_NONE;

/** The inbox's "Assigned to" value for cases nobody is assigned to (the other values are org_members ids). */
export const ASSIGNEE_NONE = "none";

export const RETEST_FILTERS = ["requested", "answered", "unanswered", "sent_back"] as const;
export type RetestFilter = (typeof RETEST_FILTERS)[number];

/**
 * Every key is optional and the keys combine with AND; the values of a list key combine with OR.
 * `from`/`to` (both, or neither) is the reporting period: received on those dates, spam not counted (the same
 * universe as every period metric). Without them the filter runs over every case of the org.
 * `notFeedback=yes` selects only the submissions closed as not accessibility feedback (D6), which the period
 * otherwise leaves out.
 */
export interface InboxFilter {
  from?: string;
  to?: string;
  status?: CaseStatus[];
  area?: AreaFilterValue[];
  channel?: IntakeChannel[];
  /** Assigned to one of these members (org_members ids) or to nobody ("none"): the inbox form's "Assigned to". */
  assignee?: string[];
  /** Received this many whole days ago (lib/metrics/queue.ts AGE_FILTERS): the inbox form's "Age". */
  age?: AgeFilter;
  /** Received in this month (YYYY-MM, display time zone). */
  month?: string;
  /** The reporter confirmed the fix in this month (YYYY-MM). */
  verifiedMonth?: string;
  attention?: AttentionReason[];
  /** Reached this loop stage (triaged, assigned, fix logged). */
  stage?: FunnelStage;
  anonymous?: "yes" | "no";
  /**
   * Acknowledged in the same means it came in (ACR s.9(4)); late: acknowledged, but the staff record was written more
   * than 7 days after the day it gives (Phase 7, acknowledgement honesty).
   */
  ack?: "yes" | "no" | "late";
  /** requested: a re-test was offered; answered: a round was answered; unanswered: a round is open or expired; sent_back: a round was answered "Partly" or "No". */
  retest?: RetestFilter;
  /** Who held the receipt code: staff saw or read it out ("staff"), or only the reporter had it ("direct"). */
  code?: "staff" | "direct";
  /** real: a real-model summary the reporter reviewed; corrected: ...and edited or rejected. */
  ai?: "real" | "corrected";
  /** yes: only the submissions closed as not accessibility feedback (spam), the period's one exception (D6). */
  notFeedback?: "yes";
}

/** The query keys in the order inboxHref() writes them. */
export const INBOX_FILTER_KEYS = [
  "from", "to", "status", "area", "channel", "assignee", "age", "month", "verifiedMonth", "attention",
  "stage", "anonymous", "ack", "retest", "code", "ai", "notFeedback",
] as const satisfies readonly (keyof InboxFilter)[];

const isoDate = z.string().refine(isIsoDate);
const month = z.string().refine(isMonth);
const yesNo = z.enum(["yes", "no"]);
const LIST = {
  status: z.enum(CASE_STATUSES),
  area: z.enum([...PRIORITY_AREAS, AREA_NONE]),
  channel: z.enum(INTAKE_CHANNELS),
  attention: z.enum(ATTENTION_REASONS),
};
const LIST_ORDER: Record<keyof typeof LIST, readonly string[]> = {
  status: CASE_STATUSES,
  area: [...PRIORITY_AREAS, AREA_NONE],
  channel: INTAKE_CHANNELS,
  attention: ATTENTION_REASONS,
};
const assigneeValue = z.union([z.uuid(), z.literal(ASSIGNEE_NONE)]);
const SINGLE = {
  age: z.enum(AGE_FILTERS),
  month,
  verifiedMonth: month,
  stage: z.enum(FUNNEL_STAGES),
  anonymous: yesNo,
  ack: z.enum(["yes", "no", "late"]),
  retest: z.enum(RETEST_FILTERS),
  code: z.enum(["staff", "direct"]),
  ai: z.enum(["real", "corrected"]),
  notFeedback: z.enum(["yes"]),
};

export type SearchParamsInput = URLSearchParams | Record<string, string | string[] | undefined>;

function valuesOf(input: SearchParamsInput, key: string): string[] {
  const raw = input instanceof URLSearchParams ? input.getAll(key) : ([] as string[]).concat(input[key] ?? []);
  return raw.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
}

/** Read the inbox filter from the page's search params. Unknown keys and invalid values are dropped. */
export function parseInboxFilter(input: SearchParamsInput): InboxFilter {
  const f: InboxFilter = {};
  const from = valuesOf(input, "from").find((v) => isoDate.safeParse(v).success);
  const to = valuesOf(input, "to").find((v) => isoDate.safeParse(v).success);
  if (from && to && from <= to) {
    f.from = from;
    f.to = to;
  }
  for (const key of Object.keys(LIST) as (keyof typeof LIST)[]) {
    const ok = new Set(valuesOf(input, key).filter((v) => LIST[key].safeParse(v).success));
    if (ok.size) (f as Record<string, string[]>)[key] = LIST_ORDER[key].filter((v) => ok.has(v));
  }
  // Member ids have no fixed order: "none" first, then the ids in the order given, each once.
  const assignees = [...new Set(valuesOf(input, "assignee").map((v) => v.toLowerCase()))].filter(
    (v) => assigneeValue.safeParse(v).success,
  );
  if (assignees.length) f.assignee = [...assignees.filter((v) => v === ASSIGNEE_NONE), ...assignees.filter((v) => v !== ASSIGNEE_NONE)];
  for (const key of Object.keys(SINGLE) as (keyof typeof SINGLE)[]) {
    const v = valuesOf(input, key).find((x) => SINGLE[key].safeParse(x).success);
    if (v) (f as Record<string, string>)[key] = v;
  }
  return f;
}

/** True when the filter selects anything narrower than "every case". */
export function isFilterActive(f: InboxFilter): boolean {
  return INBOX_FILTER_KEYS.some((k) => f[k] !== undefined);
}

/** The inbox URL for a filter ("/app/inbox" when it is empty). Keys in a fixed order; list keys repeat. */
export function inboxHref(f: InboxFilter): string {
  const q = new URLSearchParams();
  for (const key of INBOX_FILTER_KEYS) {
    const v = f[key];
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) q.append(key, one);
  }
  const s = q.toString();
  return s ? `/app/inbox?${s}` : "/app/inbox";
}

/** The filter's period, when it has one. */
export function filterPeriod(f: InboxFilter): Period | null {
  return f.from && f.to ? { start: f.from, end: f.to } : null;
}

/** Does one replayed case match the filter (at `now`, for the attention rules)? */
export function matchesInboxFilter(s: ReplayedCase, f: InboxFilter, now: Date): boolean {
  const period = filterPeriod(f);
  if (period && !receivedInPeriod(s, period)) return false;
  // The period leaves spam out (inPeriod), unless the filter asks for exactly those submissions.
  if (f.notFeedback === "yes" ? !closedAsNotFeedback(s) : period !== null && isSpam(s)) return false;
  if (f.status && !f.status.includes(s.status)) return false;
  if (f.area && !f.area.includes(s.priorityArea ?? AREA_NONE)) return false;
  if (f.channel && !f.channel.includes(s.channel)) return false;
  if (f.assignee && !f.assignee.includes(s.assignedTo ?? ASSIGNEE_NONE)) return false;
  if (f.age && !inAgeRange(caseAgeDays(s, now), f.age)) return false;
  if (f.month && receivedMonth(s) !== f.month) return false;
  if (f.verifiedMonth && verifiedMonth(s) !== f.verifiedMonth) return false;
  if (f.attention) {
    const reasons = attentionReasons(s, now).map((h) => h.reason);
    if (!f.attention.some((r) => reasons.includes(r))) return false;
  }
  if (f.stage && !reachedStage(s, f.stage)) return false;
  if (f.anonymous && s.isAnonymous !== (f.anonymous === "yes")) return false;
  if (f.ack === "late" ? !(acknowledgedInChannel(s) && ackRecordedLate(s)) : f.ack && acknowledgedInChannel(s) !== (f.ack === "yes")) return false;
  if (f.retest) {
    const ok =
      f.retest === "requested" ? retestOffered(s)
      : f.retest === "answered" ? s.retestRounds.some(roundAnswered)
      : f.retest === "unanswered" ? s.retestRounds.some((r) => !roundAnswered(r))
      : s.retestRounds.some(roundSentBack);
    if (!ok) return false;
  }
  if (f.code && s.codeRelayedByStaff !== (f.code === "staff")) return false;
  if (f.ai === "real" && !aiReviewedByReporter(s)) return false;
  if (f.ai === "corrected" && !aiCorrectedByReporter(s)) return false;
  return true;
}

/** The IDs of the cases a filter selects, in input order. */
export function applyInboxFilter(cases: readonly MetricCase[], f: InboxFilter, now: Date): string[] {
  return cases.filter((c) => matchesInboxFilter(replayed(c), f, now)).map((c) => c.id);
}

const or = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;

export const ATTENTION_LABELS: Record<AttentionReason, string> = {
  redaction: "waiting for redaction review",
  retest: "re-test open for more than 14 days",
  stalled: "assigned for 30 days or more with no fix logged",
  unacknowledged: "no acknowledgement recorded",
};

export const AREA_NOT_CLASSIFIED = "Not classified yet";

/** "Waiting for redaction review" -> "Waiting ...": sentence case for a list item. */
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The "Age" filter as a line of the filter summary (AGE_FILTER_LABELS are the form's shorter option labels). */
const AGE_FILTER_LINES: Record<AgeFilter, string> = {
  under_7: "Received less than 7 days ago",
  "7_29": "Received 7 to 29 days ago",
  "30_89": "Received 30 to 89 days ago",
  "90_plus": "Received 90 or more days ago",
};

/** What describeInboxFilter needs from the page: the names of the org's members (the "Assigned to" filter). */
export interface DescribeOptions {
  /** A member's display name, or null when the id is not a member of this org. */
  memberName?: (memberId: string) => string | null;
}

/** The active filters in plain words, one line each (shown above the inbox table). */
export function describeInboxFilter(f: InboxFilter, opts: DescribeOptions = {}): string[] {
  const lines: string[] = [];
  const period = filterPeriod(f);
  if (period) lines.push(`Received ${periodLabel(period)}${f.notFeedback ? "" : " (spam not counted)"}`);
  if (f.notFeedback) lines.push("Closed as not accessibility feedback (not counted as feedback received)");
  if (f.month) lines.push(`Received in ${monthLabel(f.month)}`);
  if (f.status) lines.push(`Status: ${or(f.status.map((s) => STAFF_STATUS_LABELS[s]))}`);
  if (f.area) lines.push(`Area: ${or(f.area.map((a) => (a === AREA_NONE ? AREA_NOT_CLASSIFIED : AREA_HEADINGS[a].canonical)))}`);
  if (f.channel) lines.push(`Came in by: ${or(f.channel.map((c) => INTAKE_CHANNEL_LABELS[c]))}`);
  if (f.assignee) {
    const who = (id: string) => (id === ASSIGNEE_NONE ? "no one yet" : (opts.memberName?.(id) ?? "someone not in this organization"));
    lines.push(`Assigned to: ${or(f.assignee.map(who))}`);
  }
  if (f.age) lines.push(AGE_FILTER_LINES[f.age]);
  if (f.verifiedMonth) lines.push(`Fix confirmed by the reporter in ${monthLabel(f.verifiedMonth)}`);
  if (f.attention) lines.push(`Needs attention: ${or(f.attention.map((r) => ATTENTION_LABELS[r]))}`);
  if (f.stage) {
    lines.push(
      f.stage === "triaged" ? "Got as far as triage" : f.stage === "assigned" ? "Got as far as being assigned" : "A fix was logged",
    );
  }
  if (f.anonymous) lines.push(f.anonymous === "yes" ? "Sent anonymously" : "Not anonymous");
  if (f.ack) {
    lines.push(
      f.ack === "yes" ? "Acknowledged the same way it came in"
      : f.ack === "late" ? "Acknowledgement recorded more than 7 days after the date it gives"
      : "No acknowledgement recorded the same way it came in",
    );
  }
  if (f.retest) {
    lines.push(
      {
        requested: "A re-test was offered",
        answered: "The reporter answered a re-test",
        unanswered: "A re-test is open or expired without an answer",
        sent_back: "The reporter answered a re-test \"Partly\" or \"No, still a barrier\"",
      }[f.retest],
    );
  }
  if (f.code) lines.push(f.code === "staff" ? "Staff passed the receipt code on" : "Only the reporter had the receipt code");
  if (f.ai) lines.push(f.ai === "real" ? "AI summary from a real model, checked by the reporter" : "AI summary the reporter edited or rejected");
  return lines.map(capital);
}
