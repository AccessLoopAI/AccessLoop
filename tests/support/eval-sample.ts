// Test-only: SAMPLE measured eval results, made from a saved fake run, for the views of /app/eval that need a real
// model's run (tests/eval-page.test.ts, and e2e/eval.spec.ts's axe check of that view). They are written to a temp
// folder and read back through listEvalResults, NEVER into eval/results: a sample is not a measurement.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EvalResultSchema, listEvalResults, type EvalResult, type EvalResultsListing, type EvalSet, type SavedEvalResult } from "@/lib/eval/results";
import { percentile, pricesFromEnv, summarizeCalls } from "@/lib/eval/usage";

export const SAMPLE_MODELS = { structure: "claude-sonnet-5-5", flagPii: "claude-haiku-5-5" };

/** Made-up price constants for the samples (US$ per million tokens), in the format of .env.example. */
export const SAMPLE_PRICES = pricesFromEnv({
  AI_PRICES_SET_ON: "2026-10-20",
  AI_PRICES_USD_PER_MTOK: "claude-sonnet-5-5=2/10, claude-haiku-5-5=0.1/0.5",
});

/** A run's predictions as if a model had answered: per-call models, latencies and token usage. */
export function withUsage(predictions: EvalResult["predictions"], shift: number, models = SAMPLE_MODELS): EvalResult["predictions"] {
  return predictions.map((p, i) => ({
    ...p,
    latencyMs: 1500 + 10 * i + shift,
    calls: {
      flagPii: {
        model: models.flagPii,
        promptSha: p.calls.flagPii?.promptSha ?? "sample",
        latencyMs: 600 + i + shift,
        usage: { inputTokens: 400, outputTokens: 30 },
        attempts: 1,
      },
      structure: {
        model: models.structure,
        promptSha: p.calls.structure?.promptSha ?? "sample",
        latencyMs: 900 + i + shift,
        usage: { inputTokens: 1000, outputTokens: 120 },
      },
    },
  }));
}

/** A pass's metrics with the per-report latency of its (sample) predictions, by score.ts's percentile rule. */
function withLatency(metrics: EvalResult["metrics"], predictions: EvalResult["predictions"]): EvalResult["metrics"] {
  const ms = predictions.filter((p) => !p.error).map((p) => p.latencyMs);
  return { ...metrics, latencyMs: { p50: percentile(ms, 0.5) ?? 0, p95: percentile(ms, 0.95) ?? 0 } };
}

/**
 * A sample measured run with 3 repeats, from a saved fake run of the full pipeline. The second repeat gets one more
 * report right (top-1 and acceptable), so the range across repeats is not flat.
 */
export function measuredSample(fake: EvalResult, backend: "api" | "claude-cli" = "api"): EvalResult {
  const models = backend === "api" ? SAMPLE_MODELS : { structure: "sonnet", flagPii: "sonnet" };
  const passes = [withUsage(fake.predictions, 0, models), withUsage(fake.predictions, 50, models), withUsage(fake.predictions, 100, models)];
  const c = fake.metrics.classification;
  const oneMore = (fraction: number) => (c.n ? Math.min(c.n, Math.round(fraction * c.n) + 1) / c.n : fraction);
  const second = {
    ...fake.metrics,
    classification: { ...c, top1Accuracy: oneMore(c.top1Accuracy), acceptableAccuracy: oneMore(c.acceptableAccuracy), macroF1: Math.min(1, c.macroF1 + 0.02) },
  };
  return EvalResultSchema.parse({
    ...fake,
    backend,
    simulated: false,
    models,
    cliVersion: backend === "claude-cli" ? "2.1.299" : null,
    label: `${backend}; visible set; 3 repeats`,
    timestamp: "2026-10-20T09:00:00.000Z",
    metrics: withLatency(fake.metrics, passes[0]),
    predictions: passes[0],
    repeats: 3,
    laterRepeats: [
      { metrics: withLatency(second, passes[1]), predictions: passes[1] },
      { metrics: withLatency(fake.metrics, passes[2]), predictions: passes[2] },
    ],
    layer1Only: undefined,
    callSummary: summarizeCalls(passes.flat()),
  });
}

/**
 * The same saved run as a run of another set. The injection and silver sets arrive from other branches, so this
 * branch's schema does not list them yet; the page reads `set` as any string.
 */
export function asSet(s: SavedEvalResult, set: string): SavedEvalResult {
  return { file: s.file.replace(/-(fake|api|claude-cli)-/, `-$1-${set}-`), result: { ...s.result, set: set as EvalSet } };
}

/** Writes results into a NEW temp folder and reads them back as /app/eval would. */
export async function writeSampleFolder(files: Record<string, EvalResult>): Promise<{ dir: string; listing: EvalResultsListing }> {
  const dir = path.join(await mkdtemp(path.join(os.tmpdir(), "al-eval-sample-")), "results");
  await mkdir(dir, { recursive: true });
  for (const [name, result] of Object.entries(files)) await writeFile(path.join(dir, name), JSON.stringify(result));
  return { dir, listing: await listEvalResults(dir) };
}
