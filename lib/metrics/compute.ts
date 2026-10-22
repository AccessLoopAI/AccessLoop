// "One source of truth for numbers" (docs/domain.md §10): every number on the dashboard and every fact in the
// progress report (§7.2) comes from these pure functions. Each takes the org's cases with their events, the period
// and `now`, and returns values WITH the case IDs behind them and the inbox filter that lists exactly those cases.
// No database, no Next, no AI: lib/metrics/load.ts reads the data; the AI never writes a number.
import { zonedDate } from "@/lib/dates";
import { AREA_HEADINGS, PRIORITY_AREAS, type PriorityArea } from "@/lib/report/headings";
import { INTAKE_CHANNEL_LABELS } from "@/lib/cases/labels";
import { CASE_STATUSES, type CaseStatus } from "@/lib/status";
import { AREA_NONE, AREA_NOT_CLASSIFIED, type InboxFilter } from "./filters";
import { periodMonths, type Period } from "./period";
import {
  ATTENTION_REASONS,
  OPEN_STATUSES,
  ackRecordedLate,
  acknowledgedInChannel,
  aiCorrectedByReporter,
  aiReviewedByReporter,
  attentionReasons,
  closedAsNotFeedback,
  daysToVerified,
  fixLogged,
  inPeriod,
  reachedStage,
  receivedInPeriod,
  receivedMonth,
  roundAnswered,
  roundSentBack,
  verifiedDirect,
  verifiedMonth,
  verifiedStaffRelayed,
  type AttentionReason,
} from "./predicates";
import { replayed, type IntakeChannel, type MetricCase, type ReplayedCase, type RetestOutcome } from "./replay";

/** What every metric takes: the org's cases (each with its whole event chain), the period, and the time "now". */
export interface MetricInput {
  cases: readonly MetricCase[];
  period: Period;
  now: Date;
}

/** A number of cases. `count === caseIds.length`; `filter` opens exactly these cases in the inbox. */
export interface CaseSet {
  count: number;
  caseIds: string[];
  filter: InboxFilter;
}

/** A number of re-test ROUNDS (a case can have two). `caseIds` are the cases they belong to (fewer or equal). */
export interface RoundSet {
  rounds: number;
  caseIds: string[];
  filter: InboxFilter;
}

/** numerator / denominator, or null when the denominator is 0 (show "no data yet", never 0%). */
export type Rate = number | null;

const rate = (n: number, d: number): Rate => (d > 0 ? n / d : null);

function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The cases "received in the period" (spam not counted), replayed, in input order. */
export function periodCases(input: MetricInput): ReplayedCase[] {
  return input.cases.map(replayed).filter((s) => inPeriod(s, input.period));
}

/**
 * Every case received in the period, spam included, replayed, in input order: a report snapshot's cases, so the
 * submissions closed as not accessibility feedback can be cited (F_NOT_FEEDBACK). Every other metric still counts
 * periodCases() only.
 */
export function receivedCases(input: MetricInput): ReplayedCase[] {
  return input.cases.map(replayed).filter((s) => receivedInPeriod(s, input.period));
}

const periodFilter = (p: Period): InboxFilter => ({ from: p.start, to: p.end });

function set(cases: readonly ReplayedCase[], filter: InboxFilter): CaseSet {
  const caseIds = cases.map((c) => c.id);
  return { count: caseIds.length, caseIds, filter };
}

/** Builds CaseSets over the period's cases with the period in every filter. */
function scoped(input: MetricInput) {
  const cases = periodCases(input);
  const base = periodFilter(input.period);
  return {
    cases,
    of: (pred: (s: ReplayedCase) => boolean, filter: InboxFilter = {}): CaseSet =>
      set(cases.filter(pred), { ...base, ...filter }),
  };
}

// ---------- Received ----------

/** The intake channels a chart always shows (ACR s.9(3)); "other" only when used. */
export const SHOWN_CHANNELS = ["web", "email", "phone", "mail", "in_person"] as const satisfies readonly IntakeChannel[];

export interface TotalReceived {
  total: CaseSet;
  byChannel: Record<IntakeChannel, CaseSet>;
}

/** F_TOTAL: feedback received in the period, with byChannel. */
export function totalReceived(input: MetricInput): TotalReceived {
  const s = scoped(input);
  const byChannel = Object.fromEntries(
    (["web", "email", "phone", "mail", "in_person", "other"] as const).map((ch) => [
      ch,
      s.of((c) => c.channel === ch, { channel: [ch] }),
    ]),
  ) as Record<IntakeChannel, CaseSet>;
  return { total: s.of(() => true), byChannel };
}

export interface ChannelRow {
  channel: IntakeChannel;
  label: string;
  cases: CaseSet;
}

/** The intake-channels chart: web, email, phone, mail, in person (always), then other (only when used). */
export function intakeChannels(input: MetricInput): ChannelRow[] {
  const { byChannel } = totalReceived(input);
  const rows: ChannelRow[] = SHOWN_CHANNELS.map((ch) => ({ channel: ch, label: INTAKE_CHANNEL_LABELS[ch], cases: byChannel[ch] }));
  if (byChannel.other.count > 0) rows.push({ channel: "other", label: INTAKE_CHANNEL_LABELS.other, cases: byChannel.other });
  return rows;
}

/** F_ANON: received anonymously. */
export function anonymousReceived(input: MetricInput): CaseSet {
  return scoped(input).of((c) => c.isAnonymous, { anonymous: "yes" });
}

/**
 * F_NOT_FEEDBACK (D6): submissions received in the period and closed as not accessibility feedback (spam). They are
 * not feedback received, so no other number counts them; this one says how many were left out, with their cases.
 */
export function notFeedback(input: MetricInput): CaseSet {
  return set(receivedCases(input).filter(closedAsNotFeedback), { ...periodFilter(input.period), notFeedback: "yes" });
}

// ---------- Status and outcome ----------

/** Cases in each status now (every status, zeros included). */
export function statusCounts(input: MetricInput): Record<CaseStatus, CaseSet> {
  const s = scoped(input);
  return Object.fromEntries(CASE_STATUSES.map((st) => [st, s.of((c) => c.status === st, { status: [st] })])) as Record<
    CaseStatus,
    CaseSet
  >;
}

export interface OpenBarriers {
  total: CaseSet;
  byStatus: Record<(typeof OPEN_STATUSES)[number], CaseSet>;
}

/** Open barriers, by status (new / triaged / assigned / waiting for the reporter). */
export function openBarriers(input: MetricInput): OpenBarriers {
  const s = scoped(input);
  const open = OPEN_STATUSES as readonly CaseStatus[];
  return {
    total: s.of((c) => open.includes(c.status), { status: [...OPEN_STATUSES] }),
    byStatus: Object.fromEntries(OPEN_STATUSES.map((st) => [st, s.of((c) => c.status === st, { status: [st] })])) as OpenBarriers["byStatus"],
  };
}

export interface Outcomes {
  /** Verified by the reporter with a code that never passed through staff (the headline number). */
  verified: CaseSet;
  /** Verified by the reporter with a code staff passed on: counted apart (domain §3). */
  verifiedStaffRelayed: CaseSet;
  fixedUnverified: CaseSet;
  /** new, triaged, assigned, waiting for the reporter. */
  inProgress: CaseSet;
  /** Closed without action (duplicate, out of scope, no action possible; spam is not feedback received). */
  closed: CaseSet;
}

/** F_OUTCOME: where the period's feedback stands. The five sets split the period's cases. */
export function outcomes(input: MetricInput): Outcomes {
  const s = scoped(input);
  const open = OPEN_STATUSES as readonly CaseStatus[];
  return {
    verified: s.of(verifiedDirect, { status: ["verified"], code: "direct" }),
    verifiedStaffRelayed: s.of(verifiedStaffRelayed, { status: ["verified"], code: "staff" }),
    fixedUnverified: s.of((c) => c.status === "fixed_unverified", { status: ["fixed_unverified"] }),
    inProgress: s.of((c) => open.includes(c.status), { status: [...OPEN_STATUSES] }),
    closed: s.of((c) => c.status === "closed", { status: ["closed"] }),
  };
}

export interface FixedCase {
  caseId: string;
  ref: string;
  status: "verified" | "fixed_unverified";
  /** The lead-approved public summary: the only case text a report may use (domain §7). */
  publicSummary: string | null;
  priorityArea: PriorityArea | null;
  receivedAt: Date;
  verifiedAt: Date | null;
  codeRelayedByStaff: boolean;
}

/** F_CASE:<ref>: one entry per verified or fixed case in the period, in input order. */
export function fixedCases(input: MetricInput): FixedCase[] {
  return periodCases(input)
    .filter((c) => c.status === "verified" || c.status === "fixed_unverified")
    .map((c) => ({
      caseId: c.id,
      ref: c.ref,
      status: c.status as FixedCase["status"],
      publicSummary: c.publicSummary,
      priorityArea: c.priorityArea,
      receivedAt: c.receivedAt,
      verifiedAt: c.verifiedAt,
      codeRelayedByStaff: c.codeRelayedByStaff,
    }));
}

// ---------- The loop ----------

export interface VerifiedFixRate {
  /** Numerator: verified by the reporter, code never through staff. */
  verified: CaseSet;
  /** Shown separately: verified with a code staff passed on. In the denominator, not the numerator. */
  verifiedStaffRelayed: CaseSet;
  /** A fix was logged and the case is not verified now: every part below together (D6). */
  notVerified: CaseSet;
  /** ...waiting for the reporter to check the fix. */
  waiting: CaseSet;
  /** ...fixed, not verified ("I can't check", opted out, no answer, stopped waiting, no re-test asked). */
  fixedUnverified: CaseSet;
  /** ...back in progress after a fix (the reporter said "Partly" or "No", or the lead reopened it). */
  backInProgress: CaseSet;
  /** ...closed after a fix was logged. */
  closedAfterFix: CaseSet;
  /** Denominator: every case with at least one logged fix, whatever its status now (= the funnel's "Fix logged"). */
  fixLogged: CaseSet;
  rate: Rate;
}

/**
 * The headline tile (D6): verified by the reporter / cases with a fix logged. A logged fix never leaves the
 * denominator: waiting for the reporter, "I can't check", no answer, stopped waiting, sent back, reopened or closed
 * afterwards, it counts as not verified, so closing a fixed case can't raise the rate. Staff-relayed verifications
 * stay in the denominator but are shown apart, so the rate can only be understated, never inflated.
 */
export function verifiedFixRate(input: MetricInput): VerifiedFixRate {
  const s = scoped(input);
  const stage = { stage: "fix_logged" } as const;
  const notVerifiedStatuses = CASE_STATUSES.filter((st) => st !== "verified");
  const after = (statuses: readonly CaseStatus[]) =>
    s.of((c) => fixLogged(c) && statuses.includes(c.status), { ...stage, status: [...statuses] });
  const verified = s.of((c) => fixLogged(c) && verifiedDirect(c), { ...stage, status: ["verified"], code: "direct" });
  const fixed = s.of(fixLogged, stage);
  return {
    verified,
    verifiedStaffRelayed: s.of((c) => fixLogged(c) && verifiedStaffRelayed(c), { ...stage, status: ["verified"], code: "staff" }),
    notVerified: after(notVerifiedStatuses),
    waiting: after(["retest_open"]),
    fixedUnverified: after(["fixed_unverified"]),
    backInProgress: after(["new", "triaged", "assigned"]),
    closedAfterFix: after(["closed"]),
    fixLogged: fixed,
    rate: rate(verified.count, fixed.count),
  };
}

export interface MedianDaysToVerifiedFix {
  /** Median calendar days from received to verified; null when nothing is verified (F_VERIFY_TIME is then left out). */
  days: number | null;
  /** The verified cases it is computed over (staff-relayed included: the time to fix does not depend on who held the code). */
  cases: CaseSet;
  perCase: { caseId: string; days: number }[];
}

/** F_VERIFY_TIME and the "Median days to verified fix" tile. */
export function medianDaysToVerifiedFix(input: MetricInput): MedianDaysToVerifiedFix {
  const s = scoped(input);
  const cases = s.of((c) => c.status === "verified" && c.verifiedAt !== null, { status: ["verified"] });
  const perCase = s.cases
    .filter((c) => c.status === "verified" && c.verifiedAt !== null)
    .map((c) => ({ caseId: c.id, days: daysToVerified(c)! }));
  return { days: median(perCase.map((p) => p.days)), cases, perCase };
}

export interface LoopFunnel {
  reported: CaseSet;
  triaged: CaseSet;
  assigned: CaseSet;
  fixLogged: CaseSet;
  /** Verified by reporter (staff-relayed included: the stage was reached). */
  verified: CaseSet;
}

/** The loop funnel: reported -> triaged -> assigned -> fix logged -> verified by reporter (each = reached that stage). */
export function loopFunnel(input: MetricInput): LoopFunnel {
  const s = scoped(input);
  return {
    reported: s.of(() => true),
    triaged: s.of((c) => reachedStage(c, "triaged"), { stage: "triaged" }),
    assigned: s.of((c) => reachedStage(c, "assigned"), { stage: "assigned" }),
    fixLogged: s.of(fixLogged, { stage: "fix_logged" }),
    verified: s.of((c) => c.status === "verified", { status: ["verified"] }),
  };
}

export interface RetestResponse {
  /** Re-test rounds requested (retest_requested events). */
  requested: RoundSet;
  /** Rounds the reporter answered, "I can't check right now" and "Don't contact me" included. */
  answered: RoundSet;
  /** Rounds still open, or expired without an answer. */
  unanswered: RoundSet;
  /** F_RETEST: rounds answered "Partly" or "No, still a barrier" (the loop working). */
  sentBack: RoundSet;
  rate: Rate;
}

/** Re-test response rate: answered rounds / requested rounds. */
export function retestResponseRate(input: MetricInput): RetestResponse {
  const cases = periodCases(input);
  const base = periodFilter(input.period);
  const rounds = (pred: (r: ReplayedCase["retestRounds"][number]) => boolean, retest: InboxFilter["retest"]): RoundSet => {
    const hit = cases.filter((c) => c.retestRounds.some(pred));
    return {
      rounds: cases.reduce((n, c) => n + c.retestRounds.filter(pred).length, 0),
      caseIds: hit.map((c) => c.id),
      filter: { ...base, retest },
    };
  };
  const requested = rounds(() => true, "requested");
  const answered = rounds(roundAnswered, "answered");
  return {
    requested,
    answered,
    unanswered: rounds((r) => !roundAnswered(r), "unanswered"),
    sentBack: rounds(roundSentBack, "sent_back"),
    rate: rate(answered.rounds, requested.rounds),
  };
}

/** Count of each re-test answer over the period's rounds (for a breakdown table). */
export function retestOutcomeCounts(input: MetricInput): Record<RetestOutcome, number> {
  const out: Record<RetestOutcome, number> = {
    open: 0, fixed: 0, partly: 0, not_fixed: 0, cant_check: 0, opted_out: 0, expired: 0,
  };
  for (const c of periodCases(input)) for (const r of c.retestRounds) out[r.outcome] += 1;
  return out;
}

// ---------- Acknowledgement and AI ----------

export interface AcknowledgementCompliance {
  /** Non-anonymous feedback: needs an acknowledgement in the same means (ACR s.9(4)). */
  required: CaseSet;
  acknowledged: CaseSet;
  missing: CaseSet;
  /**
   * Acknowledgement honesty (Phase 7): acknowledged, but the staff record that counts was written MORE than 7 days
   * after the day it gives (ackRecordedLate). Those cases still count as acknowledged, on the day typed; this says
   * how many of them were written down late, so a late record never looks prompt without anyone knowing.
   */
  recordedLate: CaseSet;
  rate: Rate;
  /** F_ACK: median hours from received to the acknowledgement (one decimal), over the acknowledged cases. */
  medianHours: number | null;
}

/** Acknowledgement compliance and F_ACK. */
export function acknowledgementCompliance(input: MetricInput): AcknowledgementCompliance {
  const s = scoped(input);
  const required = s.of((c) => !c.isAnonymous, { anonymous: "no" });
  const acknowledged = s.of((c) => !c.isAnonymous && acknowledgedInChannel(c), { anonymous: "no", ack: "yes" });
  const hours = s.cases
    .filter((c) => !c.isAnonymous && acknowledgedInChannel(c))
    .map((c) => Math.max(0, (c.ackInIntakeChannelAt!.getTime() - c.receivedAt.getTime()) / 3_600_000));
  const m = median(hours);
  return {
    required,
    acknowledged,
    missing: s.of((c) => !c.isAnonymous && !acknowledgedInChannel(c), { anonymous: "no", ack: "no" }),
    recordedLate: s.of((c) => !c.isAnonymous && acknowledgedInChannel(c) && ackRecordedLate(c), { anonymous: "no", ack: "late" }),
    rate: rate(acknowledged.count, required.count),
    medianHours: m === null ? null : round1(m),
  };
}

export const NO_REAL_AI_YET = "No real-AI summaries yet";

export type CorrectionRate =
  | { kind: "no_real_ai_yet"; label: typeof NO_REAL_AI_YET; count: 0; reviewed: CaseSet; corrected: CaseSet; rate: null }
  | { kind: "measured"; count: number; reviewed: CaseSet; corrected: CaseSet; rate: number };

/**
 * Reporter-correction rate: the share of real-AI summaries (backend claude-cli or api) that the reporter edited or
 * rejected. With none, the result says "No real-AI summaries yet" with a count of 0, never 0%.
 */
export function reporterCorrectionRate(input: MetricInput): CorrectionRate {
  const s = scoped(input);
  const reviewed = s.of(aiReviewedByReporter, { ai: "real" });
  const corrected = s.of(aiCorrectedByReporter, { ai: "corrected" });
  if (reviewed.count === 0) {
    return { kind: "no_real_ai_yet", label: NO_REAL_AI_YET, count: 0, reviewed, corrected, rate: null };
  }
  return { kind: "measured", count: reviewed.count, reviewed, corrected, rate: corrected.count / reviewed.count };
}

// ---------- Charts ----------

export interface MonthRow {
  /** "2026-03" */
  month: string;
  received: CaseSet;
  /** Cases of the period whose reporter confirmed the fix in this month. */
  verified: CaseSet;
}

/** Received vs verified per month, from the period's first month to its last month or today, whichever is earlier. */
export function receivedVsVerifiedByMonth(input: MetricInput): MonthRow[] {
  const s = scoped(input);
  return periodMonths(input.period, input.now).map((month) => ({
    month,
    received: s.of((c) => receivedMonth(c) === month, { month }),
    verified: s.of((c) => verifiedMonth(c) === month, { verifiedMonth: month }),
  }));
}

export interface AreaRow {
  area: PriorityArea | null;
  /** The domain §1.2 heading, or "Not classified yet". */
  heading: string;
  cases: CaseSet;
}

export interface PriorityAreas {
  /** F_AREA:<area>, every area (zeros included). */
  byArea: Record<PriorityArea, CaseSet>;
  /** Not triaged (yet): new cases, and cases closed before triage. */
  notClassified: CaseSet;
  /** The chart: areas with cases, most first (ties in ACA s.5 order), then "Not classified yet" when any. */
  rows: AreaRow[];
}

/** Barriers by priority area (the area the lead confirmed at triage). */
export function priorityAreas(input: MetricInput): PriorityAreas {
  const s = scoped(input);
  const byArea = Object.fromEntries(
    PRIORITY_AREAS.map((a) => [a, s.of((c) => c.priorityArea === a, { area: [a] })]),
  ) as Record<PriorityArea, CaseSet>;
  const notClassified = s.of((c) => c.priorityArea === null, { area: [AREA_NONE] });
  const rows: AreaRow[] = PRIORITY_AREAS.map((a) => ({ area: a, heading: AREA_HEADINGS[a].canonical, cases: byArea[a] }))
    .filter((r) => r.cases.count > 0)
    .sort((x, y) => y.cases.count - x.cases.count); // stable: ties keep ACA order
  if (notClassified.count > 0) rows.push({ area: null, heading: AREA_NOT_CLASSIFIED, cases: notClassified });
  return { byArea, notClassified, rows };
}

// ---------- Needs attention ----------

export interface AttentionItem {
  caseId: string;
  ref: string;
  reason: AttentionReason;
  since: Date;
  days: number;
}

export interface NeedsAttention {
  /** One row per (case, reason): by reason in domain order, the longest waiting first. */
  items: AttentionItem[];
  byReason: Record<AttentionReason, CaseSet>;
  /** Every case with at least one reason. */
  all: CaseSet;
}

/**
 * The "Needs attention" list. It is about work to do NOW, so it looks at every case of the org (spam excepted),
 * whatever the period: an old case stuck in review still needs someone. Its filters carry no period.
 */
export function needsAttention(input: Pick<MetricInput, "cases" | "now">): NeedsAttention {
  const all = input.cases.map(replayed);
  const hits = all.flatMap((c) => attentionReasons(c, input.now).map((h) => ({ c, h })));
  const items: AttentionItem[] = hits
    .map(({ c, h }) => ({ caseId: c.id, ref: c.ref, reason: h.reason, since: h.since, days: h.days }))
    .sort((a, b) => ATTENTION_REASONS.indexOf(a.reason) - ATTENTION_REASONS.indexOf(b.reason) || b.days - a.days || a.ref.localeCompare(b.ref));
  const withReason = (r: AttentionReason) => all.filter((c) => hits.some((x) => x.c === c && x.h.reason === r));
  const byReason = Object.fromEntries(ATTENTION_REASONS.map((r) => [r, set(withReason(r), { attention: [r] })])) as Record<
    AttentionReason,
    CaseSet
  >;
  return {
    items,
    byReason,
    all: set(all.filter((c) => hits.some((x) => x.c === c)), { attention: [...ATTENTION_REASONS] }),
  };
}

// ---------- Everything at once ----------

export interface DashboardMetrics {
  period: Period;
  /** The calendar date "now" fell on (display time zone). */
  asOf: string;
  total: TotalReceived;
  anonymous: CaseSet;
  /** Closed as not accessibility feedback (D6): left out of every other number, shown in a dashboard footnote. */
  notFeedback: CaseSet;
  statuses: Record<CaseStatus, CaseSet>;
  openBarriers: OpenBarriers;
  outcomes: Outcomes;
  verifiedFixRate: VerifiedFixRate;
  medianDaysToVerifiedFix: MedianDaysToVerifiedFix;
  acknowledgement: AcknowledgementCompliance;
  correctionRate: CorrectionRate;
  retestResponse: RetestResponse;
  funnel: LoopFunnel;
  monthly: MonthRow[];
  areas: PriorityAreas;
  channels: ChannelRow[];
  needsAttention: NeedsAttention;
}

/** Every dashboard number for one period (each case is replayed once and shared by all metrics). */
export function computeDashboardMetrics(input: MetricInput): DashboardMetrics {
  return {
    period: input.period,
    asOf: zonedDate(input.now),
    total: totalReceived(input),
    anonymous: anonymousReceived(input),
    notFeedback: notFeedback(input),
    statuses: statusCounts(input),
    openBarriers: openBarriers(input),
    outcomes: outcomes(input),
    verifiedFixRate: verifiedFixRate(input),
    medianDaysToVerifiedFix: medianDaysToVerifiedFix(input),
    acknowledgement: acknowledgementCompliance(input),
    correctionRate: reporterCorrectionRate(input),
    retestResponse: retestResponseRate(input),
    funnel: loopFunnel(input),
    monthly: receivedVsVerifiedByMonth(input),
    areas: priorityAreas(input),
    channels: intakeChannels(input),
    needsAttention: needsAttention(input),
  };
}
