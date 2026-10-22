// Time, tokens and cost of an eval run's AI calls (the runner's saved `callSummary` and the "Time, tokens and cost"
// card on /app/eval). Pure: it reads the saved per-call records (lib/eval/results.ts CallRecord: model, latency and,
// when the backend reported them, token counts) and never any text.
//
// Cost per report is shown for the api backend only, from the price constants a human copies from Anthropic's pricing
// page into the environment, together with the date they did it (.env.example "Eval prices"):
//   AI_PRICES_SET_ON=2026-10-20
//   AI_PRICES_USD_PER_MTOK=claude-sonnet-5-5=2/10,claude-haiku-5-5=0.1/0.5
// Each entry is `<model id>=<input>/<output>[/<cache read>[/<cache write>]]` in US dollars per million tokens. A call's
// model matches an entry exactly or as a dated ID of it (`claude-haiku-5-5-20261001`). A call whose model has no entry,
// or that read or wrote the prompt cache without a cache price, makes the cost "not available" rather than a guess.
// claude-cli runs on the team's own subscription ("Subscription: no per-call cost"); fake runs cost nothing.
import type { CallRecord, CallUsage, PredictionRecord } from "./results";

/** The percentile rule of eval/score.ts (its p50/p95): the value at floor(q * n) of the sorted list. null: no values. */
export function percentile(values: readonly number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

export const CALL_FUNCTIONS = ["flagPii", "structure"] as const;
export type CallFunction = (typeof CALL_FUNCTIONS)[number];

/** One AI function's calls in a run (all repeats): numbers only. */
export interface CallSummaryRow {
  calls: number;
  p50Ms: number | null;
  p95Ms: number | null;
  /** Calls that reported token usage (0: the fake backend, or a result saved before usage was kept). */
  withUsage: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /** api: calls that needed the one retry after HTTP 429/529. */
  retried: number;
}

export interface CallSummary {
  flagPii: CallSummaryRow;
  structure: CallSummaryRow;
  /** One test report = its AI steps end to end (eval/score.ts Prediction.latencyMs). */
  report: { n: number; p50Ms: number | null; p95Ms: number | null };
}

function callsOf(predictions: readonly PredictionRecord[], fn: CallFunction): CallRecord[] {
  return predictions.flatMap((p) => (p.calls[fn] ? [p.calls[fn]!] : []));
}

export function summarizeCallsOf(calls: readonly CallRecord[]): CallSummaryRow {
  const used = calls.flatMap((c) => (c.usage ? [c.usage] : []));
  const latencies = calls.map((c) => c.latencyMs);
  const sum = (pick: (u: CallUsage) => number | undefined) => used.reduce((s, u) => s + (pick(u) ?? 0), 0);
  return {
    calls: calls.length,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    withUsage: used.length,
    inputTokens: sum((u) => u.inputTokens),
    outputTokens: sum((u) => u.outputTokens),
    cacheReadInputTokens: sum((u) => u.cacheReadInputTokens),
    cacheCreationInputTokens: sum((u) => u.cacheCreationInputTokens),
    retried: calls.filter((c) => (c.attempts ?? 1) > 1).length,
  };
}

/** Per function and per report, over every prediction given (pass all repeats' predictions). */
export function summarizeCalls(predictions: readonly PredictionRecord[]): CallSummary {
  const reports = predictions.map((p) => p.latencyMs);
  return {
    flagPii: summarizeCallsOf(callsOf(predictions, "flagPii")),
    structure: summarizeCallsOf(callsOf(predictions, "structure")),
    report: { n: reports.length, p50Ms: percentile(reports, 0.5), p95Ms: percentile(reports, 0.95) },
  };
}

/** Mean tokens per test report, over the reports whose every AI call reported usage. */
export function tokensPerReport(predictions: readonly PredictionRecord[]): { reports: number; of: number; input: number; output: number } | null {
  let reports = 0, input = 0, output = 0;
  for (const p of predictions) {
    const calls = CALL_FUNCTIONS.flatMap((fn) => (p.calls[fn] ? [p.calls[fn]!] : []));
    if (!calls.length || calls.some((c) => !c.usage)) continue;
    reports++;
    for (const c of calls) {
      input += c.usage!.inputTokens;
      output += c.usage!.outputTokens;
    }
  }
  return reports ? { reports, of: predictions.length, input: input / reports, output: output / reports } : null;
}

// ---- Prices and cost ----

export const PRICES_ENV = "AI_PRICES_USD_PER_MTOK";
export const PRICES_DATE_ENV = "AI_PRICES_SET_ON";

/** US dollars per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface PriceTable {
  /** The date a human copied the prices (YYYY-MM-DD). */
  setOn: string;
  models: Record<string, ModelPrice>;
}

export type PriceConfig =
  | { ok: true; table: PriceTable }
  | { ok: false; reason: "unset" }
  | { ok: false; reason: "invalid"; problem: string };

const PRICE = /^\d+(\.\d+)?$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,99}$/;

/** The price constants from the environment (see the top of this file). Never throws. */
export function pricesFromEnv(env: Readonly<Record<string, string | undefined>>): PriceConfig {
  const raw = env[PRICES_ENV]?.trim() ?? "";
  const setOn = env[PRICES_DATE_ENV]?.trim() ?? "";
  if (!raw && !setOn) return { ok: false, reason: "unset" };
  if (!raw) return { ok: false, reason: "invalid", problem: `${PRICES_DATE_ENV} is set but ${PRICES_ENV} is empty.` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(setOn) || Number.isNaN(Date.parse(`${setOn}T00:00:00Z`))) {
    return { ok: false, reason: "invalid", problem: `${PRICES_DATE_ENV} must be the date the prices were copied, as YYYY-MM-DD.` };
  }
  const models: Record<string, ModelPrice> = {};
  for (const entry of raw.split(",").map((e) => e.trim()).filter(Boolean)) {
    const eq = entry.lastIndexOf("=");
    const model = eq > 0 ? entry.slice(0, eq).trim() : "";
    const parts = eq > 0 ? entry.slice(eq + 1).split("/").map((p) => p.trim()) : [];
    if (!MODEL_ID.test(model) || parts.length < 2 || parts.length > 4 || !parts.every((p) => PRICE.test(p))) {
      return {
        ok: false,
        reason: "invalid",
        problem: `${PRICES_ENV} entries are <model id>=<input>/<output>[/<cache read>[/<cache write>]] (US dollars per million tokens), separated by commas.`,
      };
    }
    const [input, output, cacheRead, cacheWrite] = parts.map(Number);
    models[model] = { input, output, ...(cacheRead !== undefined ? { cacheRead } : {}), ...(cacheWrite !== undefined ? { cacheWrite } : {}) };
  }
  if (!Object.keys(models).length) return { ok: false, reason: "invalid", problem: `${PRICES_ENV} has no entries.` };
  return { ok: true, table: { setOn, models } };
}

/** The price of a model ID: an exact entry, else the entry it is a dated ID of (`<entry>-YYYYMMDD`). */
export function priceFor(table: PriceTable, model: string): ModelPrice | null {
  if (Object.hasOwn(table.models, model)) return table.models[model];
  const dated = /^(.*)-\d{8}$/.exec(model);
  return dated && Object.hasOwn(table.models, dated[1]) ? table.models[dated[1]] : null;
}

/** One call's cost in US dollars; null when it used the prompt cache and the price has no cache rate. */
export function callCostUsd(usage: CallUsage, price: ModelPrice): number | null {
  const cacheRead = usage.cacheReadInputTokens ?? 0;
  const cacheWrite = usage.cacheCreationInputTokens ?? 0;
  if ((cacheRead > 0 && price.cacheRead === undefined) || (cacheWrite > 0 && price.cacheWrite === undefined)) return null;
  const cost =
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    cacheRead * (price.cacheRead ?? 0) +
    cacheWrite * (price.cacheWrite ?? 0);
  return cost / 1_000_000;
}

export type ReportCost =
  | { ok: true; usdPerReport: number; reports: number; of: number; setOn: string }
  | { ok: false; reason: "no-usage" }
  | { ok: false; reason: "no-price"; model: string }
  | { ok: false; reason: "no-cache-price"; model: string };

/** Mean cost per test report, over the reports whose every AI call reported usage. */
export function costPerReport(predictions: readonly PredictionRecord[], table: PriceTable): ReportCost {
  let reports = 0, total = 0;
  for (const p of predictions) {
    const calls = CALL_FUNCTIONS.flatMap((fn) => (p.calls[fn] ? [p.calls[fn]!] : []));
    if (!calls.length || calls.some((c) => !c.usage)) continue;
    let cost = 0;
    for (const c of calls) {
      const price = priceFor(table, c.model);
      if (!price) return { ok: false, reason: "no-price", model: c.model };
      const one = callCostUsd(c.usage!, price);
      if (one === null) return { ok: false, reason: "no-cache-price", model: c.model };
      cost += one;
    }
    reports++;
    total += cost;
  }
  if (!reports) return { ok: false, reason: "no-usage" };
  return { ok: true, usdPerReport: total / reports, reports, of: predictions.length, setOn: table.setOn };
}

/** 0.0012345 -> "US$0.0012"; 1.5 -> "US$1.50". */
export function usd(amount: number): string {
  return `US$${amount < 1 ? amount.toFixed(4) : amount.toFixed(2)}`;
}
