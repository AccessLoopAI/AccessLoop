// Date formatting for staff and reporter pages. One fixed display time zone so server output is the
// same on every machine (there is no per-org time zone in the schema yet). See docs/decisions.md.
export const DISPLAY_TIME_ZONE = "America/Toronto";

const DATE = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: DISPLAY_TIME_ZONE });
const DATE_LONG = new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone: DISPLAY_TIME_ZONE });
const DATE_TIME = new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeStyle: "short", timeZone: DISPLAY_TIME_ZONE });

/** "Oct 14, 2026" */
export function formatDate(d: Date): string {
  return DATE.format(d);
}

/** "October 14, 2026" */
export function formatDateLong(d: Date): string {
  return DATE_LONG.format(d);
}

/** "October 14, 2026 at 10:00 a.m." */
export function formatDateTime(d: Date): string {
  return DATE_TIME.format(d);
}
