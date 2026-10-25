// Reporting periods and calendar arithmetic for lib/metrics (docs/domain.md §10 "period selector").
// Every date here is a calendar date (YYYY-MM-DD) in the one display time zone (lib/format.ts), so "received in
// March" and "25 days" mean the same thing on the dashboard, in the inbox filter and in the report. Pure and
// client-safe.
import { isIsoDate, zonedDate, zonedNoon } from "@/lib/dates";
import { formatDate } from "@/lib/format";

/** An inclusive range of calendar dates (display time zone): cases RECEIVED on start..end are "in the period". */
export interface Period {
  start: string;
  end: string;
}

const DAY_MS = 86_400_000;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

function dayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** Today's calendar date in the display time zone. */
export function todayOf(now: Date): string {
  return zonedDate(now);
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** The calendar date `n` days after `isoDate` (n may be negative). */
export function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "2026-03" for a YYYY-MM-DD date. */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** A real month written as YYYY-MM. */
export function isMonth(value: string): boolean {
  return MONTH.test(value);
}

/** "This year": January 1 to December 31 of the current year (display time zone). */
export function thisYear(now: Date): Period {
  const y = todayOf(now).slice(0, 4);
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

/** "Last 90 days": the 90 calendar days ending today, today included. */
export function last90Days(now: Date): Period {
  const today = todayOf(now);
  return { start: addDays(today, -89), end: today };
}

/** A custom period from two typed dates (native date inputs), or null when either is not a real date or start > end. */
export function customPeriod(start: string, end: string): Period | null {
  if (!isIsoDate(start) || !isIsoDate(end) || start > end) return null;
  return { start, end };
}

/**
 * The months a "per month" chart shows for the period: from the start's month to the month of the period's end
 * or today, whichever is earlier (no empty future months). Empty when the period starts after today.
 */
export function periodMonths(period: Period, now: Date): string[] {
  const today = todayOf(now);
  const last = monthOf(period.end < today ? period.end : today);
  const months: string[] = [];
  let [y, m] = monthOf(period.start).split("-").map(Number);
  for (let guard = 0; guard < 1200; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > last) break;
    months.push(key);
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
const MONTH_SHORT = new Intl.DateTimeFormat("en-CA", { month: "short", timeZone: "UTC" });

/** "March 2026" for "2026-03". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return MONTH_LABEL.format(new Date(Date.UTC(y, m - 1, 15)));
}

/** "Mar" for "2026-03" (chart axis labels; pair it with monthLabel in tables). */
export function monthShortLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return MONTH_SHORT.format(new Date(Date.UTC(y, m - 1, 15)));
}

/** "Mar 2026" for "2026-03" (a table on a phone). */
export function monthShortYearLabel(month: string): string {
  return `${monthShortLabel(month)} ${month.slice(0, 4)}`;
}

/** "Jan 1, 2026 to Dec 31, 2026". */
export function periodLabel(period: Period): string {
  return `${formatDate(zonedNoon(period.start))} to ${formatDate(zonedNoon(period.end))}`;
}
