// Calendar dates typed by staff (the date a phone call came in, the date they acknowledged it), read in the one
// display time zone (lib/format.ts DISPLAY_TIME_ZONE, America/Toronto). Pure and client-safe.
import { DISPLAY_TIME_ZONE } from "./format";

const YMD = new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
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

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-10-19": the calendar date of `d` in the display time zone. */
export function zonedDate(d: Date): string {
  const p = Object.fromEntries(YMD.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** A real calendar date written as YYYY-MM-DD (what a native date input sends). */
export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 9999) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Noon of that calendar date in the display time zone, as an instant (noon is never inside a DST change). */
export function zonedNoon(isoDate: string): Date {
  if (!isIsoDate(isoDate)) throw new Error("zonedNoon: not a YYYY-MM-DD date");
  const [y, m, d] = isoDate.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 12);
  const p = Object.fromEntries(PARTS.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asIfUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return new Date(guess - (asIfUtc - guess));
}

/**
 * The instant to store for a date a person typed: now when it is today (the event happens now), otherwise noon
 * of that date in the display time zone (staff-logged intake in the past, a past acknowledgement).
 */
export function instantForDate(isoDate: string, now: Date): Date {
  return isoDate === zonedDate(now) ? now : zonedNoon(isoDate);
}

/** The same calendar date `years` years earlier (Feb 29 becomes Feb 28). */
export function yearsBefore(isoDate: string, years: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = new Date(Date.UTC(y - years, m - 1, d));
  if (t.getUTCMonth() !== m - 1) t.setUTCDate(0);
  return t.toISOString().slice(0, 10);
}

export type DateProblem = "missing" | "invalid" | "future" | "too_old" | "before_min";

/**
 * Check a typed date against today (display time zone): it must be a real date, not in the future, at most 7 years
 * ago (ACR s.19 keeps feedback for 7 years), and not before `min` when given (e.g. the date the feedback arrived).
 */
export function checkPastDate(value: string, now: Date, min?: string): DateProblem | null {
  const v = value.trim();
  if (!v) return "missing";
  if (!isIsoDate(v)) return "invalid";
  const today = zonedDate(now);
  if (v > today) return "future";
  if (v < yearsBefore(today, 7)) return "too_old";
  if (min && v < min) return "before_min";
  return null;
}
