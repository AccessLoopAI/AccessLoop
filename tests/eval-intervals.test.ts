// lib/eval/intervals.ts: the 95% Wilson interval of every rate on /app/eval and in the runner's printed summary, and
// how repeats are averaged (pure; eval/score.ts is frozen and keeps the one wilson() formula). Reference values were
// computed by hand from the Wilson score formula with z = 1.96.
import { describe, expect, it } from "vitest";
import { wilson } from "@/eval/score";
import { countsOf, piiTypeRates, rate, RATE_INFO, RATE_KEYS, ratesSummary, repeatedRate, repeatedRates } from "@/lib/eval/intervals";
import type { EvalMetrics } from "@/lib/eval/results";

function metrics(over: Partial<EvalMetrics> = {}): EvalMetrics {
  return {
    n: 20,
    errors: 1,
    classification: { n: 16, top1Accuracy: 11 / 16, acceptableAccuracy: 13 / 16, macroF1: 0.6, confusion: {} },
    abstention: { n: 1, correct: 1 },
    pii: {
      total: 18,
      leakedBeforeHuman: 3,
      recallBeforeHuman: 15 / 18,
      recall95ci: wilson(15, 18),
      byType: { PERSON: { total: 6, leaked: 2 }, EMAIL: { total: 4, leaked: 0 }, PHONE: { total: 8, leaked: 1 } },
      leaks: [],
      overRedacted: { checked: 6, wronglyRemoved: 1 },
    },
    injection: { n: 2, resisted: 2 },
    latencyMs: { p50: 10, p95: 20 },
    ...over,
  };
}

describe("rate()", () => {
  it("is k of n with score.ts's 95% Wilson interval", () => {
    const r = rate(8, 10);
    expect(r.rate).toBe(0.8);
    expect(r.ci).toEqual(wilson(8, 10));
    expect(r.ci![0]).toBeCloseTo(0.4902, 4);
    expect(r.ci![1]).toBeCloseTo(0.9433, 4);
  });

  it("never claims certainty at the edges: 0 of 10 and 10 of 10 still have an interval", () => {
    expect(rate(0, 10).ci![1]).toBeCloseTo(0.2775, 4);
    expect(rate(0, 10).ci![0]).toBe(0);
    expect(rate(10, 10).ci![0]).toBeCloseTo(0.7225, 4);
    expect(rate(10, 10).ci![1]).toBe(1);
  });

  it("nothing to measure (n = 0) is no rate and no interval, not 0% or [0, 1]", () => {
    expect(rate(0, 0)).toEqual({ k: 0, n: 0, rate: null, ci: null });
  });
});

describe("repeatedRate()", () => {
  it("one repeat is rate() itself", () => {
    expect(repeatedRate([{ k: 8, n: 10 }])).toEqual({ ...rate(8, 10), repeats: 1, perRepeat: [0.8], min: 0.8, max: 0.8 });
  });

  it("over repeats: the mean count, one pass's interval (not N passes pooled), and the range", () => {
    const r = repeatedRate([{ k: 8, n: 10 }, { k: 6, n: 10 }, { k: 7, n: 10 }]);
    expect(r).toMatchObject({ k: 7, n: 10, repeats: 3, perRepeat: [0.8, 0.6, 0.7], min: 0.6, max: 0.8 });
    expect(r.rate).toBeCloseTo(0.7, 12);
    expect(r.ci).toEqual(wilson(7, 10));
    // Pooling 21 of 30 would claim a narrower interval than three passes over the same 10 reports support.
    const pooled = wilson(21, 30);
    expect(r.ci![1] - r.ci![0]).toBeGreaterThan(pooled[1] - pooled[0]);
  });

  it("a mean count need not be whole", () => {
    const r = repeatedRate([{ k: 1, n: 3 }, { k: 2, n: 3 }]);
    expect(r.k).toBe(1.5);
    expect(r.ci).toEqual(wilson(1.5, 3));
  });

  it("repeats with nothing to measure are left out of the range", () => {
    expect(repeatedRate([{ k: 0, n: 0 }, { k: 0, n: 0 }])).toMatchObject({ rate: null, ci: null, min: null, max: null, perRepeat: [null, null] });
    expect(repeatedRate([])).toMatchObject({ repeats: 0, rate: null, min: null });
  });
});

describe("the eval's rates", () => {
  it("countsOf recovers each count from a score() result", () => {
    expect(countsOf(metrics())).toEqual({
      piiRemoved: { k: 15, n: 18 },
      top1: { k: 11, n: 16 },
      acceptable: { k: 13, n: 16 },
      injectionResisted: { k: 2, n: 2 },
      abstained: { k: 1, n: 1 },
      overRedacted: { k: 1, n: 6 },
      errors: { k: 1, n: 20 },
    });
  });

  it("one pass: personal-details recall has exactly score.ts's own recall95ci", () => {
    const m = metrics();
    expect(repeatedRates([m]).piiRemoved.ci).toEqual(m.pii.recall95ci);
  });

  it("every key has a label; errors and over-redaction are the ones where lower is better", () => {
    expect(Object.keys(RATE_INFO).sort()).toEqual([...RATE_KEYS].sort());
    expect(RATE_KEYS.filter((k) => !RATE_INFO[k].higherIsBetter).sort()).toEqual(["errors", "overRedacted"]);
  });

  it("per detail type over repeats, the types with the most seeded items first", () => {
    const second = metrics({
      pii: { ...metrics().pii, byType: { PERSON: { total: 6, leaked: 4 }, EMAIL: { total: 4, leaked: 0 }, PHONE: { total: 8, leaked: 1 } } },
    });
    const rows = piiTypeRates([metrics(), second]);
    expect(rows.map((r) => r.type)).toEqual(["PHONE", "PERSON", "EMAIL"]);
    const person = rows.find((r) => r.type === "PERSON")!.rate;
    expect(person).toMatchObject({ k: 3, n: 6, min: 2 / 6, max: 4 / 6 });
    expect(person.ci).toEqual(wilson(3, 6));
  });

  it("the printed summary is numbers only: mean, interval, range", () => {
    const s = ratesSummary([metrics(), metrics({ injection: { n: 2, resisted: 1 } })]);
    expect(Object.keys(s)).toEqual([...RATE_KEYS]);
    expect(s.injectionResisted).toEqual({ k: 1.5, n: 2, rate: 0.75, ci95: wilson(1.5, 2), min: 0.5, max: 1 });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
