// 95% Wilson intervals for every rate on /app/eval and in the runner's printed summary (eval/README.md "Metrics we
// report"). Pure: numbers in, numbers out, so tests/eval-intervals.test.ts can check every case. The interval itself is
// eval/score.ts's own wilson() (z = 1.96), never a second copy of the formula; score.ts is frozen, so everything that
// builds on it lives here.
//
// Repeats (`npm run eval -- --repeats N`): a rate over N repeats is the mean count over the mean denominator. Its 95%
// interval is wilson(mean k, mean n): the width of ONE pass over the set. Running the same test reports again does not
// add new reports (the repeats of one report are not independent), so pooling the N passes as if they were N times as
// many reports would make the interval look narrower than the evidence is. How much the answers moved from one repeat
// to the next is shown separately, as the range of the per-repeat rates.
import { wilson } from "@/eval/score";
import type { EvalMetrics } from "./results";

/** k successes out of n. */
export interface Count {
  k: number;
  n: number;
}

/** A rate with its 95% Wilson interval. `n` 0 = nothing to measure in this set: no rate, no interval. */
export interface Rate extends Count {
  rate: number | null;
  ci: [number, number] | null;
}

export function rate(k: number, n: number): Rate {
  if (!(n > 0)) return { k, n, rate: null, ci: null };
  return { k, n, rate: k / n, ci: wilson(k, n) };
}

/** A rate over one or more repeats: `k` and `n` are means, `perRepeat` each repeat's own rate (null when its n is 0). */
export interface RepeatedRate extends Rate {
  repeats: number;
  perRepeat: (number | null)[];
  /** Lowest and highest per-repeat rate (null when no repeat had anything to measure). */
  min: number | null;
  max: number | null;
}

/** The mean rate over repeats with the interval of one pass (see the top of this file). One count = rate(). */
export function repeatedRate(counts: readonly Count[]): RepeatedRate {
  const repeats = counts.length;
  const perRepeat = counts.map((c) => (c.n > 0 ? c.k / c.n : null));
  const measured = perRepeat.filter((p): p is number => p !== null);
  const k = repeats ? counts.reduce((s, c) => s + c.k, 0) / repeats : 0;
  const n = repeats ? counts.reduce((s, c) => s + c.n, 0) / repeats : 0;
  return {
    ...rate(k, n),
    repeats,
    perRepeat,
    min: measured.length ? Math.min(...measured) : null,
    max: measured.length ? Math.max(...measured) : null,
  };
}

/** Every rate the eval reports, in page order. `higherIsBetter` false: errors and over-redaction. */
export const RATE_KEYS = ["piiRemoved", "top1", "acceptable", "injectionResisted", "abstained", "overRedacted", "errors"] as const;
export type RateKey = (typeof RATE_KEYS)[number];

export const RATE_INFO: Record<RateKey, { label: string; higherIsBetter: boolean }> = {
  piiRemoved: { label: "Personal details removed before human review", higherIsBetter: true },
  top1: { label: "Top-1 accuracy", higherIsBetter: true },
  acceptable: { label: "Acceptable accuracy", higherIsBetter: true },
  injectionResisted: { label: "Hidden instructions resisted", higherIsBetter: true },
  abstained: { label: "Vague reports sent to a person", higherIsBetter: true },
  overRedacted: { label: "Words removed by mistake (over-redaction)", higherIsBetter: false },
  errors: { label: "Reports with an AI error", higherIsBetter: false },
};

/**
 * The counts behind each rate of one score() result. Accuracy is saved as a fraction of `classification.n`, so its
 * count is recovered by rounding (it was an integer count over that n).
 */
export function countsOf(m: EvalMetrics): Record<RateKey, Count> {
  const c = m.classification;
  return {
    piiRemoved: { k: m.pii.total - m.pii.leakedBeforeHuman, n: m.pii.total },
    top1: { k: Math.round(c.top1Accuracy * c.n), n: c.n },
    acceptable: { k: Math.round(c.acceptableAccuracy * c.n), n: c.n },
    injectionResisted: { k: m.injection.resisted, n: m.injection.n },
    abstained: { k: m.abstention.correct, n: m.abstention.n },
    overRedacted: { k: m.pii.overRedacted.wronglyRemoved, n: m.pii.overRedacted.checked },
    errors: { k: m.errors, n: m.n },
  };
}

/** Every rate over the repeats of one run (one metrics object per repeat, in order). */
export function repeatedRates(repeats: readonly EvalMetrics[]): Record<RateKey, RepeatedRate> {
  const counts = repeats.map(countsOf);
  return Object.fromEntries(RATE_KEYS.map((key) => [key, repeatedRate(counts.map((c) => c[key]))])) as Record<RateKey, RepeatedRate>;
}

/** Recall per detail type over the repeats, the types with the most seeded items first. */
export function piiTypeRates(repeats: readonly EvalMetrics[]): { type: string; total: number; rate: RepeatedRate }[] {
  const types = [...new Set(repeats.flatMap((m) => Object.keys(m.pii.byType)))];
  return types
    .map((type) => {
      const counts = repeats.map((m) => {
        const t = m.pii.byType[type];
        return t ? { k: t.total - t.leaked, n: t.total } : { k: 0, n: 0 };
      });
      const r = repeatedRate(counts);
      return { type, total: r.n, rate: r };
    })
    .sort((a, b) => b.total - a.total || a.type.localeCompare(b.type));
}

/** The JSON the runner prints: each rate's mean, interval and range over the repeats (numbers only). */
export function ratesSummary(repeats: readonly EvalMetrics[]): Record<RateKey, { k: number; n: number; rate: number | null; ci95: [number, number] | null; min: number | null; max: number | null }> {
  const rates = repeatedRates(repeats);
  return Object.fromEntries(
    RATE_KEYS.map((key) => {
      const r = rates[key];
      return [key, { k: r.k, n: r.n, rate: r.rate, ci95: r.ci, min: r.min, max: r.max }];
    }),
  ) as ReturnType<typeof ratesSummary>;
}
