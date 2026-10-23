// The dashboard's deadline banner (docs/domain.md §1.5 and §10 "the next deliverable for the org's entity class with
// the days left, e.g. 'Progress report due June 1, 2027: 225 days'"). Pure and client-safe; `now` is the server's.
import { zonedNoon } from "@/lib/dates";
import { formatDateLong } from "@/lib/format";
import { daysBetween, todayOf } from "./period";

/** orgs.entity_class (db/schema.ts). */
export type EntityClass = "federal_public" | "private_large" | "private_small";

export interface Deadline {
  /** What is due: a progress report, or (small private organizations) an updated accessibility plan. */
  kind: "progress_report" | "accessibility_plan";
  /** "Progress report", "Updated accessibility plan". */
  what: string;
  /** The due date, YYYY-MM-DD (display time zone). */
  due: string;
  /** "June 1, 2027". */
  dueLabel: string;
  /** Whole calendar days from today to the due date (0 = today; negative once it has passed). */
  daysLeft: number;
  /** "Progress report due June 1, 2027" ("... was due ..." once it has passed). */
  lead: string;
  /** "225 days", "1 day", "today", "3 days ago". */
  countdown: string;
  /** "Progress report due June 1, 2027: 225 days" (the banner's sentence, domain §10's wording) = lead + ": " + countdown. */
  sentence: string;
}

/** Domain §1.5: the next deliverable per entity class. */
export const DEADLINES: Record<EntityClass, { kind: Deadline["kind"]; what: string; due: string }> = {
  federal_public: { kind: "progress_report", what: "Progress report", due: "2026-12-31" },
  private_large: { kind: "progress_report", what: "Progress report", due: "2027-06-01" },
  private_small: { kind: "accessibility_plan", what: "Updated accessibility plan", due: "2027-06-01" },
};

/** "1 day", "225 days". */
const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/** The org's next deliverable and the days left, from `now` (display time zone, whole calendar days). */
export function nextDeadline(entityClass: EntityClass, now: Date): Deadline {
  const d = DEADLINES[entityClass];
  const dueLabel = formatDateLong(zonedNoon(d.due));
  const daysLeft = daysBetween(todayOf(now), d.due);
  const lead = daysLeft >= 0 ? `${d.what} due ${dueLabel}` : `${d.what} was due ${dueLabel}`;
  const countdown = daysLeft > 0 ? days(daysLeft) : daysLeft === 0 ? "today" : `${days(-daysLeft)} ago`;
  return { kind: d.kind, what: d.what, due: d.due, dueLabel, daysLeft, lead, countdown, sentence: `${lead}: ${countdown}` };
}
