// The staff work queues: the inbox and My work (docs/phase7-prompt.md T2 items 5 and 6; docs/domain.md §9
// "cases.due_at", decision D8). How old a case is, and when it is due or overdue: ONE definition for the inbox's
// "Age" column and filter, My work's "Due" column, the case page and the inbox filters (lib/metrics/filters.ts).
// Pure and client-safe.
import { isIsoDate, zonedDate } from "@/lib/dates";
import { DISPLAY_TIME_ZONE } from "@/lib/format";
import type { CaseStatus } from "@/lib/status";
import { addDays, daysBetween, todayOf } from "./period";
import type { ReplayedCase } from "./replay";

/* ------------------------------------------------------------------ age */

/** Whole calendar days from the day the case was received to today (display time zone): the inbox's "Age". */
export function ageInDays(receivedAt: Date, now: Date): number {
  return Math.max(0, daysBetween(zonedDate(receivedAt), todayOf(now)));
}

/** The same, for a replayed case (its received date comes from the `submitted` event). */
export function caseAgeDays(s: ReplayedCase, now: Date): number {
  return Math.max(0, daysBetween(s.receivedOn, todayOf(now)));
}

/** The inbox's "Age" choices (query value `age`): whole days since the case was received. */
export const AGE_FILTERS = ["under_7", "7_29", "30_89", "90_plus"] as const;
export type AgeFilter = (typeof AGE_FILTERS)[number];

const AGE_RANGES: Record<AgeFilter, readonly [number, number]> = {
  under_7: [0, 6],
  "7_29": [7, 29],
  "30_89": [30, 89],
  "90_plus": [90, Number.POSITIVE_INFINITY],
};

export const AGE_FILTER_LABELS: Record<AgeFilter, string> = {
  under_7: "Under 7 days",
  "7_29": "7 to 29 days",
  "30_89": "30 to 89 days",
  "90_plus": "90 days or more",
};

/** Is a case this many days old in the chosen range? */
export function inAgeRange(days: number, f: AgeFilter): boolean {
  const [min, max] = AGE_RANGES[f];
  return days >= min && days <= max;
}

/** "Today", "1 day", "12 days": an age in words (the table cell). */
export function ageLabel(days: number): string {
  return days <= 0 ? "Today" : days === 1 ? "1 day" : `${days.toLocaleString("en-CA")} days`;
}

/* ------------------------------------------------------------------ due dates (D8) */

const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** How far the display time zone is ahead of UTC at that instant (negative in Canada), in ms. */
function zoneOffsetMs(at: Date): number {
  const p = Object.fromEntries(PARTS.formatToParts(at).map((x) => [x.type, x.value]));
  const asIfUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Midnight at the start of that calendar date in the display time zone. The offset is read at UTC midnight (7 or 8
 * p.m. the evening before, in Toronto): clocks change at 2 a.m., never between then and midnight.
 */
function zonedStartOfDay(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  return new Date(utcMidnight - zoneOffsetMs(new Date(utcMidnight)));
}

/**
 * The instant stored in cases.due_at for a due date typed as YYYY-MM-DD: the last millisecond of that day in the
 * display time zone. So a case is past due once its due DAY is over, and "due_at <= now" (the daily job's alert on
 * main) and "the due date is before today" always agree.
 */
export function dueAtForDate(isoDate: string): Date {
  if (!isIsoDate(isoDate)) throw new Error("dueAtForDate: not a YYYY-MM-DD date");
  return new Date(zonedStartOfDay(addDays(isoDate, 1)).getTime() - 1);
}

/** The calendar date (YYYY-MM-DD, display time zone) of a stored due date. */
export function dueDateOf(dueAt: Date): string {
  return zonedDate(dueAt);
}

/**
 * D8 (docs/domain.md §9): a case is overdue when its due date has passed while it is still assigned: no fix logged
 * (a logged fix moves it on), not closed. A case sent back to "assigned" by the reporter or a reopen is overdue
 * again if its due date has passed: the barrier is still there.
 */
export function pastDue(status: CaseStatus, dueAt: Date | null, now: Date): boolean {
  return status === "assigned" && dueAt !== null && dueAt.getTime() < now.getTime();
}

/** The same, for a replayed case. */
export function isOverdue(s: ReplayedCase, now: Date): boolean {
  return pastDue(s.status, s.dueAt, now);
}

export type DueState =
  | { kind: "none" }
  /** `days`: whole days since the due date (1 or more). */
  | { kind: "overdue"; on: string; dueAt: Date; days: number }
  | { kind: "today"; on: string; dueAt: Date; days: 0 }
  /** `days`: whole days until the due date (1 or more). */
  | { kind: "upcoming"; on: string; dueAt: Date; days: number };

/**
 * What a queue shows for a case's due date. Only an assigned case has one that matters: after a fix is logged the
 * date is history (it stays in the case's log), so every other status shows nothing.
 */
export function dueState(status: CaseStatus, dueAt: Date | null, now: Date): DueState {
  if (status !== "assigned" || dueAt === null) return { kind: "none" };
  const on = dueDateOf(dueAt);
  const days = daysBetween(todayOf(now), on);
  if (pastDue(status, dueAt, now)) return { kind: "overdue", on, dueAt, days: Math.max(1, -days) };
  if (days <= 0) return { kind: "today", on, dueAt, days: 0 };
  return { kind: "upcoming", on, dueAt, days };
}
