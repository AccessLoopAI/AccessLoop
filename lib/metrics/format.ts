// Numbers as words for the dashboard (and later the report): the ONE place a rate becomes "88%" or a median becomes
// "12.5 days", so a component never rounds or computes anything itself (docs/domain.md §10 "No number is computed
// in a component"). Pure and client-safe.
import type { AttentionItem, Rate } from "./compute";
import { ATTENTION_LABELS } from "./filters";

/** A rate as a whole percent ("88%"), or null when there is no denominator (show "No data yet", never 0%). */
export function percentLabel(rate: Rate): string | null {
  if (rate === null) return null;
  return `${Math.round(rate * 100)}%`;
}

/** "14", "12.5": a whole number as is, anything else to one decimal (a median of an even count can be a half). */
export function decimalLabel(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** "1 day", "14 days", "12.5 days". */
export function daysLabel(n: number): string {
  return n === 1 ? "1 day" : `${decimalLabel(n)} days`;
}

/** "under 1 hour", "1 hour", "5.5 hours" (F_ACK's median, already rounded to one decimal). */
export function hoursLabel(h: number): string {
  if (h < 1) return "under 1 hour";
  if (h === 1) return "1 hour";
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hours`;
}

/** "1 case", "16 cases"; pass other nouns for other things ("1 round", "9 rounds"). */
export function countLabel(n: number, one = "case", many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What NO DATA looks like on a tile (a null rate or a null median). */
export const NO_DATA_YET = "No data yet";

/** "Waiting for redaction review" for a reason key (sentence case). */
export function attentionReasonLabel(reason: AttentionItem["reason"]): string {
  const s = ATTENTION_LABELS[reason];
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** How long a "Needs attention" item has waited, in the words of its reason (domain §10's expected-values table). */
export function attentionWaitLabel(item: Pick<AttentionItem, "reason" | "days">): string {
  const d = daysLabel(item.days);
  switch (item.reason) {
    case "redaction":
      return item.days === 0 ? "Received today" : `Received ${d} ago`;
    case "retest":
      return `Re-test open ${d}`;
    case "stalled":
      return `Assigned ${d}, no fix logged`;
    case "unacknowledged":
      return item.days === 0 ? "Received today" : `Received ${d} ago`;
  }
}
