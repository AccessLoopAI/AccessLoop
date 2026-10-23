// The ONE definition of every condition a metric counts and an inbox filter selects. lib/metrics/compute.ts and
// lib/metrics/filters.ts both call these, so a dashboard number and the inbox it links to can never disagree.
// Pure and client-safe.
import { zonedDate } from "@/lib/dates";
import type { CaseStatus } from "@/lib/status";
import { daysBetween, monthOf, todayOf, type Period } from "./period";
import { ackChannelFor, type ReplayedCase, type RetestRound } from "./replay";

/** Closed as spam: not feedback about a barrier, so never counted as feedback received (domain §7.1). */
export function isSpam(s: ReplayedCase): boolean {
  return s.status === "closed" && s.closedReason === "spam";
}

/**
 * D6: "closed as not accessibility feedback" (the staff label "Not feedback about a barrier", reason spam). These
 * submissions are left out of every other period number; the report says how many there were (F_NOT_FEEDBACK) and
 * the dashboard links them, so leaving them out is never silent.
 */
export function closedAsNotFeedback(s: ReplayedCase): boolean {
  return isSpam(s);
}

/** Received on a date in the period, whatever happened to it since (spam included): a report snapshot's cases. */
export function receivedInPeriod(s: ReplayedCase, period: Period): boolean {
  return s.receivedOn >= period.start && s.receivedOn <= period.end;
}

/** "Feedback received in the period": received on a date in the period, and not closed as spam. */
export function inPeriod(s: ReplayedCase, period: Period): boolean {
  return !isSpam(s) && receivedInPeriod(s, period);
}

/** The statuses of a barrier that is still open (domain §10 "Open barriers"). */
export const OPEN_STATUSES = ["new", "triaged", "assigned", "retest_open"] as const satisfies readonly CaseStatus[];

/** The loop funnel's middle stages (reported = every case; verified = status verified). */
export const FUNNEL_STAGES = ["triaged", "assigned", "fix_logged"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/** The case got that far at some point (a later close or verdict does not undo it). */
export function reachedStage(s: ReplayedCase, stage: FunnelStage): boolean {
  if (stage === "triaged") return s.triagedAt !== null;
  if (stage === "assigned") return s.firstAssignedAt !== null;
  return fixLogged(s);
}

/**
 * D6: a fix was logged at least once, whatever the status is now (waiting for the reporter, sent back, reopened,
 * closed, fixed but not verified, verified). The verified-fix rate's denominator: a fix that was logged can never
 * leave it, so closing or stopping the wait after a fix counts as "not verified".
 */
export function fixLogged(s: ReplayedCase): boolean {
  return s.firstFixLoggedAt !== null;
}

/** A re-test was offered: at least one retest_requested event. */
export function retestOffered(s: ReplayedCase): boolean {
  return s.retestRounds.length > 0;
}

/** The reporter answered the round ("I can't check right now" and "Don't contact me" count; expiry does not). */
export function roundAnswered(r: RetestRound): boolean {
  return r.outcome !== "open" && r.outcome !== "expired";
}

/** The reporter sent the fix back: "Partly" or "No, still a barrier" (F_RETEST, the loop working). */
export function roundSentBack(r: RetestRound): boolean {
  return r.outcome === "partly" || r.outcome === "not_fixed";
}

/** Verified with a code that never passed through staff (the headline verified-by-reporter number, domain §3). */
export function verifiedDirect(s: ReplayedCase): boolean {
  return s.status === "verified" && !s.codeRelayedByStaff;
}

/** Verified with a code staff read out or saw ("confirmed by the reporter, code given by staff"). */
export function verifiedStaffRelayed(s: ReplayedCase): boolean {
  return s.status === "verified" && s.codeRelayedByStaff;
}

/** ACR s.9(4): an ack_recorded event in the same means the feedback came in. */
export function acknowledgedInChannel(s: ReplayedCase): boolean {
  return s.ackInIntakeChannelAt !== null;
}

/** A staff-recorded acknowledgement counts as "recorded late" when it was written down MORE than this many days after the day it says. */
export const ACK_RECORDED_LATE_DAYS = 7;

/**
 * Phase 7 (acknowledgement honesty): the acknowledgement that counts for ACR s.9(4) (the first one in the intake
 * channel) was RECORDED more than 7 calendar days after the date it gives. The typed date is what the metric's
 * hours use, so a call made on the 3rd and logged on the 20th would look prompt; this says how many were logged
 * late. Only staff records carry a typed date: the on-screen receipt and AccessLoop's own emails are recorded when
 * they happen.
 */
export function ackRecordedLate(s: ReplayedCase): boolean {
  const expected = ackChannelFor(s.channel);
  const counted = s.acks.filter((a) => a.channel === expected).sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  if (!counted || counted.givenOn === null) return false;
  return daysBetween(counted.givenOn, zonedDate(counted.recordedAt)) > ACK_RECORDED_LATE_DAYS;
}

/** The backends that count as real AI for the reporter-correction rate (domain §10). */
export const REAL_AI_BACKENDS = ["claude-cli", "api"] as const;
/** What the reporter did with the AI summary on the review step (cases.summarySource). */
const REPORTER_REVIEWED = ["ai_confirmed", "ai_edited", "reporter_words"];
const REPORTER_CORRECTED = ["ai_edited", "reporter_words"];

/**
 * A summary made by a real model (claude-cli or api) that the reporter reviewed. Staff-logged feedback
 * (summarySource "staff") is left out: nobody who reported it saw the summary, so it says nothing about accuracy.
 */
export function aiReviewedByReporter(s: ReplayedCase): boolean {
  return (
    s.ai !== null &&
    (REAL_AI_BACKENDS as readonly string[]).includes(s.ai.backend) &&
    REPORTER_REVIEWED.includes(s.ai.summarySource ?? "")
  );
}

/** ...and the reporter edited it ("Change it") or rejected it ("Keep my words only"). */
export function aiCorrectedByReporter(s: ReplayedCase): boolean {
  return aiReviewedByReporter(s) && REPORTER_CORRECTED.includes(s.ai!.summarySource ?? "");
}

/** "2026-03": the month the case was received (display time zone). */
export function receivedMonth(s: ReplayedCase): string {
  return monthOf(s.receivedOn);
}

/** "2026-03": the month the reporter confirmed the fix, or null. */
export function verifiedMonth(s: ReplayedCase): string | null {
  return s.verifiedAt ? monthOf(zonedDate(s.verifiedAt)) : null;
}

/** Calendar days from received to verified, or null. */
export function daysToVerified(s: ReplayedCase): number | null {
  return s.verifiedAt ? daysBetween(s.receivedOn, zonedDate(s.verifiedAt)) : null;
}

// ---------- Needs attention (domain §10 item 4) ----------

export const ATTENTION_REASONS = ["redaction", "retest", "stalled", "unacknowledged"] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

/** A re-test is "open too long" after more than this many days. */
export const RETEST_OPEN_DAYS = 14;
/** An assigned case with no fix logged for at least this many days needs attention. */
export const STALLED_ASSIGNED_DAYS = 30;

export interface AttentionHit {
  reason: AttentionReason;
  /** When the waiting started (received, re-test requested, assigned). */
  since: Date;
  /** Whole calendar days from `since` to today. */
  days: number;
}

/**
 * Why a case needs attention now, in domain order: a new case waiting for redaction review; a re-test open for
 * more than 14 days; assigned with no fix logged for 30+ days; non-anonymous with no acknowledgement recorded in
 * the intake channel. Spam is never listed.
 */
export function attentionReasons(s: ReplayedCase, now: Date): AttentionHit[] {
  if (isSpam(s)) return [];
  const today = todayOf(now);
  const days = (d: Date) => daysBetween(zonedDate(d), today);
  const hits: AttentionHit[] = [];
  if (s.status === "new" && s.redactionApprovedAt === null) {
    hits.push({ reason: "redaction", since: s.receivedAt, days: days(s.receivedAt) });
  }
  if (s.status === "retest_open") {
    const open = s.retestRounds[s.retestRounds.length - 1];
    if (open && open.outcome === "open" && days(open.requestedAt) > RETEST_OPEN_DAYS) {
      hits.push({ reason: "retest", since: open.requestedAt, days: days(open.requestedAt) });
    }
  }
  if (s.status === "assigned" && s.assignedSince && days(s.assignedSince) >= STALLED_ASSIGNED_DAYS) {
    hits.push({ reason: "stalled", since: s.assignedSince, days: days(s.assignedSince) });
  }
  if (!s.isAnonymous && !acknowledgedInChannel(s)) {
    hits.push({ reason: "unacknowledged", since: s.receivedAt, days: days(s.receivedAt) });
  }
  return hits;
}
