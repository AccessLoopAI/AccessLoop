// lib/eval/usage.ts: latency percentiles, token totals per AI function and per report, the price constants from the
// environment and the cost per report (api runs only). Pure: made-up call records, never a model.
import { describe, expect, it } from "vitest";
import type { PredictionRecord } from "@/lib/eval/results";
import {
  callCostUsd,
  costPerReport,
  percentile,
  priceFor,
  pricesFromEnv,
  summarizeCalls,
  tokensPerReport,
  usd,
  type PriceTable,
} from "@/lib/eval/usage";

function pred(i: number, over: Partial<PredictionRecord["calls"]> = {}, latencyMs = 100 * (i + 1)): PredictionRecord {
  return {
    id: `F${i}`,
    latencyMs,
    calls: {
      flagPii: { model: "claude-haiku-5-5", promptSha: "p", latencyMs: 40 + i, usage: { inputTokens: 400, outputTokens: 30 } },
      structure: { model: "claude-sonnet-5-5", promptSha: "s", latencyMs: 60 + i, usage: { inputTokens: 1000, outputTokens: 120 } },
      ...over,
    },
  };
}

const TABLE: PriceTable = { setOn: "2026-10-20", models: { "claude-haiku-5-5": { input: 0.1, output: 0.5 }, "claude-sonnet-5-5": { input: 2, output: 10 } } };

describe("percentile()", () => {
  it("uses eval/score.ts's rule: the value at floor(q * n) of the sorted list", () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 0.95)).toBe(5);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(3);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe("summarizeCalls()", () => {
  it("per function: calls, p50/p95 latency, token totals and retries; per report: p50/p95", () => {
    const preds = [0, 1, 2, 3].map((i) => pred(i));
    preds[0].calls.flagPii!.attempts = 2;
    preds[1].calls.structure = { model: "claude-sonnet-5-5", promptSha: "s", latencyMs: 61 }; // no usage reported
    preds[2].calls.flagPii!.usage = { inputTokens: 400, outputTokens: 30, cacheReadInputTokens: 50 };
    const s = summarizeCalls(preds);
    expect(s.flagPii).toEqual({
      calls: 4, p50Ms: 42, p95Ms: 43, withUsage: 4, inputTokens: 1600, outputTokens: 120,
      cacheReadInputTokens: 50, cacheCreationInputTokens: 0, retried: 1,
    });
    expect(s.structure).toMatchObject({ calls: 4, withUsage: 3, inputTokens: 3000, outputTokens: 360, retried: 0 });
    expect(s.report).toEqual({ n: 4, p50Ms: 300, p95Ms: 400 });
  });

  it("a layer-1-only run has no flagPii calls; the fake backend reports no usage", () => {
    const preds = [0, 1].map((i) => ({ ...pred(i), calls: { structure: { model: "fake", promptSha: "s", latencyMs: 1 } } }));
    const s = summarizeCalls(preds);
    expect(s.flagPii).toMatchObject({ calls: 0, p50Ms: null, p95Ms: null, withUsage: 0 });
    expect(s.structure).toMatchObject({ calls: 2, withUsage: 0, inputTokens: 0 });
    expect(tokensPerReport(preds)).toBeNull();
  });
});

describe("tokensPerReport()", () => {
  it("is the mean over the reports whose every call reported usage", () => {
    const preds = [pred(0), pred(1), pred(2, { structure: { model: "claude-sonnet-5-5", promptSha: "s", latencyMs: 1 } })];
    expect(tokensPerReport(preds)).toEqual({ reports: 2, of: 3, input: 1400, output: 150 });
  });
});

describe("price constants", () => {
  it("unset is unset; a date alone, a bad date or a bad entry is a plain problem, never a throw", () => {
    expect(pricesFromEnv({})).toEqual({ ok: false, reason: "unset" });
    expect(pricesFromEnv({ AI_PRICES_SET_ON: "2026-10-20" })).toMatchObject({ ok: false, reason: "invalid", problem: expect.stringContaining("AI_PRICES_USD_PER_MTOK is empty") });
    for (const setOn of ["", "20-10-2026", "2026-13-45", "yesterday"]) {
      expect(pricesFromEnv({ AI_PRICES_SET_ON: setOn, AI_PRICES_USD_PER_MTOK: "m=1/2" })).toMatchObject({ ok: false, reason: "invalid", problem: expect.stringContaining("AI_PRICES_SET_ON") });
    }
    for (const bad of ["m=1", "m=1/2/3/4/5", "=1/2", "m=one/2", "m=-1/2", "m 1/2", "m=1/2,"]) {
      const r = pricesFromEnv({ AI_PRICES_SET_ON: "2026-10-20", AI_PRICES_USD_PER_MTOK: bad });
      if (bad === "m=1/2,") expect(r.ok).toBe(true); // a trailing comma is only an empty entry
      else expect(r).toMatchObject({ ok: false, reason: "invalid" });
    }
  });

  it("reads model=input/output[/cache read[/cache write]] in US dollars per million tokens, with the date", () => {
    const r = pricesFromEnv({
      AI_PRICES_SET_ON: " 2026-10-20 ",
      AI_PRICES_USD_PER_MTOK: "claude-sonnet-5-5=2/10/0.2/2.5, claude-haiku-5-5 = 0.1/0.5",
    });
    expect(r).toEqual({
      ok: true,
      table: {
        setOn: "2026-10-20",
        models: { "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, "claude-haiku-5-5": { input: 0.1, output: 0.5 } },
      },
    });
  });

  it("a call's model matches an entry exactly or as its dated ID, nothing looser", () => {
    expect(priceFor(TABLE, "claude-haiku-5-5")).toEqual({ input: 0.1, output: 0.5 });
    expect(priceFor(TABLE, "claude-haiku-5-5-20261001")).toEqual({ input: 0.1, output: 0.5 });
    expect(priceFor(TABLE, "claude-haiku-5")).toBeNull();
    expect(priceFor(TABLE, "claude-haiku-5-5-preview")).toBeNull();
    expect(priceFor(TABLE, "toString")).toBeNull();
  });
});

describe("cost", () => {
  it("one call: input and output at their prices; the prompt cache only with a cache price", () => {
    expect(callCostUsd({ inputTokens: 1_000_000, outputTokens: 100_000 }, { input: 2, output: 10 })).toBeCloseTo(3, 12);
    expect(callCostUsd({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 10 }, { input: 2, output: 10 })).toBeNull();
    expect(callCostUsd({ inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 10 }, { input: 2, output: 10, cacheRead: 0.2 })).toBeNull();
    expect(callCostUsd({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 1_000_000, cacheCreationInputTokens: 0 }, { input: 2, output: 10, cacheRead: 0.2 })).toBeCloseTo(0.2, 12);
  });

  it("per report: the mean over the reports whose calls all reported usage", () => {
    const perReport = (400 * 0.1 + 30 * 0.5 + 1000 * 2 + 120 * 10) / 1_000_000;
    const preds = [pred(0), pred(1), pred(2, { structure: { model: "claude-sonnet-5-5", promptSha: "s", latencyMs: 1 } })];
    const cost = costPerReport(preds, TABLE);
    expect(cost).toMatchObject({ ok: true, reports: 2, of: 3, setOn: "2026-10-20" });
    expect(cost.ok && cost.usdPerReport).toBeCloseTo(perReport, 12);
  });

  it("says why it can't be shown: no usage, a model without a price, the cache without a cache price", () => {
    const noUsage = [pred(0, { flagPii: { model: "claude-haiku-5-5", promptSha: "p", latencyMs: 1 } })];
    expect(costPerReport(noUsage, TABLE)).toEqual({ ok: false, reason: "no-usage" });
    const other = [pred(0, { structure: { model: "claude-opus-5-5", promptSha: "s", latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1 } } })];
    expect(costPerReport(other, TABLE)).toEqual({ ok: false, reason: "no-price", model: "claude-opus-5-5" });
    const cached = [pred(0, { structure: { model: "claude-sonnet-5-5", promptSha: "s", latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 5 } } })];
    expect(costPerReport(cached, TABLE)).toEqual({ ok: false, reason: "no-cache-price", model: "claude-sonnet-5-5" });
  });

  it("formats US dollars: four decimals under a dollar, two above", () => {
    expect(usd(0.003255)).toBe("US$0.0033");
    expect(usd(3.2)).toBe("US$3.20");
  });
});
