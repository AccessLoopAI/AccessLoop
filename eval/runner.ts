// The AI eval runner (eval/README.md; docs/handoff.md Phase 3 item 3). `npm run eval` runs eval/run.ts, which only
// calls cli() below; everything here is plain functions so tests/eval-runner.test.ts can check the plumbing with the
// fake backend (never a real model in tests).
//
// Per fixture, exactly the intake pipeline (lib/intake/pipeline.ts buildPreview, lib/intake/redact.ts), inside the same
// time budget as a real preview (intakeAiBudgetMs: 10 s end to end on api, 60 s on claude-cli):
//   1. layer 1: redactLayer1(text)                        deterministic patterns (lib/redaction/patterns.ts)
//   2. layer 2: flagPii(the layer-1 masked text)          exact substrings, mapped back onto the raw text
//   3. redactWithItems(text, items)                       layers 1 + 2 = Prediction.redactedBeforeHuman
//   4. structure(that redacted text, locationKind)        Prediction.priorityAreas / uncertain / summary
// then score() from eval/score.ts (frozen). A failed AI call is recorded on its fixture as a text-free error (score()
// counts an errored fixture conservatively: all its PII leaked, no classification) and the pipeline goes on with
// intake's own fallback (layer 1 only when flagPii failed), like the app would.
//
// Backends: effectiveBackend() as everywhere (FAKE_LLM=1 ? fake : AI_BACKEND); `--backend X` sets both for this run.
// claude-cli gets aiLocalScriptContext (domain §6.1 hard limit 2). Before any fixture is read, checkAiBackend() asks
// whether the backend is usable here (api: a key; claude-cli: the guard, version and subscription login). If it is
// not, or a call later says so (AiBackendUnavailableError, AiNotAllowedError, AiConfigError), the runner prints
// exactly what is wrong and exits non-zero WITHOUT saving anything. Never another backend instead.
//
// Output: the metrics JSON on stdout (with backend, set and the simulated flag next to it, so the numbers never
// travel without them) and one new file in eval/results (lib/eval/results.ts has the format and the name). Each call
// in it keeps its latency and, when the backend reported them, its token usage and attempts (numbers only). Progress
// lines go to stderr and name fixture IDs only, never report text.
//
// Holdout (`--set holdout`): reads HOLDOUT_PATH, which must be outside the project folder, and only when a human runs
// it (agents never do: eval/holdout/README.md). Its result keeps scores, IDs, types and latencies only
// (`textOmitted`): no report text, summaries, PII values or labels are saved or printed.
//
// Repeats (`--repeats N`, 1-10, default 1): the whole set runs N times, one pass after another, each pass scored on its
// own (score() keys predictions by fixture ID). The result keeps pass 1 as `metrics`/`predictions` and the others as
// `laterRepeats`; the printed `rates` are the mean over the passes with a 95% Wilson interval and the range across them
// (lib/eval/intervals.ts). Real backends answer differently from run to run (claude-cli has no temperature; the api
// models take none), so 3 repeats show how much the numbers move.
// Layer 1 only (`--layer1-only`): flagPii is never called, so what reaches a human is the layer-1 patterns alone
// (redactWithItems(text, null)); structure runs as usual on that text. The result says so (`layer1Only`, `-layer1` in
// the file name), and /app/eval puts its personal-details numbers next to the full pipeline's.
// Both flags work with any --set and with --baseline. Every result also keeps `callSummary` (lib/eval/usage.ts): p50
// and p95 latency and token totals per AI function and per report, over every repeat (numbers only), and `layer1Sha`
// (the layer-1 redaction code it ran with, lib/eval/results.ts LAYER1_FILES), so the page pairs a layer-1-only run
// with a full run only when both used the same patterns.
// Silver (`--set silver`, lib/eval/silver.ts): statements from published progress reports, labelled with the area
// their authors gave them. Only the human-reviewed eval/fixtures/public-silver.json runs; the agent-written
// public-silver.draft.json is refused, unless `--draft-check` says the run only checks the harness: then the metrics
// are printed, marked DRAFT, and NOTHING is saved (a draft never reaches /app/eval).
// Injection (`--set injection`): the prompt-injection suite, eval/fixtures/injection.json (eval/injection.ts has the
// format). Scored by score() like any set, plus the suite's strict per-case checks (checkInjectionSuite), saved as
// `injectionChecks` (IDs, kinds and check names only).
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  AI_BACKENDS,
  aiLocalScriptContext,
  aiWithPrompts,
  checkAiBackend,
  effectiveBackend,
  flagPii,
  intakeAiBudgetMs,
  isAiError,
  loadPrompt,
  loadPromptFile,
  PRIORITY_AREAS,
  structure,
  type AiBackendName,
  type AiBackendStatus,
  type AiContext,
  type AiFunction,
  type AiFunctions,
  type AiMeta,
  type LoadedPrompt,
  type PiiItem,
  type StructureOutput,
} from "@/lib/ai";
import { zonedDate } from "@/lib/dates";
import {
  allRepeats,
  EVAL_SETS,
  EvalResultSchema,
  evalResultsDir,
  LAYER1_FILES,
  layer1ShaOf,
  promptSetSha8,
  RESULT_FORMAT,
  resultFileName,
  type EvalMetrics,
  type EvalResult,
  type CallRecord,
  type EvalSet,
  type PredictionRecord,
  type PromptRecord,
  MAX_REPEATS,
} from "@/lib/eval/results";
import { ratesSummary } from "@/lib/eval/intervals";
import { summarizeCalls } from "@/lib/eval/usage";
import { redactLayer1, redactWithItems } from "@/lib/intake/redact";
import { SILVER_DRAFT_FILE, SILVER_FILE, SilverFileSchema, silverFixtures } from "@/lib/eval/silver";
import { checkInjectionSuite, INJECTION_FILE, InjectionFileSchema, injectionFixtures, type InjectionFixture } from "./injection";
import { LOCATION_KINDS } from "@/lib/intake/types";
import { ABSTAIN_THRESHOLD, score, type Fixture, type Prediction } from "./score";

export const SCRIPT_NAME = "eval/run.ts";

export const USAGE = [
  "Usage: npm run eval [-- [--set visible|holdout|silver|injection] [--draft-check] [--baseline] [--backend fake|claude-cli|api] [--repeats N] [--layer1-only]]",
  "",
  "  --set visible   the 20 labelled fixtures in eval/fixtures/reports.json (default)",
  "  --set holdout   the humans-only set at HOLDOUT_PATH (a human runs this; agents never do)",
  "  --set silver    statements from published reports (eval/fixtures/public-silver.json, once a human reviewed it)",
  "  --set injection the prompt-injection suite in eval/fixtures/injection.json, with its own per-case checks",
  "  --draft-check   with --set silver: run the unreviewed public-silver.draft.json through the harness; saves nothing",
  "  --baseline      zero-shot baseline: the same backend and model WITHOUT AccessLoop's prompts (eval/baseline/)",
  "  --backend X     use backend X for this run (sets AI_BACKEND=X and FAKE_LLM=1 for fake, 0 otherwise)",
  `  --repeats N     run the whole set N times (1-${MAX_REPEATS}, default 1); rates are the mean, with the range across repeats`,
  "  --layer1-only   layer-1 patterns only: the AI personal-details pass (flagPii) is off; structure runs as usual",
  "",
  "Prints the metrics JSON and saves eval/results/<date>-<backend>[-holdout|-silver|-injection][-layer1][-baseline]-<promptSha8>.json.",
  "With the fake backend the result is a harness check, marked simulated.",
].join("\n");

/** Stops the run with a message for the human and an exit code. Nothing is saved. */
export class EvalStop extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "EvalStop";
    this.exitCode = exitCode;
  }
}

/** Exit codes: 0 saved; 1 a usage, fixture or prompt problem; 2 the backend is not usable here. */
export const EXIT_USAGE = 1;
export const EXIT_BACKEND = 2;

export interface EvalOptions {
  set: EvalSet;
  baseline: boolean;
  /** null: the configured backend (FAKE_LLM / AI_BACKEND from .env.local). */
  backend: AiBackendName | null;
  /** `--repeats N`: passes over the set (absent = 1). */
  repeats?: number;
  /** `--layer1-only`: no flagPii call; the layer-1 patterns alone, to compare with the full pipeline. */
  layer1Only?: true;
  /** `--draft-check` (silver only): run the DRAFT silver file, print the metrics marked DRAFT, save nothing. */
  draftCheck?: true;
}

/** The command-line flags. Throws EvalStop for anything it does not know; "help" for -h / --help. */
export function parseEvalArgs(argv: readonly string[]): EvalOptions | "help" {
  const opts: EvalOptions = { set: "visible", baseline: false, backend: null };
  const args = [...argv];
  const valueOf = (flag: string, arg: string): string => {
    const inline = arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : null;
    const v = inline ?? args.shift();
    if (v === undefined || v === "" || v.startsWith("--")) throw new EvalStop(`${flag} needs a value.\n\n${USAGE}`, EXIT_USAGE);
    return v;
  };
  while (args.length) {
    const arg = args.shift()!;
    if (arg === "-h" || arg === "--help") return "help";
    if (arg === "--baseline") {
      opts.baseline = true;
    } else if (arg === "--layer1-only") {
      opts.layer1Only = true;
    } else if (arg === "--repeats" || arg.startsWith("--repeats=")) {
      const v = valueOf("--repeats", arg);
      const n = /^[1-9][0-9]?$/.test(v) ? Number(v) : NaN;
      if (!(n >= 1 && n <= MAX_REPEATS)) {
        throw new EvalStop(`--repeats must be a whole number from 1 to ${MAX_REPEATS}, not "${v.slice(0, 40)}".`, EXIT_USAGE);
      }
      opts.repeats = n;
    } else if (arg === "--draft-check") {
      opts.draftCheck = true;
    } else if (arg === "--set" || arg.startsWith("--set=")) {
      const v = valueOf("--set", arg);
      if (!(EVAL_SETS as readonly string[]).includes(v)) {
        throw new EvalStop(`--set must be "visible", "holdout", "silver" or "injection", not "${v.slice(0, 40)}".`, EXIT_USAGE);
      }
      opts.set = v as EvalSet;
    } else if (arg === "--backend" || arg.startsWith("--backend=")) {
      const v = valueOf("--backend", arg);
      if (!(AI_BACKENDS as readonly string[]).includes(v)) {
        throw new EvalStop(`--backend must be "fake", "claude-cli" or "api", not "${v.slice(0, 40)}".`, EXIT_USAGE);
      }
      opts.backend = v as AiBackendName;
    } else {
      throw new EvalStop(`Unknown option "${arg.slice(0, 40)}".\n\n${USAGE}`, EXIT_USAGE);
    }
  }
  if (opts.draftCheck && opts.set !== "silver") {
    throw new EvalStop("--draft-check only goes with --set silver (it checks the draft silver set).", EXIT_USAGE);
  }
  return opts;
}

/** `--backend X`: this run uses X, whatever .env.local says (in this process only). */
export function applyBackendFlag(env: NodeJS.ProcessEnv, backend: AiBackendName | null): void {
  if (!backend) return;
  env.AI_BACKEND = backend;
  env.FAKE_LLM = backend === "fake" ? "1" : "0";
}

// ---- Fixtures ----

const FixtureSchema = z.object({
  id: z.string().min(1).max(40),
  lang: z.enum(["en", "fr"]),
  inputMode: z.string(),
  locationKind: z.enum(LOCATION_KINDS),
  tags: z.array(z.string()),
  text: z.string().min(1),
  expected: z.object({
    primaryArea: z.enum(PRIORITY_AREAS).nullable(),
    acceptableAreas: z.array(z.enum(PRIORITY_AREAS)),
    abstain: z.boolean().optional(),
    injection: z.boolean().optional(),
    pii: z.array(z.object({ text: z.string().min(1), type: z.string().min(1) })),
    notPii: z.array(z.string()),
  }),
});
const FixturesSchema = z.array(FixtureSchema).min(1);

/** True when `file` is inside `root` (or is it). */
function isInside(root: string, file: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * The fixtures of one set and the sha256 of the file's bytes. Errors name the problem, never a fixture's content
 * (for the holdout not even the zod message: only where in the file it is).
 */
export async function loadFixtures(
  set: EvalSet,
  o: { projectRoot: string; env: Readonly<Record<string, string | undefined>>; draftCheck?: boolean },
): Promise<{ fixtures: Fixture[]; sha: string; source: string }> {
  if (set === "silver") return loadSilver(o.projectRoot, Boolean(o.draftCheck));
  if (set === "injection") return loadInjection(o.projectRoot);
  let file: string;
  let shown: string;
  if (set === "visible") {
    file = path.join(o.projectRoot, "eval", "fixtures", "reports.json");
    shown = "eval/fixtures/reports.json";
  } else {
    const raw = o.env.HOLDOUT_PATH?.trim();
    if (!raw) {
      throw new EvalStop(
        "HOLDOUT_PATH is not set. A human writes the holdout set outside the project folder and sets HOLDOUT_PATH in " +
          ".env.local (eval/holdout/README.md).",
        EXIT_USAGE,
      );
    }
    file = path.resolve(o.projectRoot, raw);
    shown = "the file at HOLDOUT_PATH";
    if (isInside(o.projectRoot, file)) {
      throw new EvalStop(
        "HOLDOUT_PATH points inside the project folder. The holdout set must live outside it, where agents never read " +
          "it (eval/holdout/README.md). Move the file and update HOLDOUT_PATH.",
        EXIT_USAGE,
      );
    }
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch {
    throw new EvalStop(`Could not read ${shown}.`, EXIT_USAGE);
  }
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new EvalStop(`${shown} is not valid JSON.`, EXIT_USAGE); // the parser's message can quote the file
  }
  const parsed = FixturesSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? issue.path.join(".") : "the top level";
    const what = set === "visible" && issue ? `: ${issue.message}` : "";
    throw new EvalStop(`${shown} is not in the fixtures format (eval/score.ts Fixture), at ${where}${what}.`, EXIT_USAGE);
  }
  const ids = parsed.data.map((f) => f.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new EvalStop(`${shown} has two fixtures with the id ${dup}.`, EXIT_USAGE);
  return { fixtures: parsed.data, sha: createHash("sha256").update(bytes).digest("hex"), source: shown };
}

/**
 * The silver set: the reviewed file, or with `draftCheck` the draft. A reviewed file still marked DRAFT, or a draft
 * run without `--draft-check`, stops the run before anything is read by an AI.
 */
async function loadSilver(projectRoot: string, draftCheck: boolean): Promise<{ fixtures: Fixture[]; sha: string; source: string }> {
  const shown = draftCheck ? SILVER_DRAFT_FILE : SILVER_FILE;
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(projectRoot, ...shown.split("/")));
  } catch {
    if (draftCheck) throw new EvalStop(`Could not read ${shown}.`, EXIT_USAGE);
    throw new EvalStop(
      `${SILVER_FILE} does not exist yet. The silver set is still a DRAFT (${SILVER_DRAFT_FILE}): a human checks every ` +
        `statement against its source, sets "status": "reviewed" and "reviewedBy", and renames the file (eval/README.md). ` +
        "To check that the draft runs through the harness, add --draft-check (nothing is saved).",
      EXIT_USAGE,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new EvalStop(`${shown} is not valid JSON.`, EXIT_USAGE);
  }
  const parsed = SilverFileSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? issue.path.join(".") : "the top level";
    throw new EvalStop(`${shown} is not in the silver format (lib/eval/silver.ts), at ${where}: ${issue?.message ?? "invalid"}.`, EXIT_USAGE);
  }
  if (!draftCheck && parsed.data.status !== "reviewed") {
    throw new EvalStop(
      `${SILVER_FILE} is still marked "status": "DRAFT". A human reviews every statement, then sets "status": "reviewed" ` +
        `and "reviewedBy" (eval/README.md). To check the harness only, use --draft-check on ${SILVER_DRAFT_FILE}.`,
      EXIT_USAGE,
    );
  }
  return { fixtures: silverFixtures(parsed.data), sha: createHash("sha256").update(bytes).digest("hex"), source: shown };
}

/** The injection suite (eval/injection.ts InjectionFileSchema). Errors say where in the file, like the visible set's. */
async function loadInjection(projectRoot: string): Promise<{ fixtures: InjectionFixture[]; sha: string; source: string }> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(projectRoot, ...INJECTION_FILE.split("/")));
  } catch {
    throw new EvalStop(`Could not read ${INJECTION_FILE}.`, EXIT_USAGE);
  }
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new EvalStop(`${INJECTION_FILE} is not valid JSON.`, EXIT_USAGE);
  }
  const parsed = InjectionFileSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? issue.path.join(".") : "the top level";
    throw new EvalStop(`${INJECTION_FILE} is not in the injection format (eval/injection.ts), at ${where}: ${issue?.message ?? "invalid"}.`, EXIT_USAGE);
  }
  return { fixtures: injectionFixtures(parsed.data), sha: createHash("sha256").update(bytes).digest("hex"), source: INJECTION_FILE };
}

// ---- Prompts ----

type EvalFn = Extract<AiFunction, "structure" | "flagPii">;
const BASELINE_FILES: Record<EvalFn, string> = { structure: "structure.md", flagPii: "flag-pii.md" };

/** The system prompts of this run: lib/ai/prompts (ours), or eval/baseline (the zero-shot baseline). */
export function evalPrompts(baseline: boolean, projectRoot: string): Record<EvalFn, LoadedPrompt> {
  if (!baseline) return { structure: loadPrompt("structure"), flagPii: loadPrompt("flagPii") };
  const one = (fn: EvalFn) =>
    loadPromptFile(fn, path.join(projectRoot, "eval", "baseline", BASELINE_FILES[fn]), `eval/baseline/${BASELINE_FILES[fn]}`);
  return { structure: one("structure"), flagPii: one("flagPii") };
}

function promptRecord(p: LoadedPrompt, projectRoot: string): PromptRecord {
  return { file: path.relative(projectRoot, p.path).split(path.sep).join("/"), version: p.version, sha: p.sha };
}

/**
 * The fingerprint of the layer-1 redaction code this run uses (lib/eval/results.ts layer1ShaOf over LAYER1_FILES).
 * Read once before the first fixture; null (field left out) when a file can't be read, so the result never claims one.
 */
export async function currentLayer1Sha(projectRoot: string): Promise<string | null> {
  try {
    const files = await Promise.all(LAYER1_FILES.map(async (file) => ({ file, bytes: await readFile(path.join(projectRoot, ...file.split("/"))) })));
    return layer1ShaOf(files);
  } catch {
    return null;
  }
}

/**
 * The two AI functions of the pipeline. Ours are lib/ai's own functions (the exact ones intake calls); the baseline
 * is the same module with the baseline files as system prompts (aiWithPrompts: same backends, user turn, schemas
 * and contract checks).
 */
export function evalAi(baseline: boolean, prompts: Record<EvalFn, LoadedPrompt>): Pick<AiFunctions, "structure" | "flagPii"> {
  if (!baseline) return { structure, flagPii };
  const ai = aiWithPrompts((fn) => (fn === "structure" || fn === "flagPii" ? prompts[fn] : loadPrompt(fn)));
  return { structure: ai.structure, flagPii: ai.flagPii };
}

// ---- One fixture ----

const UNUSABLE = new Set(["AiBackendUnavailableError", "AiNotAllowedError", "AiConfigError"]);

/** The backend can't serve this run at all (no key, CLI missing or logged out, refused, misconfigured). */
function isUnusable(err: unknown): boolean {
  return isAiError(err) && UNUSABLE.has((err as Error).name);
}

function unusableStop(backend: string, err: unknown): EvalStop {
  const message = isAiError(err) ? (err as Error).message : "It could not be checked.";
  return new EvalStop(`The ${backend} AI backend can't be used for the eval here. ${message}\nNothing was saved.`, EXIT_BACKEND);
}

/** "structure: AiTimeoutError: The api AI backend did not answer within 10 s." Text-free: AiError messages only. */
function describeError(fn: EvalFn, err: unknown): string {
  const name = err instanceof Error ? err.name : "UnknownError";
  return `${fn}: ${name}${isAiError(err) ? `: ${(err as Error).message}` : ""}`;
}

/** One call's record: model, prompt sha, latency, and the token usage and attempts when the backend reported them. */
export function callOf(meta: AiMeta): CallRecord {
  const call: CallRecord = { model: meta.model, promptSha: meta.promptSha, latencyMs: meta.latencyMs };
  if (meta.usage) {
    const u = meta.usage;
    call.usage = { inputTokens: u.inputTokens, outputTokens: u.outputTokens };
    if (u.cacheReadInputTokens !== undefined) call.usage.cacheReadInputTokens = u.cacheReadInputTokens;
    if (u.cacheCreationInputTokens !== undefined) call.usage.cacheCreationInputTokens = u.cacheCreationInputTokens;
    if (u.thinkingTokens !== undefined) call.usage.thinkingTokens = u.thinkingTokens;
  }
  if (meta.attempts !== undefined) call.attempts = meta.attempts;
  return call;
}

/** The deadline of one fixture's AI steps: a real preview's budget for this backend (lib/ai intakeAiBudgetMs). */
function fixtureDeadline(backend: string): number {
  const known = backend === "claude-cli" || backend === "api" || backend === "fake" ? backend : "api";
  return Date.now() + intakeAiBudgetMs(known);
}

export interface FixtureRun {
  prediction: Prediction;
  calls: PredictionRecord["calls"];
}

/** `layer1Only`: skip flagPii; the text a human reads first is layer 1 alone (redactWithItems(text, null)). */
export async function runFixture(
  f: Fixture,
  ai: Pick<AiFunctions, "structure" | "flagPii">,
  ctx: AiContext,
  backend: string,
  clock: () => number,
  opts: { layer1Only?: boolean } = {},
): Promise<FixtureRun> {
  const started = clock();
  const errors: string[] = [];
  const calls: PredictionRecord["calls"] = {};
  const deadline = fixtureDeadline(backend);

  let items: PiiItem[] | null = null;
  if (!opts.layer1Only) {
    const masked = redactLayer1(f.text);
    try {
      const r = await ai.flagPii(masked, ctx, { deadline });
      items = r.value.items;
      calls.flagPii = callOf(r.meta);
    } catch (err) {
      if (isUnusable(err)) throw unusableStop(backend, err);
      errors.push(describeError("flagPii", err));
    }
  }
  const redaction = redactWithItems(f.text, items);

  let out: StructureOutput | null = null;
  try {
    const r = await ai.structure(redaction.redactedText, f.locationKind as (typeof LOCATION_KINDS)[number], ctx, { deadline });
    out = r.value;
    calls.structure = callOf(r.meta);
  } catch (err) {
    if (isUnusable(err)) throw unusableStop(backend, err);
    errors.push(describeError("structure", err));
  }

  const prediction: Prediction = {
    id: f.id,
    priorityAreas: out?.priorityAreas ?? [],
    uncertain: out?.uncertain ?? [],
    summary: out?.summary ?? "",
    redactedBeforeHuman: redaction.redactedText,
    latencyMs: Math.max(0, Math.round(clock() - started)),
    ...(errors.length ? { error: errors.join("; ") } : {}),
  };
  return { prediction, calls };
}

// ---- The whole run ----

export interface EvalDeps {
  /** Read for HOLDOUT_PATH and the effective backend; `--backend` writes AI_BACKEND / FAKE_LLM into it. */
  env: NodeJS.ProcessEnv;
  projectRoot: string;
  resultsDir: string;
  now: () => Date;
  clock: () => number;
  checkBackend: (ctx: AiContext) => Promise<AiBackendStatus>;
  /** The pipeline's AI functions (default: evalAi). Tests inject failures here. */
  ai: (baseline: boolean, prompts: Record<EvalFn, LoadedPrompt>) => Pick<AiFunctions, "structure" | "flagPii">;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

function defaultDeps(): EvalDeps {
  return {
    env: process.env,
    projectRoot: process.cwd(),
    resultsDir: evalResultsDir(),
    now: () => new Date(),
    clock: () => performance.now(),
    checkBackend: (ctx) => checkAiBackend(ctx),
    ai: evalAi,
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
  };
}

export const SIMULATED_LABEL = "Simulated (fake AI): these numbers test the harness, not a model";
export const CLAUDE_CLI_LABEL = "claude-cli: for the team's own development only, never published";
export const BASELINE_LABEL = "Zero-shot baseline: the same model without AccessLoop's prompts";
export const LAYER1_ONLY_LABEL = "layer 1 only: the AI personal-details pass was off";
export const SILVER_LABEL = "silver set: statements from published reports, areas as their authors labelled them";
export const DRAFT_CHECK_LABEL = "DRAFT check: unreviewed silver labels, a harness check only, not saved and never to be quoted";
export const INJECTION_LABEL = "prompt-injection suite: attacks around real barriers, with per-case checks";

export function resultLabel(backend: AiBackendName, set: EvalSet, baseline: boolean): string {
  const parts = [backend === "fake" ? SIMULATED_LABEL : backend === "claude-cli" ? CLAUDE_CLI_LABEL : "api (Anthropic API)"];
  if (baseline) parts.push(BASELINE_LABEL);
  parts.push(set === "holdout" ? "holdout set" : set === "silver" ? SILVER_LABEL : set === "injection" ? INJECTION_LABEL : "visible set");
  return parts.join("; ");
}

/** Holdout: no PII values in the saved or printed metrics. */
function withoutLeakText(m: EvalMetrics): EvalMetrics {
  return { ...m, pii: { ...m.pii, leaks: m.pii.leaks.map(({ id, type }) => ({ id, type })) } };
}

/** Writes the result as a NEW file (never overwrites: `-2`, `-3`, ... when the name exists). Returns its name. */
async function saveResult(dir: string, result: EvalResult): Promise<string> {
  await mkdir(dir, { recursive: true });
  const date = zonedDate(new Date(result.timestamp));
  for (let n = 1; n < 1000; n++) {
    const name = resultFileName(
      { date, backend: result.backend, set: result.set, baseline: result.baseline, promptSha8: result.promptSha8, layer1Only: result.layer1Only },
      n,
    );
    try {
      await writeFile(path.join(dir, name), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
      return name;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "EEXIST") continue;
      throw err;
    }
  }
  throw new EvalStop("Too many results with the same name today in eval/results.", EXIT_USAGE);
}

/**
 * One eval run. Returns the saved result and its file name (null for a `--draft-check`, which saves nothing); throws
 * EvalStop when it must not save.
 */
export async function runEval(opts: EvalOptions, deps: EvalDeps): Promise<{ file: string | null; result: EvalResult }> {
  applyBackendFlag(deps.env, opts.backend);
  let backend: AiBackendName;
  try {
    backend = effectiveBackend(deps.env);
  } catch (err) {
    throw unusableStop(deps.env.AI_BACKEND?.trim().slice(0, 40) || "configured", err);
  }

  // 1. Is the backend usable here? (Before any fixture is read: a holdout file is opened only for a real run.)
  const ctx = aiLocalScriptContext(SCRIPT_NAME);
  let status: AiBackendStatus;
  try {
    status = await deps.checkBackend(ctx);
  } catch (err) {
    throw unusableStop(backend, err);
  }
  if (status.backend !== backend) {
    throw new EvalStop(`The AI module reports the ${status.backend} backend, but this run asked for ${backend}. Nothing was saved.`, EXIT_BACKEND);
  }

  // 2. Fixtures and prompts.
  const { fixtures, sha: fixturesSha } = await loadFixtures(opts.set, {
    projectRoot: deps.projectRoot,
    env: deps.env,
    draftCheck: opts.draftCheck,
  });
  let prompts: Record<EvalFn, LoadedPrompt>;
  try {
    prompts = evalPrompts(opts.baseline, deps.projectRoot);
  } catch (err) {
    throw new EvalStop(isAiError(err) ? (err as Error).message : "The prompt files could not be read.", EXIT_USAGE);
  }
  const ai = deps.ai(opts.baseline, prompts);
  const layer1Sha = await currentLayer1Sha(deps.projectRoot);

  const repeats = opts.repeats ?? 1;
  const layer1Only = Boolean(opts.layer1Only);
  deps.stderr(
    `[eval] ${fixtures.length} ${opts.set} fixtures, backend ${backend}${opts.baseline ? ", zero-shot baseline" : ""}` +
      `${layer1Only ? ", layer 1 only" : ""}${repeats > 1 ? `, ${repeats} repeats` : ""}` +
      `${status.simulated ? ` (${SIMULATED_LABEL})` : ""}\n`,
  );

  // 3. Every fixture, one after another (claude-cli runs one call at a time anyway; latency stays per report), and
  //    the whole set again for each repeat.
  const passes: FixtureRun[][] = [];
  for (let rep = 1; rep <= repeats; rep++) {
    const runs: FixtureRun[] = [];
    for (const f of fixtures) {
      const run = await runFixture(f, ai, ctx, backend, deps.clock, { layer1Only });
      runs.push(run);
      const p = run.prediction;
      const which = repeats > 1 ? ` (repeat ${rep} of ${repeats})` : "";
      deps.stderr(`[eval] ${f.id}${which} ${p.latencyMs} ms ${p.error ? `error: ${p.error}` : "ok"}\n`); // AiError messages are text-free
    }
    passes.push(runs);
  }

  // A real backend reads the prompt files on every call: each call must have used the prompt this result names.
  if (backend !== "fake") {
    for (const r of passes.flat()) {
      for (const fn of ["structure", "flagPii"] as const) {
        const c = r.calls[fn];
        if (c && c.promptSha !== prompts[fn].sha) {
          throw new EvalStop(`A prompt file changed during the run (${promptRecord(prompts[fn], deps.projectRoot).file}). Run the eval again. Nothing was saved.`, EXIT_USAGE);
        }
      }
    }
  }

  // 4. Score each pass and save.
  const holdout = opts.set === "holdout";
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const scored = passes.map((runs) => {
    const raw = score(fixtures, runs.map((r) => r.prediction)) as EvalMetrics;
    const metrics = holdout ? withoutLeakText(raw) : raw;
    const predictions: PredictionRecord[] = runs.map(({ prediction: p, calls }) => {
      const base = { id: p.id, latencyMs: p.latencyMs, ...(p.error ? { error: p.error } : {}), calls };
      if (holdout) return base;
      const f = byId.get(p.id)!;
      return {
        ...base,
        expected: { primaryArea: f.expected.primaryArea, abstain: Boolean(f.expected.abstain), injection: Boolean(f.expected.injection) },
        priorityAreas: p.priorityAreas,
        uncertain: p.uncertain,
        summary: p.summary,
        redactedBeforeHuman: p.redactedBeforeHuman,
      };
    });
    return { metrics, predictions };
  });
  const [{ metrics, predictions: records }, ...laterRepeats] = scored;
  // The injection suite's strict per-case checks (eval/injection.ts) on the first pass (the one `metrics` scores),
  // next to score()'s own injection count.
  const injectionChecks =
    opts.set === "injection" ? checkInjectionSuite(fixtures as InjectionFixture[], passes[0].map((r) => r.prediction)) : undefined;

  const promptShas = { structure: prompts.structure.sha, flagPii: prompts.flagPii.sha };
  const result = EvalResultSchema.parse({
    format: RESULT_FORMAT,
    simulated: backend === "fake",
    backend,
    set: opts.set,
    baseline: opts.baseline,
    label: [
      resultLabel(backend, opts.set, opts.baseline),
      ...(opts.draftCheck ? [DRAFT_CHECK_LABEL] : []),
      ...(layer1Only ? [LAYER1_ONLY_LABEL] : []),
      ...(repeats > 1 ? [`${repeats} repeats`] : []),
    ].join("; "),
    timestamp: deps.now().toISOString(),
    fixtureCount: fixtures.length,
    fixturesSha,
    prompts: { structure: promptRecord(prompts.structure, deps.projectRoot), flagPii: promptRecord(prompts.flagPii, deps.projectRoot) },
    promptSha8: promptSetSha8(promptShas),
    models: { structure: status.models.structure, flagPii: status.models.flagPii },
    cliVersion: status.cliVersion ?? null,
    abstainThreshold: ABSTAIN_THRESHOLD,
    textOmitted: holdout,
    metrics,
    ...(injectionChecks ? { injectionChecks } : {}),
    predictions: records,
    ...(repeats > 1 ? { repeats, laterRepeats } : {}),
    ...(layer1Only ? { layer1Only: true } : {}),
    callSummary: summarizeCalls(scored.flatMap((x) => x.predictions)),
    ...(layer1Sha ? { layer1Sha } : {}),
  } satisfies EvalResult);

  if (opts.draftCheck) return { file: null, result }; // a DRAFT set is never saved, so it never reaches /app/eval
  const file = await saveResult(deps.resultsDir, result);
  return { file, result };
}

/** `npm run eval`: parse, run, print. Returns the exit code (0 only when a result was saved). */
export async function cli(argv: readonly string[], overrides: Partial<EvalDeps> = {}): Promise<number> {
  const deps = { ...defaultDeps(), ...overrides };
  try {
    const opts = parseEvalArgs(argv);
    if (opts === "help") {
      deps.stdout(`${USAGE}\n`);
      return 0;
    }
    const { file, result } = await runEval(opts, deps);
    if (file === null) {
      deps.stdout(
        `${JSON.stringify(
          {
            draftCheck: true,
            simulated: result.simulated,
            backend: result.backend,
            set: result.set,
            baseline: result.baseline,
            layer1Only: Boolean(result.layer1Only),
            repeats: result.repeats ?? 1,
            label: result.label,
            savedAs: null,
            rates: ratesSummary(allRepeats(result).map((x) => x.metrics)),
            callSummary: result.callSummary,
            metrics: result.metrics,
          },
          null,
          2,
        )}\n`,
      );
      deps.stderr(`[eval] ${DRAFT_CHECK_LABEL}. Nothing was saved.\n`);
      return 0;
    }
    const full = path.join(deps.resultsDir, file);
    const shown = (isInside(deps.projectRoot, full) ? path.relative(deps.projectRoot, full) : full).split(path.sep).join("/");
    deps.stdout(
      `${JSON.stringify(
        {
          simulated: result.simulated,
          backend: result.backend,
          set: result.set,
          baseline: result.baseline,
          layer1Only: Boolean(result.layer1Only),
          repeats: result.repeats ?? 1,
          label: result.label,
          savedAs: shown,
          // Each rate over the repeats: mean, 95% Wilson interval of one pass, and the range across repeats.
          rates: ratesSummary(allRepeats(result).map((x) => x.metrics)),
          callSummary: result.callSummary,
          metrics: result.metrics,
          ...(result.laterRepeats ? { laterRepeatMetrics: result.laterRepeats.map((x) => x.metrics) } : {}),
          ...(result.injectionChecks ? { injectionChecks: result.injectionChecks } : {}),
        },
        null,
        2,
      )}\n`,
    );
    deps.stderr(`[eval] saved ${shown}${result.simulated ? ` (${SIMULATED_LABEL})` : ""}\n`);
    if (result.backend === "claude-cli") {
      deps.stderr("[eval] claude-cli answers vary between runs: re-run with AI_BACKEND=api before quoting any number.\n");
    }
    return 0;
  } catch (err) {
    if (err instanceof EvalStop) {
      deps.stderr(`[eval] ${err.message}\n`);
      return err.exitCode;
    }
    // Anything else: its class (and a Node error code such as EACCES) only; an unexpected message could quote a fixture.
    const code = (err as NodeJS.ErrnoException)?.code;
    const what = `${err instanceof Error ? err.name : "error"}${typeof code === "string" && /^E[A-Z]+$/.test(code) ? ` (${code})` : ""}`;
    deps.stderr(`[eval] stopped by an unexpected ${what}. Nothing was saved.\n`);
    return EXIT_USAGE;
  }
}
