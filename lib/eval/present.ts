// How /app/eval words a saved eval result (eval/README.md "Metrics we report (and how to phrase them honestly)").
// Pure, so tests can check the phrasing. Every number comes from the saved result (eval/score.ts output); intervals
// come from score.ts's own wilson(), directly (piiTypeRows) or through lib/eval/intervals.ts (every rate, repeats).
import { wilson } from "@/eval/score";
import { repeatedRates, type Rate, type RepeatedRate } from "./intervals";
import type { EvalMetrics, PredictionRecord } from "./results";

/** Short area names for table headers (the long ACA s.5 headings are in lib/report/headings.ts). */
export const AREA_SHORT: Record<string, string> = {
  employment: "Employment",
  built_environment: "Built environment",
  ict: "ICT",
  communication_other: "Communication (other than ICT)",
  procurement: "Procurement",
  programs_services: "Programs and services",
  transportation: "Transportation",
  abstain: "Abstained (sent to a person)",
};
const AREA_ORDER = Object.keys(AREA_SHORT);

export function areaLabel(key: string | null): string {
  if (key === null) return "None (should abstain)";
  return AREA_SHORT[key] ?? key;
}

/** What each detail type is, in staff words. */
export const PII_TYPE_LABELS: Record<string, string> = {
  PERSON: "Person names",
  STAFF_NAME: "Staff names",
  EMAIL: "Email addresses",
  PHONE: "Phone numbers",
  SIN: "Social insurance numbers",
  POSTAL_CODE: "Postal codes",
  HEALTH_CARD: "Health card numbers",
  ACCOUNT_NUMBER: "Card and account numbers",
  STREET_ADDRESS: "Street addresses",
  URL: "Links with query strings",
  DOB: "Dates of birth",
  QUASI_ID: "Quasi-identifiers",
  OTHER_ID: "Other IDs",
};

export function piiTypeLabel(type: string): string {
  return PII_TYPE_LABELS[type] ?? type;
}

/** 0.6875 -> "69%". */
export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** [0.81, 1] -> "81–100%" (an en dash). */
export function ciRange([lo, hi]: readonly [number, number]): string {
  return `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`;
}

/** How many of `n` a saved fraction stands for (top-1 accuracy 0.6875 of 16 -> 11). */
export function countOf(fraction: number, n: number): number {
  return Math.round(fraction * n);
}

/** "1 report" / "3 reports". */
export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** 340 -> "340 ms"; 1234 -> "1.2 s". */
export function latency(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * eval/README.md's sentence, never "0 missed": "N of M seeded items removed before human review (95% CI x–y%)".
 * The page adds "every case then gets human review before any owner sees it." after it.
 */
export function piiSentence(pii: EvalMetrics["pii"]): string {
  const removed = pii.total - pii.leakedBeforeHuman;
  return `${removed} of ${pii.total} seeded ${pii.total === 1 ? "item" : "items"} removed before human review (95% CI ${ciRange(pii.recall95ci)})`;
}

export interface PiiTypeRow {
  type: string;
  label: string;
  total: number;
  removed: number;
  recall: number;
  ci: [number, number];
}

/** Recall by type with its own 95% Wilson interval, the types with the most seeded items first. */
export function piiTypeRows(pii: EvalMetrics["pii"]): PiiTypeRow[] {
  return Object.entries(pii.byType)
    .map(([type, t]) => {
      const removed = t.total - t.leaked;
      return { type, label: piiTypeLabel(type), total: t.total, removed, recall: t.total ? removed / t.total : 1, ci: wilson(removed, t.total) };
    })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/** One AI function's calls in a run: how many, their latency, and the token usage the backend reported. */
export interface CallStatsRow {
  fn: "flagPii" | "structure";
  label: string;
  calls: number;
  /** p50 / p95 of the calls' latency, with score.ts's percentile rule; null without calls. */
  p50: number | null;
  p95: number | null;
  /** Calls that reported token usage (0 = not reported: the fake backend, or a result saved before usage was kept). */
  withUsage: number;
  inputTokens: number;
  outputTokens: number;
  /** api: calls that needed the one retry after HTTP 429/529. */
  retried: number;
}

const CALL_LABELS: Record<CallStatsRow["fn"], string> = {
  flagPii: "Personal details (flagPii)",
  structure: "Summary and area (structure)",
};

/** Per function, in pipeline order (flagPii, then structure): counts, latency percentiles and token totals. */
export function callStats(predictions: readonly PredictionRecord[]): CallStatsRow[] {
  return (["flagPii", "structure"] as const).map((fn) => {
    const calls = predictions.flatMap((p) => (p.calls[fn] ? [p.calls[fn]!] : []));
    const sorted = calls.map((c) => c.latencyMs).sort((a, b) => a - b);
    const pct = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);
    const used = calls.flatMap((c) => (c.usage ? [c.usage] : []));
    return {
      fn,
      label: CALL_LABELS[fn],
      calls: calls.length,
      p50: pct(0.5),
      p95: pct(0.95),
      withUsage: used.length,
      inputTokens: used.reduce((n, u) => n + u.inputTokens, 0),
      outputTokens: used.reduce((n, u) => n + u.outputTokens, 0),
      retried: calls.filter((c) => (c.attempts ?? 1) > 1).length,
    };
  });
}

/** A token total for a table cell: "Not reported", "1,234", or "1,234 (from 18 of 20 calls)". */
export function tokenCell(total: number, withUsage: number, calls: number): string {
  if (withUsage === 0) return "Not reported";
  const n = total.toLocaleString("en-CA");
  return withUsage < calls ? `${n} (from ${withUsage} of ${calls} calls)` : n;
}

/** The confusion matrix's rows (expected) and columns (predicted, "abstain" last), in a fixed area order. */
export function confusionAxes(confusion: EvalMetrics["classification"]["confusion"]): { rows: string[]; cols: string[] } {
  const byOrder = (a: string, b: string) => {
    const ia = AREA_ORDER.indexOf(a), ib = AREA_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  };
  const rows = Object.keys(confusion).sort(byOrder);
  const cols = [...new Set([...rows, ...Object.values(confusion).flatMap((r) => Object.keys(r))])].sort(byOrder);
  return { rows, cols };
}

// ---- Sets, rates with intervals, repeats (lib/eval/intervals.ts computes; these only word it) ----

/** Each set in words. Sets added on other branches (injection, silver) are named here so the page reads them. */
export const SET_NAMES: Record<string, string> = {
  visible: "Visible set",
  holdout: "Holdout set",
  injection: "Injection set",
  silver: "Silver set (published reports)",
};

export function setName(set: string): string {
  return SET_NAMES[set] ?? `${set.slice(0, 40)} set`;
}

/** 11.333 -> "11.3"; 11 -> "11" (a mean count over repeats). */
export function meanCount(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

/** "11 of 16 (69%)"; over repeats "69% (mean 11.3 of 16)"; "None in this set" when there is nothing to measure. */
export function rateText(r: RepeatedRate): string {
  if (r.rate === null) return "None in this set";
  if (r.repeats <= 1) return `${meanCount(r.k)} of ${meanCount(r.n)} (${percent(r.rate)})`;
  return `${percent(r.rate)} (mean ${meanCount(r.k)} of ${meanCount(r.n)})`;
}

/** The 95% Wilson interval, "None" when there is no rate. */
export function ciText(r: Rate): string {
  return r.ci ? ciRange(r.ci) : "None";
}

/** The spread of the per-repeat rates: "62–75%", or "75% in every repeat". */
export function rangeText(r: RepeatedRate): string {
  if (r.min === null || r.max === null) return "None";
  return r.min === r.max ? `${percent(r.min)} in every repeat` : ciRange([r.min, r.max]);
}

/** A set with no seeded personal details (the silver set's one-line statements): nothing to measure, never "0 of 0". */
export const NO_SEEDED_PII = "No personal details are seeded in this set, so this run does not measure their removal";

/** True when no repeat of the run had any seeded personal detail to remove. */
export function noSeededPii(repeats: readonly EvalMetrics[]): boolean {
  return repeats.every((m) => m.pii.total === 0);
}

/**
 * The page's headline sentence on personal details. One pass: piiSentence (eval/README.md's wording). Over repeats:
 * the mean, its interval and the range across repeats, never "0 missed". A set with nothing seeded says so.
 */
export function piiHeadline(repeats: readonly EvalMetrics[]): string {
  if (noSeededPii(repeats)) return NO_SEEDED_PII;
  if (repeats.length <= 1) return piiSentence(repeats[0].pii);
  const r = repeatedRates(repeats).piiRemoved;
  return (
    `${meanCount(r.k)} of ${meanCount(r.n)} seeded items removed before human review on average over ${repeats.length} repeats ` +
    `(95% CI ${ciText(r)}; ${r.min !== null && r.min === r.max ? "the same in every repeat" : `${rangeText(r)} across repeats`})`
  );
}
