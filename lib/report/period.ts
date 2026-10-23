// Reporting periods for progress reports. A period is an inclusive range of calendar dates in the display time zone
// (America/Toronto), the same "received in the period" rule lib/metrics uses (a case received at 2026-01-01T04:30Z is
// received on Dec 31 locally). Pure and client-safe.
import { isIsoDate } from "@/lib/dates";
import { periodLabel as metricsPeriodLabel } from "@/lib/metrics/period";
import type { ReportPeriod } from "./types";

export type PeriodFieldErrors = Partial<Record<"start" | "end", string>>;

/**
 * Two typed dates (native date inputs) -> a period, or the field errors to show. The end may be in the future
 * (a 2026 report can be drafted in October); the start must not be after the end.
 */
export function parsePeriod(start: string, end: string): { ok: true; period: ReportPeriod } | { ok: false; fieldErrors: PeriodFieldErrors } {
  const s = start.trim();
  const e = end.trim();
  const fieldErrors: PeriodFieldErrors = {};
  if (!s) fieldErrors.start = "Enter the first day of the period.";
  else if (!isIsoDate(s)) fieldErrors.start = "Enter a real date, for example 2026-01-01.";
  if (!e) fieldErrors.end = "Enter the last day of the period.";
  else if (!isIsoDate(e)) fieldErrors.end = "Enter a real date, for example 2026-12-31.";
  if (!fieldErrors.start && !fieldErrors.end && s > e) fieldErrors.end = "The last day must be on or after the first day.";
  if (fieldErrors.start || fieldErrors.end) return { ok: false, fieldErrors };
  return { ok: true, period: { start: s, end: e } };
}

/** January 1 to December 31 of one year. */
export function isCalendarYear(p: ReportPeriod): boolean {
  return p.start.slice(0, 4) === p.end.slice(0, 4) && p.start.endsWith("-01-01") && p.end.endsWith("-12-31");
}

/** "2026" for a calendar year, otherwise "Jan 1, 2026 to Mar 31, 2026". */
export function reportPeriodLabel(p: ReportPeriod): string {
  return isCalendarYear(p) ? p.start.slice(0, 4) : metricsPeriodLabel(p);
}

/** The years a period touches (both, and any between, for a period that spans years): the years a sentence may name. */
export function periodYears(p: ReportPeriod): number[] {
  const from = Number(p.start.slice(0, 4));
  const to = Number(p.end.slice(0, 4));
  const years: number[] = [];
  for (let y = from; y <= to && years.length < 100; y++) years.push(y);
  return years;
}
