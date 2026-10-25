// Saved AI eval results (eval/results/*.json; eval/README.md): the ONE format eval/run.ts writes and the lead's
// /app/eval page reads. Server-only (node:fs). No report text is ever needed to read a result: the page shows
// numbers, fixture IDs and detail types.
//
// - File name: `<date>-<backend>[-<set>][-layer1][-baseline]-<promptSha8>[-N].json` (no set part for the visible set;
//   `-holdout`, `-silver`, `-injection`). The backend is always in the name and in the content; a holdout run, a silver
//   run, an injection-suite run, a layer-1-only run and a zero-shot baseline say so in the name too; `-N` (2, 3, ...)
//   only when the same name already exists, so a saved run is never overwritten.
// - `injectionChecks` (injection-suite runs only): eval/injection.ts's stricter per-case checks, IDs and check names only.
// - `simulated` is true exactly when the backend is fake (the schema refuses any other combination), so a hand-edited
//   file can never present the fake backend's canned answers as a model's numbers.
// - `textOmitted` (holdout runs): no summaries, no masked report text, no PII values and no labels are saved, only
//   scores, IDs, types, latencies and text-free error names. The holdout set must stay unseen by agents
//   (eval/holdout/README.md), and these files sit inside the project folder.
// - Repeats (`--repeats N`, since 2026-10-20): `metrics` and `predictions` are the FIRST pass over the set (so every
//   reader of a one-pass result reads repeat 1 the same way), `laterRepeats` the other N - 1 passes, each scored on
//   its own. `layer1Only` (`--layer1-only`): the AI personal-details pass was off; no prediction has a flagPii call.
//   `callSummary`: p50/p95 latency and token totals per AI function and per report, over every repeat. All three are
//   optional, so results saved before them still read.
// - `layer1Sha` (since the T1c gate, 2026-10-20): sha256 of the layer-1 redaction code the run used (LAYER1_FILES), so
//   "Layer 1 alone, and with the AI pass" only pairs runs of the same patterns. Optional: older results have none.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { AI_BACKENDS } from "@/lib/ai/backend";

export const RESULT_FORMAT = "accessloop-eval-result/v1";
/**
 * Silver = statements from published reports, labelled by their authors. Injection = the prompt-injection suite,
 * eval/fixtures/injection.json. Each set in words: lib/eval/present.ts setName() (the one name map).
 */
export const EVAL_SETS = ["visible", "holdout", "silver", "injection"] as const;
export type EvalSet = (typeof EVAL_SETS)[number];

/** `--repeats N` runs the set at most this many times (each repeat is a full pass: real calls, real cost). */
export const MAX_REPEATS = 10;

/** The layer-1 redaction code (project-relative): what `layer1Sha` fingerprints. */
export const LAYER1_FILES = ["lib/redaction/patterns.ts", "lib/intake/redact.ts"] as const;

/** `layer1Sha`: sha256 over each layer-1 file's own sha256, in LAYER1_FILES order (bytes as read). */
export function layer1ShaOf(files: readonly { file: string; bytes: Buffer | string }[]): string {
  const h = createHash("sha256");
  for (const { file, bytes } of files) h.update(`${file} ${createHash("sha256").update(bytes).digest("hex")}\n`);
  return h.digest("hex");
}

/** Where results live: eval/results under the project folder (npm scripts and `next start` run from there). */
export function evalResultsDir(): string {
  return path.join(process.cwd(), "eval", "results");
}

const Fraction = z.number().min(0).max(1);
const Count = z.number().int().min(0);

/** The output of eval/score.ts score(), as saved (holdout runs drop `leaks[].text`). */
export const EvalMetricsSchema = z.object({
  n: Count,
  errors: Count,
  classification: z.object({
    n: Count,
    top1Accuracy: Fraction,
    acceptableAccuracy: Fraction,
    macroF1: Fraction,
    /** expected primary area -> predicted area (or "abstain") -> count */
    confusion: z.record(z.string(), z.record(z.string(), Count)),
  }),
  abstention: z.object({ n: Count, correct: Count }),
  pii: z.object({
    total: Count,
    leakedBeforeHuman: Count,
    recallBeforeHuman: Fraction,
    recall95ci: z.tuple([Fraction, Fraction]),
    byType: z.record(z.string(), z.object({ total: Count, leaked: Count })),
    leaks: z.array(z.object({ id: z.string(), type: z.string(), text: z.string().optional() })),
    overRedacted: z.object({ checked: Count, wronglyRemoved: Count }),
  }),
  injection: z.object({ n: Count, resisted: Count }),
  latencyMs: z.object({ p50: z.number().min(0), p95: z.number().min(0) }),
});
export type EvalMetrics = z.infer<typeof EvalMetricsSchema>;

/** The injection suite's checks per case (eval/injection.ts), in the order a failure lists them. */
export const INJECTION_CHECKS = ["ran", "area", "no_status_claim", "no_canary", "pii_hidden", "delimiters"] as const;
export type InjectionCheck = (typeof INJECTION_CHECKS)[number];

/**
 * An injection-suite run's own checks (eval/injection.ts checkInjectionSuite), next to score()'s metrics: resisted =
 * every check passed. Fixture IDs, attack kinds, check names and counts only, never text.
 */
export const InjectionChecksSchema = z.object({
  n: Count,
  resisted: Count,
  byKind: z.record(z.string(), z.object({ n: Count, resisted: Count })),
  byCheck: z.record(z.enum(INJECTION_CHECKS), z.object({ failed: Count })),
  failures: z.array(z.object({ id: z.string().min(1), kind: z.string().min(1), failed: z.array(z.enum(INJECTION_CHECKS)).min(1) })),
});
export type InjectionChecks = z.infer<typeof InjectionChecksSchema>;

/** Token counts of one call, as the backend reported them (lib/ai AiUsage). Numbers only, never text. */
const UsageSchema = z.object({
  inputTokens: Count,
  outputTokens: Count,
  cacheReadInputTokens: Count.optional(),
  cacheCreationInputTokens: Count.optional(),
  thinkingTokens: Count.optional(),
});
export type CallUsage = z.infer<typeof UsageSchema>;

/**
 * One AI call of a fixture: model, prompt sha and latency; plus, when the backend reported them, its token usage
 * (api and claude-cli; the fake backend reports none) and how many requests it took (api: 2 = the retry after 429/529).
 * Results saved before 2026-10-20 have neither.
 */
const CallSchema = z.object({
  model: z.string(),
  promptSha: z.string(),
  latencyMs: z.number().min(0),
  usage: UsageSchema.optional(),
  attempts: z.number().int().min(1).optional(),
});
export type CallRecord = z.infer<typeof CallSchema>;

/** One fixture's run. Holdout runs keep only `id`, `latencyMs`, `error` and `calls`. */
export const PredictionRecordSchema = z.object({
  id: z.string().min(1),
  expected: z
    .object({ primaryArea: z.string().nullable(), abstain: z.boolean(), injection: z.boolean() })
    .optional(),
  priorityAreas: z.array(z.object({ area: z.string(), confidence: z.number().min(0).max(1) })).optional(),
  uncertain: z.array(z.string()).optional(),
  summary: z.string().optional(),
  redactedBeforeHuman: z.string().optional(),
  latencyMs: z.number().min(0),
  /** "structure: AiTimeoutError: The api AI backend did not answer within 10 s." (text-free by construction) */
  error: z.string().optional(),
  calls: z.object({ flagPii: CallSchema.optional(), structure: CallSchema.optional() }),
});
export type PredictionRecord = z.infer<typeof PredictionRecordSchema>;

const PromptRecordSchema = z.object({ file: z.string(), version: z.string(), sha: z.string().regex(/^[0-9a-f]{64}$/) });
export type PromptRecord = z.infer<typeof PromptRecordSchema>;

const Ms = z.number().min(0).nullable();
const CallSummaryRowSchema = z.object({
  calls: Count,
  p50Ms: Ms,
  p95Ms: Ms,
  withUsage: Count,
  inputTokens: Count,
  outputTokens: Count,
  cacheReadInputTokens: Count,
  cacheCreationInputTokens: Count,
  retried: Count,
});
/** lib/eval/usage.ts summarizeCalls(): per AI function and per report, over every repeat. Numbers only. */
export const CallSummarySchema = z.object({
  flagPii: CallSummaryRowSchema,
  structure: CallSummaryRowSchema,
  report: z.object({ n: Count, p50Ms: Ms, p95Ms: Ms }),
});

/** One more pass over the set (`--repeats`): scored on its own, saved like the first one. */
const RepeatSchema = z.object({ metrics: EvalMetricsSchema, predictions: z.array(PredictionRecordSchema) });
export type EvalRepeat = z.infer<typeof RepeatSchema>;

export const EvalResultSchema = z
  .object({
    format: z.literal(RESULT_FORMAT),
    /** true = the fake backend: canned answers that test the harness, not a model. */
    simulated: z.boolean(),
    backend: z.enum(AI_BACKENDS),
    set: z.enum(EVAL_SETS),
    /** true = zero-shot baseline: the same backend and model WITHOUT AccessLoop's prompts (eval/baseline/). */
    baseline: z.boolean(),
    label: z.string().min(1),
    timestamp: z.iso.datetime(),
    fixtureCount: Count,
    /** sha256 of the fixtures file's bytes (which version of the set was run). */
    fixturesSha: z.string().regex(/^[0-9a-f]{64}$/),
    prompts: z.object({ structure: PromptRecordSchema, flagPii: PromptRecordSchema }),
    promptSha8: z.string().regex(/^[0-9a-f]{8}$/),
    /** The model per function (api: model IDs; claude-cli: the alias; fake: "fake"). */
    models: z.object({ structure: z.string(), flagPii: z.string() }),
    cliVersion: z.string().nullable(),
    abstainThreshold: z.number(),
    textOmitted: z.boolean(),
    metrics: EvalMetricsSchema,
    /** Only on an injection-suite run (`--set injection`): the suite's strict per-case checks. */
    injectionChecks: InjectionChecksSchema.optional(),
    predictions: z.array(PredictionRecordSchema),
    /** How many passes over the set (`--repeats`; absent = 1). `metrics`/`predictions` are the first. */
    repeats: z.number().int().min(1).max(MAX_REPEATS).optional(),
    /** Passes 2..N, each with its own score. */
    laterRepeats: z.array(RepeatSchema).optional(),
    /** true = `--layer1-only`: the layer-1 patterns alone, no AI personal-details pass (structure ran as usual). */
    layer1Only: z.boolean().optional(),
    callSummary: CallSummarySchema.optional(),
    /** sha256 of the layer-1 redaction code at run time (layer1ShaOf over LAYER1_FILES); absent on older results. */
    layer1Sha: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  })
  .refine((r) => r.simulated === (r.backend === "fake"), { message: "simulated must be true exactly for the fake backend" })
  .refine((r) => r.fixtureCount === r.metrics.n && r.predictions.length === r.fixtureCount, {
    message: "fixtureCount, metrics.n and the predictions must agree",
  })
  .refine((r) => (r.repeats ?? 1) === 1 + (r.laterRepeats?.length ?? 0), { message: "repeats must count the first pass and every later one" })
  .refine((r) => (r.laterRepeats ?? []).every((x) => x.metrics.n === r.fixtureCount && x.predictions.length === r.fixtureCount), {
    message: "every repeat must cover the whole set",
  })
  .refine((r) => !r.layer1Only || [r, ...(r.laterRepeats ?? [])].every((x) => x.predictions.every((p) => !p.calls.flagPii)), {
    message: "a layer-1-only run has no flagPii calls",
  })
  .refine((r) => (r.set === "injection") === (r.injectionChecks !== undefined) && (!r.injectionChecks || r.injectionChecks.n === r.fixtureCount), {
    message: "injectionChecks belong to an injection-suite run, one per fixture",
  });
export type EvalResult = z.infer<typeof EvalResultSchema>;

/** The 8-character prompt-set id in the file name: sha256 over both prompt files' sha256. */
export function promptSetSha8(shas: { structure: string; flagPii: string }): string {
  return createHash("sha256").update(`structure ${shas.structure}\nflagPii ${shas.flagPii}\n`).digest("hex").slice(0, 8);
}

/**
 * `2026-10-19-fake-1a2b3c4d.json`, `2026-10-19-api-holdout-baseline-1a2b3c4d.json`, `...-api-silver-...`,
 * `...-fake-injection-...`, `...-fake-layer1-...`; `n` > 1 adds `-n`.
 */
export function resultFileName(
  r: { date: string; backend: EvalResult["backend"]; set: EvalSet; baseline: boolean; promptSha8: string; layer1Only?: boolean },
  n = 1,
): string {
  const parts: string[] = [r.date, r.backend];
  if (r.set !== "visible") parts.push(r.set);
  if (r.layer1Only) parts.push("layer1"); // `-layer1`: a --layer1-only run (since 2026-10-20)
  if (r.baseline) parts.push("baseline");
  parts.push(r.promptSha8);
  return `${parts.join("-")}${n > 1 ? `-${n}` : ""}.json`;
}

export interface SavedEvalResult {
  /** The file's name in eval/results. */
  file: string;
  result: EvalResult;
}

export interface EvalResultsListing {
  /** Every readable result, newest first (by timestamp, then file name). */
  results: SavedEvalResult[];
  /** *.json files that are not results in this format (named, never shown). */
  unreadable: string[];
}

/**
 * Every saved result in `dir` (default eval/results). A missing folder is an empty listing. The turbopackIgnore
 * comments keep `next build` from tracing the whole project into the server output for these two calls (its
 * "Dynamic filesystem access" warning): next.config.ts already traces exactly eval/results/*.json into /app/eval.
 */
export async function listEvalResults(dir: string = evalResultsDir()): Promise<EvalResultsListing> {
  let names: string[];
  try {
    names = (await readdir(/*turbopackIgnore: true*/ dir)).filter((n) => n.toLowerCase().endsWith(".json"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return { results: [], unreadable: [] };
    throw err;
  }
  const results: SavedEvalResult[] = [];
  const unreadable: string[] = [];
  for (const file of names.sort()) {
    try {
      const parsed = EvalResultSchema.safeParse(JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, file), "utf8")));
      if (parsed.success) results.push({ file, result: parsed.data });
      else unreadable.push(file);
    } catch {
      unreadable.push(file);
    }
  }
  results.sort((a, b) => Date.parse(b.result.timestamp) - Date.parse(a.result.timestamp) || b.file.localeCompare(a.file));
  return { results, unreadable };
}

/** Every pass of a run, in order: the first one (`metrics`, `predictions`) and then `laterRepeats`. */
export function allRepeats(r: EvalResult): EvalRepeat[] {
  return [{ metrics: r.metrics, predictions: r.predictions }, ...(r.laterRepeats ?? [])];
}

/**
 * The sets whose runs /app/eval shows as its main view: the visible set and the holdout. Runs of any other set (the
 * injection suite, the silver set from published reports) get their own small tables below it. A string list, so the
 * page reads sets added on other branches without a type change.
 */
export const PRIMARY_SETS: readonly string[] = ["visible", "holdout"];
export const isPrimarySet = (set: string): boolean => PRIMARY_SETS.includes(set);

/** A run of the whole pipeline with AccessLoop's prompts (not a baseline, not layer 1 only). */
const ownFullRun = (s: SavedEvalResult) => !s.result.baseline && !s.result.layer1Only;
/** Measured = a real model answered (claude-cli or api); the fake backend's runs are simulated. */
export const isMeasured = (s: SavedEvalResult): boolean => !s.result.simulated;

/**
 * The latest measured run among `runs` (newest first), an Anthropic API run before a claude-cli one: domain §6.1 hard
 * limit 3 says claude-cli numbers are never published ("Re-run the eval with api before quoting anything"), so a newer
 * claude-cli run never replaces an api run as the numbers the page leads with. claude-cli leads only while no api run
 * is saved. Null when none was measured.
 */
export function latestMeasuredOf(runs: readonly SavedEvalResult[]): SavedEvalResult | null {
  return runs.find((s) => s.result.backend === "api") ?? runs.find(isMeasured) ?? null;
}

/** The latest measured run of the visible or holdout set with AccessLoop's prompts (latestMeasuredOf), or null. */
export function latestMeasuredRun(listing: EvalResultsListing): SavedEvalResult | null {
  return latestMeasuredOf(listing.results.filter((s) => ownFullRun(s) && isPrimarySet(s.result.set)));
}

/**
 * The latest zero-shot baseline that can sit next to `main`: the same backend AND models ("the same model without
 * our prompt", eval/README.md), the same set, the same fixtures file and the same layer-1-only mode. None for a
 * baseline itself.
 */
export function baselineFor(listing: EvalResultsListing, main: SavedEvalResult): SavedEvalResult | null {
  const m = main.result;
  if (m.baseline) return null;
  return (
    listing.results.find(
      (r) =>
        r.result.baseline &&
        r.result.backend === m.backend &&
        r.result.models.structure === m.models.structure &&
        r.result.models.flagPii === m.models.flagPii &&
        r.result.set === m.set &&
        r.result.fixturesSha === m.fixturesSha &&
        Boolean(r.result.layer1Only) === Boolean(m.layer1Only),
    ) ?? null
  );
}

/**
 * What /app/eval shows by default: the latest MEASURED run of the visible or holdout set with AccessLoop's prompts when
 * one is saved (an api run before a claude-cli one: latestMeasuredOf), else the latest simulated one (else any run of
 * those sets, else any run at all), plus the latest zero-shot baseline that can sit next to it (baselineFor).
 * Simulated runs never sit above a measured one. An injection-suite (or silver) run is the default only when nothing
 * of the visible or holdout set is saved: its classification numbers are about attacks, not the product's reports
 * (it has its own card and stays one click away in the "Saved runs" table).
 */
export function pickLatest(listing: EvalResultsListing): { main: SavedEvalResult | null; baseline: SavedEvalResult | null } {
  const rs = listing.results;
  const own = rs.filter((s) => ownFullRun(s) && isPrimarySet(s.result.set));
  const main =
    latestMeasuredOf(own) ?? own[0] ?? rs.find((s) => !s.result.baseline && isPrimarySet(s.result.set)) ?? rs.find((s) => isPrimarySet(s.result.set)) ?? rs[0] ?? null;
  return { main, baseline: main ? baselineFor(listing, main) : null };
}

/**
 * What /app/eval?run=<file> shows: that saved run (by its file name in the listing, never a path from the request)
 * with its baseline; `notFound` when no saved run has that name, and then the latest (pickLatest).
 */
export function pickRun(
  listing: EvalResultsListing,
  file: string | null,
): { main: SavedEvalResult | null; baseline: SavedEvalResult | null; notFound: boolean } {
  const chosen = file === null ? null : (listing.results.find((r) => r.file === file) ?? null);
  if (!chosen) return { ...pickLatest(listing), notFound: file !== null };
  return { main: chosen, baseline: baselineFor(listing, chosen), notFound: false };
}

/**
 * The latest holdout run with AccessLoop's prompts (a measured one first): where the headline numbers come from
 * (eval/README.md).
 */
export function latestHoldout(listing: EvalResultsListing): SavedEvalResult | null {
  const holdout = listing.results.filter((r) => r.result.set === "holdout" && ownFullRun(r));
  return latestMeasuredOf(holdout) ?? holdout[0] ?? null;
}

/**
 * The latest `--layer1-only` run to compare `main`'s personal-details numbers with: the same set, fixtures file and
 * layer-1 code (`layer1Sha`; two older results without one still pair). Layer 1 is the deterministic patterns, so its
 * numbers do not depend on the AI backend, but they do change with the patterns: a layer-1 run made before a pattern
 * was added would understate layer 1 next to a newer full run. None when `main` is one.
 */
export function layer1For(listing: EvalResultsListing, main: SavedEvalResult): SavedEvalResult | null {
  const m = main.result;
  if (m.layer1Only) return null;
  return (
    listing.results.find(
      (r) => r.result.layer1Only && r.result.set === m.set && r.result.fixturesSha === m.fixturesSha && (r.result.layer1Sha ?? null) === (m.layer1Sha ?? null),
    ) ?? null
  );
}

/** Each set other than visible and holdout that has saved runs: its latest measured and latest simulated run. */
export function otherSetRuns(listing: EvalResultsListing): { set: string; measured: SavedEvalResult | null; simulated: SavedEvalResult | null }[] {
  const sets = [...new Set(listing.results.map((r) => r.result.set as string).filter((set) => !isPrimarySet(set)))].sort();
  return sets.map((set) => {
    const runs = listing.results.filter((r) => r.result.set === set && ownFullRun(r));
    return { set, measured: latestMeasuredOf(runs), simulated: runs.find((r) => !isMeasured(r)) ?? null };
  });
}

/**
 * The "Saved runs" table's order: measured runs first (Anthropic API runs, then claude-cli runs), then simulated ones;
 * newest first within each.
 */
export function savedRunsOrder(listing: EvalResultsListing): SavedEvalResult[] {
  const rs = listing.results;
  const api = (r: SavedEvalResult) => r.result.backend === "api";
  return [...rs.filter(api), ...rs.filter((r) => isMeasured(r) && !api(r)), ...rs.filter((r) => !isMeasured(r))];
}
