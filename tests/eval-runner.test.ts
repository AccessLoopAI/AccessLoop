// The eval runner's plumbing (eval/runner.ts, `npm run eval`) with the FAKE backend or stubbed transports only (never a
// real model): the pipeline, the file name and content (backend, set, simulated, prompts, models), never overwriting a
// saved run, per-fixture errors, the zero-shot baseline's prompts, and an unusable backend stopping the run with a
// clear message and a non-zero exit code WITHOUT saving. The holdout tests use a made-up file in the OS temp folder,
// never HOLDOUT_PATH from .env.local (vitest does not load it, and every test stubs it). Also `--repeats N` (every pass
// scored on its own, rates averaged with lib/eval/intervals.ts) and `--layer1-only` (no flagPii call at all).
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixturesJson from "@/eval/fixtures/reports.json";
import { score, type Fixture, type Prediction } from "@/eval/score";
import {
  CLAUDE_CLI_LABEL,
  EXIT_BACKEND,
  EXIT_USAGE,
  LAYER1_ONLY_LABEL,
  SIMULATED_LABEL,
  callOf,
  cli,
  currentLayer1Sha,
  evalPrompts,
  parseEvalArgs,
  type EvalDeps,
} from "@/eval/runner";
import { AiBackendUnavailableError, AiTimeoutError, loadPrompt, type AiBackendStatus, type AiUsage } from "@/lib/ai";
import { createAi } from "@/lib/ai/core";
import type { ModelReply, ModelRequest, ModelTransport } from "@/lib/ai/requests";
import { ratesSummary } from "@/lib/eval/intervals";
import { redactLayer1 } from "@/lib/intake/redact";
import { summarizeCalls } from "@/lib/eval/usage";
import {
  EvalResultSchema,
  allRepeats,
  baselineFor,
  LAYER1_FILES,
  latestHoldout,
  latestMeasuredOf,
  layer1For,
  layer1ShaOf,
  listEvalResults,
  otherSetRuns,
  pickLatest,
  pickRun,
  promptSetSha8,
  resultFileName,
  savedRunsOrder,
  type EvalResult,
  type EvalSet,
  type SavedEvalResult,
} from "@/lib/eval/results";

const FIXTURES = fixturesJson as Fixture[];
const NOW = new Date("2026-10-19T15:00:00Z");

let dir: string;
let out: string;
let err: string;

function deps(extra: Partial<EvalDeps> = {}): Partial<EvalDeps> {
  return {
    resultsDir: dir,
    now: () => NOW,
    stdout: (t) => {
      out += t;
    },
    stderr: (t) => {
      err += t;
    },
    ...extra,
  };
}

async function saved(): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}

async function readResult(name: string): Promise<EvalResult> {
  return EvalResultSchema.parse(JSON.parse(await readFile(path.join(dir, name), "utf8")));
}

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(os.tmpdir(), "al-eval-")), "results"); // created by the runner
  out = "";
  err = "";
  vi.stubEnv("FAKE_LLM", "1");
  vi.stubEnv("AI_BACKEND", "fake");
  vi.stubEnv("HOLDOUT_PATH", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

describe("command line", () => {
  it("defaults to the visible set, our prompts and the configured backend", () => {
    expect(parseEvalArgs([])).toEqual({ set: "visible", baseline: false, backend: null });
    expect(parseEvalArgs(["--set", "holdout", "--baseline", "--backend", "api"])).toEqual({ set: "holdout", baseline: true, backend: "api" });
    expect(parseEvalArgs(["--set=visible", "--backend=claude-cli"])).toEqual({ set: "visible", baseline: false, backend: "claude-cli" });
    expect(parseEvalArgs(["--help"])).toBe("help");
  });

  it("--repeats N (1-10) and --layer1-only, with any set and the baseline", () => {
    expect(parseEvalArgs(["--repeats", "3"])).toEqual({ set: "visible", baseline: false, backend: null, repeats: 3 });
    expect(parseEvalArgs(["--repeats=10", "--layer1-only", "--set", "holdout", "--baseline"])).toEqual({
      set: "holdout",
      baseline: true,
      backend: null,
      repeats: 10,
      layer1Only: true,
    });
    for (const bad of ["0", "11", "x", "1.5", "-2", "03", "1e1"]) {
      expect(() => parseEvalArgs(["--repeats", bad]), bad).toThrow(/--repeats must be a whole number from 1 to 10/);
    }
    expect(() => parseEvalArgs(["--repeats"])).toThrow(/needs a value/);
  });

  it("refuses what it does not know", () => {
    expect(() => parseEvalArgs(["--set", "all"])).toThrow(/--set must be/);
    expect(() => parseEvalArgs(["--backend", "openai"])).toThrow(/--backend must be/);
    expect(() => parseEvalArgs(["--set"])).toThrow(/needs a value/);
    expect(() => parseEvalArgs(["--holdout"])).toThrow(/Unknown option/);
  });

  it("a bad flag exits non-zero and saves nothing", async () => {
    expect(await cli(["--set", "everything"], deps())).toBe(EXIT_USAGE);
    expect(err).toMatch(/--set must be "visible", "holdout", "silver" or "injection"/);
    expect(await saved()).toEqual([]);
  });
});

describe("file names", () => {
  it("always carry the date and the backend; holdout, layer-1-only and baseline runs say so; never the same name twice", () => {
    const base = { date: "2026-10-19", backend: "fake" as const, set: "visible" as const, baseline: false, promptSha8: "1a2b3c4d" };
    expect(resultFileName(base)).toBe("2026-10-19-fake-1a2b3c4d.json");
    expect(resultFileName({ ...base, backend: "api", set: "holdout", baseline: true })).toBe("2026-10-19-api-holdout-baseline-1a2b3c4d.json");
    expect(resultFileName({ ...base, layer1Only: true })).toBe("2026-10-19-fake-layer1-1a2b3c4d.json");
    expect(resultFileName({ ...base, backend: "api", set: "holdout", baseline: true, layer1Only: true })).toBe("2026-10-19-api-holdout-layer1-baseline-1a2b3c4d.json");
    expect(resultFileName({ ...base, backend: "claude-cli" }, 3)).toBe("2026-10-19-claude-cli-1a2b3c4d-3.json");
  });
});

describe("a fake run (harness check)", () => {
  it("runs every fixture through the pipeline, prints the metrics JSON and saves one simulated result", async () => {
    expect(await cli([], deps())).toBe(0);

    const files = await saved();
    const sha8 = promptSetSha8({ structure: loadPrompt("structure").sha, flagPii: loadPrompt("flagPii").sha });
    expect(files).toEqual([`2026-10-19-fake-${sha8}.json`]);

    const r = await readResult(files[0]);
    expect(r).toMatchObject({
      simulated: true,
      backend: "fake",
      set: "visible",
      baseline: false,
      timestamp: NOW.toISOString(),
      fixtureCount: FIXTURES.length,
      models: { structure: "fake", flagPii: "fake" },
      cliVersion: null,
      textOmitted: false,
      prompts: {
        structure: { file: "lib/ai/prompts/structure.md", sha: loadPrompt("structure").sha },
        flagPii: { file: "lib/ai/prompts/flag-pii.md", sha: loadPrompt("flagPii").sha },
      },
    });
    expect(r.label).toContain(SIMULATED_LABEL);
    expect(r.predictions.map((p) => p.id)).toEqual(FIXTURES.map((f) => f.id));

    // The saved metrics are exactly score() over the saved predictions (redactedBeforeHuman = layers 1 + 2).
    const preds: Prediction[] = r.predictions.map((p) => ({
      id: p.id,
      priorityAreas: p.priorityAreas!,
      uncertain: p.uncertain!,
      summary: p.summary!,
      redactedBeforeHuman: p.redactedBeforeHuman!,
      latencyMs: p.latencyMs,
      ...(p.error ? { error: p.error } : {}),
    }));
    expect(r.metrics).toEqual(score(FIXTURES, preds));
    expect(r.metrics.errors).toBe(0);

    // Layer 1 and the fake layer 2 really ran: F01's name and email are gone before a human reads it.
    const f01 = r.predictions.find((p) => p.id === "F01")!;
    expect(f01.redactedBeforeHuman).not.toContain("Daniel Okafor");
    expect(f01.redactedBeforeHuman).not.toContain("@example.com");
    expect(f01.calls.flagPii?.model).toBe("fake");
    expect(f01.calls.structure?.model).toBe("fake");

    // stdout is one JSON object: the metrics, with the backend and the simulated flag next to them.
    const printed = JSON.parse(out);
    expect(printed).toMatchObject({ simulated: true, backend: "fake", set: "visible" });
    expect(printed.savedAs.endsWith(`/results/${files[0]}`)).toBe(true);
    expect(printed.metrics).toEqual(r.metrics);
    expect(err).toContain(SIMULATED_LABEL);
  });

  it("never overwrites a saved run", async () => {
    expect(await cli([], deps())).toBe(0);
    expect(await cli([], deps())).toBe(0);
    const files = await saved();
    expect(files).toHaveLength(2);
    const first = files.find((f) => /^2026-10-19-fake-[0-9a-f]{8}\.json$/.test(f))!;
    expect(files).toContain(first.replace(".json", "-2.json"));
  });

  it("--backend fake wins over a configured real backend, for this run only", async () => {
    vi.stubEnv("FAKE_LLM", "0");
    vi.stubEnv("AI_BACKEND", "api");
    expect(await cli(["--backend", "fake"], deps())).toBe(0);
    expect((await readResult((await saved())[0])).backend).toBe("fake");
  });

  it("the zero-shot baseline is labelled, named and records the baseline prompts", async () => {
    expect(await cli(["--baseline"], deps())).toBe(0);
    const [file] = await saved();
    expect(file).toMatch(/^2026-10-19-fake-baseline-[0-9a-f]{8}\.json$/);
    const r = await readResult(file);
    expect(r.baseline).toBe(true);
    expect(r.label).toContain("Zero-shot baseline");
    expect(r.prompts.structure.file).toBe("eval/baseline/structure.md");
    expect(r.prompts.flagPii.file).toBe("eval/baseline/flag-pii.md");
    expect(r.prompts.structure.sha).not.toBe(loadPrompt("structure").sha);
  });

  it("a failed AI call is that fixture's text-free error, scored conservatively; the run still saves", async () => {
    const real = createAi({ transports: { api: neverCalled(), "claude-cli": neverCalled() } });
    const f17 = FIXTURES.find((f) => f.id === "F17")!;
    expect(f17.expected.pii).toEqual([]); // so structure gets F17's words unchanged
    const ai: EvalDeps["ai"] = () => ({
      flagPii: real.flagPii,
      structure: async (masked, kind, ctx) => {
        if (masked === f17.text) throw new AiTimeoutError("fake", 10_000); // F17 only
        return real.structure(masked, kind, ctx);
      },
    });
    expect(await cli([], deps({ ai }))).toBe(0);
    const r = await readResult((await saved())[0]);
    expect(r.metrics.errors).toBe(1);
    expect(r.predictions.find((p) => p.id === "F17")!.error).toBe("structure: AiTimeoutError: The fake AI backend did not answer within 10 s.");
    expect(err).toContain("F17");
  });
});

function neverCalled(): ModelTransport {
  return {
    complete: async () => {
      throw new Error("a real transport was called in a test");
    },
  };
}

describe("an unusable backend stops the run without saving", () => {
  it("api without a key says exactly that", async () => {
    vi.stubEnv("FAKE_LLM", "0");
    vi.stubEnv("AI_BACKEND", "api");
    const code = await cli([], deps());
    expect(code).toBe(EXIT_BACKEND);
    expect(err).toMatch(/The api AI backend can't be used/);
    expect(err).toMatch(/ANTHROPIC_API_KEY/);
    expect(err).toMatch(/Nothing was saved/);
    expect(out).toBe("");
    expect(await saved()).toEqual([]);
  });

  it("claude-cli missing or logged out: the startup check's message, exit non-zero", async () => {
    vi.stubEnv("FAKE_LLM", "0");
    vi.stubEnv("AI_BACKEND", "claude-cli");
    const checkBackend = async (): Promise<AiBackendStatus> => {
      throw new AiBackendUnavailableError("claude-cli", "The Claude Code CLI is not logged in. Run `claude` and log in.");
    };
    expect(await cli([], deps({ checkBackend }))).toBe(EXIT_BACKEND);
    expect(err).toContain("The claude-cli AI backend can't be used for the eval here. The Claude Code CLI is not logged in.");
    expect(await saved()).toEqual([]);
  });

  it("claude-cli refuses outside AUTH_MODE=local (domain §6.1 hard limit 2), through the real guard", async () => {
    vi.stubEnv("FAKE_LLM", "0");
    vi.stubEnv("AI_BACKEND", "claude-cli");
    vi.stubEnv("AUTH_MODE", "clerk");
    expect(await cli([], deps())).toBe(EXIT_BACKEND);
    expect(err).toContain('AUTH_MODE is not "local"');
    expect(await saved()).toEqual([]);
  });

  it("an unknown AI_BACKEND is a configuration error, never the fake", async () => {
    vi.stubEnv("FAKE_LLM", "0");
    vi.stubEnv("AI_BACKEND", "gpt");
    expect(await cli([], deps())).toBe(EXIT_BACKEND);
    expect(err).toMatch(/is not a known AI backend/);
    expect(await saved()).toEqual([]);
  });

  it("a call that finds the backend unusable mid-run (e.g. a revoked key) stops it too", async () => {
    const ai: EvalDeps["ai"] = () => ({
      flagPii: async () => {
        throw new AiBackendUnavailableError("fake", "The key was refused (HTTP 401).");
      },
      structure: async () => {
        throw new Error("not reached");
      },
    });
    expect(await cli([], deps({ ai }))).toBe(EXIT_BACKEND);
    expect(err).toContain("The key was refused (HTTP 401).");
    expect(await saved()).toEqual([]);
  });
});

describe("a real backend's run (stubbed transport, never a model)", () => {
  function apiRun(answer: (req: ModelRequest) => unknown, reply: Partial<ModelReply> = {}) {
    const requests: ModelRequest[] = [];
    const deadlines: (number | undefined)[] = [];
    const transport: ModelTransport = {
      complete: async (req, _ctx, opts) => {
        requests.push(req);
        deadlines.push(opts?.deadline);
        return { raw: answer(req), model: req.fn === "structure" ? "model-s" : "model-p", ...reply };
      },
    };
    const checkBackend = async (): Promise<AiBackendStatus> => ({
      backend: "api",
      simulated: false,
      models: { structure: "model-s", flagPii: "model-p", phraseClaims: "model-s" },
    });
    const ai: EvalDeps["ai"] = (_baseline, prompts) =>
      createAi({
        env: () => ({ FAKE_LLM: "0", AI_BACKEND: "api" }),
        transports: { api: transport, "claude-cli": neverCalled() },
        loadPrompt: (fn) => (fn === "structure" || fn === "flagPii" ? prompts[fn] : loadPrompt(fn)),
      });
    return { requests, deadlines, checkBackend, ai };
  }
  const answer = (req: ModelRequest) =>
    req.fn === "flagPii"
      ? { items: [] }
      : { summary: "You could not use it.", priorityAreas: [{ area: "ict", confidence: 0.9 }], uncertain: [] };

  it("is not simulated, names the backend and models, and the baseline sends the baseline system prompts", async () => {
    vi.stubEnv("FAKE_LLM", "0");
    vi.stubEnv("AI_BACKEND", "api");
    const run = apiRun(answer);
    expect(await cli(["--baseline"], deps({ checkBackend: run.checkBackend, ai: run.ai }))).toBe(0);
    const [file] = await saved();
    expect(file).toMatch(/^2026-10-19-api-baseline-[0-9a-f]{8}\.json$/);
    const r = await readResult(file);
    expect(r).toMatchObject({ simulated: false, backend: "api", baseline: true, models: { structure: "model-s", flagPii: "model-p" } });
    expect(r.label).not.toContain("Simulated");

    const baseline = evalPrompts(true, process.cwd());
    expect(run.requests).toHaveLength(FIXTURES.length * 2);
    for (const req of run.requests) {
      expect(req.prompt.text).toBe(baseline[req.fn as "structure" | "flagPii"].text);
      expect(req.prompt.text).not.toBe(loadPrompt(req.fn).text);
    }
    // structure gets the layer 1 + 2 text, inside <report>, like intake.
    const f01 = run.requests.find((q) => q.fn === "structure" && q.userTurn.includes("date picker"))!;
    expect(f01.userTurn).toContain("<report>");
    expect(f01.userTurn).not.toContain("daniel.okafor@example.com");
  });

  it("every call keeps its latency, token usage and attempts (numbers only); each fixture has a preview's 10 s budget", async () => {
    vi.stubEnv("FAKE_LLM", "0");
    vi.stubEnv("AI_BACKEND", "api");
    const run = apiRun(answer, { usage: { inputTokens: 900, outputTokens: 70, cacheReadInputTokens: 0 }, attempts: 1 });
    const before = Date.now();
    expect(await cli([], deps({ checkBackend: run.checkBackend, ai: run.ai }))).toBe(0);
    const r = await readResult((await saved())[0]);
    for (const p of r.predictions) {
      for (const fn of ["flagPii", "structure"] as const) {
        expect(p.calls[fn]).toEqual({
          model: fn === "structure" ? "model-s" : "model-p",
          promptSha: loadPrompt(fn).sha,
          latencyMs: expect.any(Number),
          usage: { inputTokens: 900, outputTokens: 70, cacheReadInputTokens: 0 },
          attempts: 1,
        });
      }
    }
    // One deadline per fixture, shared by its two calls, 10 s after it started (intakeAiBudgetMs("api")).
    expect(run.deadlines).toHaveLength(FIXTURES.length * 2);
    for (const d of run.deadlines) {
      expect(d).toBeGreaterThanOrEqual(before + 10_000);
      expect(d).toBeLessThanOrEqual(Date.now() + 10_000);
    }
    expect(run.deadlines[0]).toBe(run.deadlines[1]);
  });

  it("callOf drops anything that is not a number (no text can reach a result)", () => {
    const meta = {
      backend: "api" as const,
      model: "m",
      promptSha: "s",
      latencyMs: 12,
      usage: { inputTokens: 1, outputTokens: 2, thinkingTokens: 3, text: "Daniel" } as unknown as AiUsage,
    };
    expect(callOf(meta)).toEqual({ model: "m", promptSha: "s", latencyMs: 12, usage: { inputTokens: 1, outputTokens: 2, thinkingTokens: 3 } });
    expect(callOf({ backend: "fake", model: "fake", promptSha: "s", latencyMs: 0 })).toEqual({ model: "fake", promptSha: "s", latencyMs: 0 });
  });

  it("our prompts by default; the file says claude-cli results are never published", async () => {
    vi.stubEnv("FAKE_LLM", "0");
    vi.stubEnv("AI_BACKEND", "claude-cli");
    const run = apiRun(answer);
    const checkBackend = async (): Promise<AiBackendStatus> => ({
      backend: "claude-cli",
      simulated: false,
      models: { structure: "sonnet", flagPii: "sonnet", phraseClaims: "sonnet" },
      cliVersion: "2.1.300",
    });
    const ai: EvalDeps["ai"] = (b, prompts) => {
      const a = run.ai(b, prompts);
      return { structure: a.structure, flagPii: a.flagPii };
    };
    expect(await cli([], deps({ checkBackend, ai }))).toBe(0);
    const r = await readResult((await saved())[0]);
    // The stub answers through the api transport; what matters here is what the runner records for claude-cli.
    expect(r).toMatchObject({ backend: "claude-cli", simulated: false, cliVersion: "2.1.300", models: { structure: "sonnet" } });
    expect(r.label).toContain(CLAUDE_CLI_LABEL);
    expect(r.prompts.structure.file).toBe("lib/ai/prompts/structure.md");
    expect(err).toMatch(/re-run with AI_BACKEND=api before quoting/);
  });
});

describe("holdout", () => {
  it("needs HOLDOUT_PATH and says so; nothing is saved", async () => {
    expect(await cli(["--set", "holdout"], deps())).toBe(EXIT_USAGE);
    expect(err).toContain("HOLDOUT_PATH is not set");
    expect(await saved()).toEqual([]);
  });

  it("refuses a holdout file inside the project folder", async () => {
    vi.stubEnv("HOLDOUT_PATH", "eval/fixtures/reports.json");
    expect(await cli(["--set", "holdout"], deps())).toBe(EXIT_USAGE);
    expect(err).toContain("HOLDOUT_PATH points inside the project folder");
    expect(await saved()).toEqual([]);
  });

  it("saves scores, IDs and types only: no report text, summaries, PII values or labels", async () => {
    const secretName = "Zebulon Quillfeather";
    const made: Fixture[] = [
      {
        id: "H01", lang: "en", inputMode: "typed", locationKind: "digital", tags: [],
        text: `I'm ${secretName}, zq@example.org. The date picker on your site doesn't work with a keyboard.`,
        expected: { primaryArea: "ict", acceptableAreas: ["ict"], pii: [{ text: secretName, type: "PERSON" }, { text: "zq@example.org", type: "EMAIL" }], notPii: [] },
      },
      {
        id: "H02", lang: "en", inputMode: "typed", locationKind: "place", tags: [],
        text: "The door button at the library is broken again.",
        expected: { primaryArea: "built_environment", acceptableAreas: ["built_environment"], pii: [], notPii: ["library"] },
      },
    ];
    const file = path.join(path.dirname(dir), "made-up-holdout.json"); // in the OS temp folder, outside the project
    await writeFile(file, JSON.stringify(made));
    vi.stubEnv("HOLDOUT_PATH", file);

    expect(await cli(["--set", "holdout"], deps())).toBe(0);
    const [name] = await saved();
    expect(name).toMatch(/^2026-10-19-fake-holdout-[0-9a-f]{8}\.json$/);
    const rawFile = await readFile(path.join(dir, name), "utf8");
    const r = EvalResultSchema.parse(JSON.parse(rawFile));
    expect(r).toMatchObject({ set: "holdout", textOmitted: true, fixtureCount: 2, simulated: true });
    expect(r.metrics.pii.leaks.length).toBeGreaterThan(0); // the fake never finds this name
    for (const leak of r.metrics.pii.leaks) expect(leak).toEqual({ id: leak.id, type: leak.type });
    for (const p of r.predictions) expect(Object.keys(p).sort()).toEqual(["calls", "id", "latencyMs"]);
    for (const text of [secretName, "Zebulon", "date picker", "door button", "library", "zq@example.org"]) {
      expect(rawFile).not.toContain(text);
      expect(out).not.toContain(text);
      expect(err).not.toContain(text);
    }
  });

  it("a malformed holdout file is named by position only, never by content", async () => {
    const file = path.join(path.dirname(dir), "bad-holdout.json");
    await writeFile(file, JSON.stringify([{ id: "H01", text: "Private words here", lang: "de" }]));
    vi.stubEnv("HOLDOUT_PATH", file);
    expect(await cli(["--set", "holdout"], deps())).toBe(EXIT_USAGE);
    expect(err).toMatch(/not in the fixtures format .* at 0\./);
    expect(err).not.toContain("Private words");
    expect(await saved()).toEqual([]);
  });
});

describe("reading saved results (the /app/eval page)", () => {
  it("lists the newest first and pairs the latest run with its baseline", async () => {
    expect(await cli([], deps({ now: () => new Date("2026-10-19T10:00:00Z") }))).toBe(0);
    expect(await cli(["--baseline"], deps({ now: () => new Date("2026-10-19T11:00:00Z") }))).toBe(0);
    expect(await cli([], deps({ now: () => new Date("2026-10-19T12:00:00Z") }))).toBe(0);
    await writeFile(path.join(dir, "notes.json"), "{}");

    const listing = await listEvalResults(dir);
    expect(listing.results.map((r) => r.result.timestamp)).toEqual([
      "2026-10-19T12:00:00.000Z",
      "2026-10-19T11:00:00.000Z",
      "2026-10-19T10:00:00.000Z",
    ]);
    expect(listing.unreadable).toEqual(["notes.json"]);
    const { main, baseline } = pickLatest(listing);
    expect(main?.result.timestamp).toBe("2026-10-19T12:00:00.000Z");
    expect(baseline?.result.baseline).toBe(true);
  });

  it("no folder is no result", async () => {
    expect(await listEvalResults(path.join(dir, "missing"))).toEqual({ results: [], unreadable: [] });
    expect(pickLatest({ results: [], unreadable: [] })).toEqual({ main: null, baseline: null });
    expect(pickRun({ results: [], unreadable: [] }, "2026-10-19-fake-00000000.json")).toEqual({ main: null, baseline: null, notFound: true });
  });

  it("a baseline sits next to a run only with the same backend, models, set and fixtures", async () => {
    expect(await cli([], deps({ now: () => new Date("2026-10-19T12:00:00Z") }))).toBe(0);
    expect(await cli(["--baseline"], deps({ now: () => new Date("2026-10-19T11:00:00Z") }))).toBe(0);
    const listing = await listEvalResults(dir);
    const [main, base] = listing.results;
    expect(baselineFor(listing, main)?.file).toBe(base.file);
    expect(baselineFor(listing, base)).toBeNull(); // a baseline has no baseline
    const otherModel = { ...base, result: { ...base.result, models: { ...base.result.models, structure: "another-model" } } };
    expect(baselineFor({ ...listing, results: [main, otherModel] }, main)).toBeNull();
    const otherFixtures = { ...base, result: { ...base.result, fixturesSha: "0".repeat(64) } };
    expect(baselineFor({ ...listing, results: [main, otherFixtures] }, main)).toBeNull();
  });

  it("?run=<file> picks that saved run by its name in the listing; an unknown name is the latest, marked notFound", async () => {
    expect(await cli([], deps({ now: () => new Date("2026-10-19T10:00:00Z") }))).toBe(0);
    expect(await cli(["--baseline"], deps({ now: () => new Date("2026-10-19T11:00:00Z") }))).toBe(0);
    expect(await cli([], deps({ now: () => new Date("2026-10-19T12:00:00Z") }))).toBe(0);
    const listing = await listEvalResults(dir);
    const [newest, base, oldest] = listing.results;
    expect(pickRun(listing, null)).toEqual({ ...pickLatest(listing), notFound: false });
    expect(pickRun(listing, oldest.file)).toEqual({ main: oldest, baseline: base, notFound: false });
    expect(pickRun(listing, base.file)).toEqual({ main: base, baseline: null, notFound: false });
    for (const bad of ["nope.json", `../results/${oldest.file}`, path.join(dir, oldest.file)]) {
      expect(pickRun(listing, bad)).toEqual({ main: newest, baseline: base, notFound: true });
    }
    expect(latestHoldout(listing)).toBeNull(); // only visible-set runs here (holdout: tests/eval-page.test.ts)
  });

  it("a hand-edited file can't present the fake backend's answers as a model's", async () => {
    expect(await cli([], deps())).toBe(0);
    const [name] = await saved();
    const r = JSON.parse(await readFile(path.join(dir, name), "utf8"));
    await writeFile(path.join(dir, name), JSON.stringify({ ...r, simulated: false }));
    const listing = await listEvalResults(dir);
    expect(listing.results).toEqual([]);
    expect(listing.unreadable).toEqual([name]);
  });
});

describe("--repeats and --layer1-only", () => {
  it("--repeats 3 runs the set three times, scores each pass on its own and prints the mean with its interval", async () => {
    expect(await cli(["--repeats", "3"], deps())).toBe(0);
    const files = await saved();
    expect(files).toHaveLength(1); // one result file for the whole run
    const r = await readResult(files[0]);
    expect(r.repeats).toBe(3);
    expect(r.laterRepeats).toHaveLength(2);
    expect(r.label).toContain("3 repeats");
    const passes = allRepeats(r);
    for (const pass of passes) {
      expect(pass.predictions.map((p) => p.id)).toEqual(FIXTURES.map((f) => f.id));
      const preds: Prediction[] = pass.predictions.map((p) => ({
        id: p.id,
        priorityAreas: p.priorityAreas!,
        uncertain: p.uncertain!,
        summary: p.summary!,
        redactedBeforeHuman: p.redactedBeforeHuman!,
        latencyMs: p.latencyMs,
      }));
      expect(pass.metrics).toEqual(score(FIXTURES, preds));
    }
    // Latency and usage per function over every pass.
    expect(r.callSummary).toEqual(summarizeCalls(passes.flatMap((x) => x.predictions)));
    expect(r.callSummary!.flagPii.calls).toBe(3 * FIXTURES.length);
    expect(r.callSummary!.report.n).toBe(3 * FIXTURES.length);
    expect(err).toContain("F01 (repeat 2 of 3)");
    expect(err).toContain(", 3 repeats");

    const printed = JSON.parse(out);
    expect(printed).toMatchObject({ repeats: 3, layer1Only: false });
    expect(printed.rates).toEqual(ratesSummary(passes.map((x) => x.metrics)));
    expect(printed.rates.piiRemoved.ci95).toHaveLength(2);
    expect(printed.laterRepeatMetrics).toHaveLength(2);
    expect(printed.callSummary).toEqual(r.callSummary);
  });

  it("one pass keeps today's format: no repeats fields, and a call summary", async () => {
    expect(await cli([], deps())).toBe(0);
    const r = await readResult((await saved())[0]);
    expect(r.repeats).toBeUndefined();
    expect(r.laterRepeats).toBeUndefined();
    expect(r.layer1Only).toBeUndefined();
    expect(r.callSummary).toEqual(summarizeCalls(r.predictions));
    expect(r.callSummary!.report.p50Ms).toBe(r.metrics.latencyMs.p50); // the same percentile rule as score.ts
    expect(r.callSummary!.report.p95Ms).toBe(r.metrics.latencyMs.p95);
    expect(JSON.parse(out)).toMatchObject({ repeats: 1, layer1Only: false });
    expect(JSON.parse(out).laterRepeatMetrics).toBeUndefined();
  });

  it("--layer1-only never calls flagPii: what a human reads first is layer 1 alone; structure runs as usual", async () => {
    expect(await cli(["--layer1-only"], deps())).toBe(0);
    const [file] = await saved();
    expect(file).toMatch(/^2026-10-19-fake-layer1-[0-9a-f]{8}\.json$/);
    const r = await readResult(file);
    expect(r.layer1Only).toBe(true);
    expect(r.label).toContain(LAYER1_ONLY_LABEL);
    for (const p of r.predictions) {
      expect(p.calls.flagPii).toBeUndefined();
      expect(p.calls.structure?.model).toBe("fake");
      expect(p.redactedBeforeHuman).toBe(redactLayer1(FIXTURES.find((f) => f.id === p.id)!.text));
    }
    expect(r.callSummary!.flagPii.calls).toBe(0);
    expect(JSON.parse(out).layer1Only).toBe(true);
  });

  it("--layer1-only with a real backend sends structure requests only", async () => {
    vi.stubEnv("FAKE_LLM", "0");
    vi.stubEnv("AI_BACKEND", "api");
    const fns: string[] = [];
    const transport: ModelTransport = {
      complete: async (req) => {
        fns.push(req.fn);
        return { raw: { summary: "You could not use it.", priorityAreas: [{ area: "ict", confidence: 0.9 }], uncertain: [] }, model: "model-s", usage: { inputTokens: 5, outputTokens: 1 } };
      },
    };
    const checkBackend = async (): Promise<AiBackendStatus> => ({
      backend: "api",
      simulated: false,
      models: { structure: "model-s", flagPii: "model-p", phraseClaims: "model-s" },
    });
    const ai: EvalDeps["ai"] = (_b, prompts) =>
      createAi({
        env: () => ({ FAKE_LLM: "0", AI_BACKEND: "api" }),
        transports: { api: transport, "claude-cli": neverCalled() },
        loadPrompt: (fn) => (fn === "structure" || fn === "flagPii" ? prompts[fn] : loadPrompt(fn)),
      });
    expect(await cli(["--layer1-only", "--repeats", "2"], deps({ checkBackend, ai }))).toBe(0);
    expect(fns).toEqual(Array(2 * FIXTURES.length).fill("structure"));
    const r = await readResult((await saved())[0]);
    expect(r).toMatchObject({ backend: "api", simulated: false, layer1Only: true, repeats: 2 });
    expect(r.callSummary!.structure).toMatchObject({ calls: 2 * FIXTURES.length, withUsage: 2 * FIXTURES.length, inputTokens: 10 * FIXTURES.length });
  });

  it("holdout with repeats: every pass keeps scores, IDs, types and latencies only", async () => {
    const secretName = "Zebulon Quillfeather";
    const made: Fixture[] = [
      {
        id: "H01", lang: "en", inputMode: "typed", locationKind: "digital", tags: [],
        text: `I'm ${secretName}. The date picker on your site doesn't work with a keyboard.`,
        expected: { primaryArea: "ict", acceptableAreas: ["ict"], pii: [{ text: secretName, type: "PERSON" }], notPii: [] },
      },
    ];
    const file = path.join(path.dirname(dir), "made-up-holdout.json");
    await writeFile(file, JSON.stringify(made));
    vi.stubEnv("HOLDOUT_PATH", file);
    expect(await cli(["--set", "holdout", "--repeats", "2"], deps())).toBe(0);
    const [name] = await saved();
    const rawFile = await readFile(path.join(dir, name), "utf8");
    const r = EvalResultSchema.parse(JSON.parse(rawFile));
    expect(r.laterRepeats).toHaveLength(1);
    for (const pass of allRepeats(r)) {
      for (const p of pass.predictions) expect(Object.keys(p).sort()).toEqual(["calls", "id", "latencyMs"]);
      for (const leak of pass.metrics.pii.leaks) expect(leak).toEqual({ id: leak.id, type: leak.type });
    }
    for (const text of [secretName, "Zebulon", "date picker"]) {
      expect(rawFile).not.toContain(text);
      expect(out).not.toContain(text);
      expect(err).not.toContain(text);
    }
  });

  it("a hand-edited file can't claim repeats it does not have, or a layer-1-only run with AI calls", async () => {
    expect(await cli(["--repeats", "2"], deps())).toBe(0);
    const [name] = await saved();
    const r = JSON.parse(await readFile(path.join(dir, name), "utf8"));
    await writeFile(path.join(dir, "a.json"), JSON.stringify({ ...r, repeats: 3 }));
    await writeFile(path.join(dir, "b.json"), JSON.stringify({ ...r, layer1Only: true }));
    await writeFile(path.join(dir, "c.json"), JSON.stringify({ ...r, laterRepeats: [{ ...r.laterRepeats[0], predictions: [] }] }));
    const listing = await listEvalResults(dir);
    expect(listing.results.map((x) => x.file)).toEqual([name]);
    expect(listing.unreadable).toEqual(["a.json", "b.json", "c.json"]);
  });
});

describe("which run leads, and which layer-1 run pairs (T1c gate)", () => {
  /** The same saved run as another backend, set or time (the schema keeps `simulated` honest). */
  function as(s: SavedEvalResult, file: string, extra: Partial<EvalResult>): SavedEvalResult {
    const backend = extra.backend ?? s.result.backend;
    return { file, result: EvalResultSchema.parse({ ...s.result, ...extra, simulated: backend === "fake" }) };
  }

  it("every new result records the layer-1 code it ran with; a full run and a layer-1-only run of it pair", async () => {
    expect(await cli([], deps({ now: () => new Date("2026-10-19T12:00:00Z") }))).toBe(0);
    expect(await cli(["--layer1-only"], deps({ now: () => new Date("2026-10-19T11:00:00Z") }))).toBe(0);
    const expected = layer1ShaOf(
      await Promise.all(LAYER1_FILES.map(async (file) => ({ file, bytes: await readFile(path.join(process.cwd(), ...file.split("/"))) }))),
    );
    expect(await currentLayer1Sha(process.cwd())).toBe(expected);
    expect(await currentLayer1Sha(path.dirname(dir))).toBeNull(); // no such files there: the field is left out
    const listing = await listEvalResults(dir);
    const [full, l1] = listing.results;
    expect(full.result.layer1Sha).toBe(expected);
    expect(l1.result.layer1Sha).toBe(expected);
    expect(layer1For(listing, full)?.file).toBe(l1.file);
  });

  it("a layer-1-only run made with other patterns (or before the fingerprint) never sits next to a newer full run", async () => {
    expect(await cli([], deps({ now: () => new Date("2026-10-19T12:00:00Z") }))).toBe(0);
    expect(await cli(["--layer1-only"], deps({ now: () => new Date("2026-10-19T11:00:00Z") }))).toBe(0);
    const listing = await listEvalResults(dir);
    const [full, l1] = listing.results;
    const otherPatterns = as(l1, "old-patterns.json", { layer1Sha: "0".repeat(64) });
    expect(layer1For({ ...listing, results: [full, otherPatterns] }, full)).toBeNull();
    const unmarked = { ...l1.result };
    delete unmarked.layer1Sha;
    const before = { file: "before-fingerprint.json", result: EvalResultSchema.parse(unmarked) };
    expect(layer1For({ ...listing, results: [full, before] }, full)).toBeNull();
    // Two results saved before the fingerprint existed still pair (the runs saved on 2026-10-20).
    const fullUnmarked = { ...full.result };
    delete fullUnmarked.layer1Sha;
    const oldFull = { file: "old-full.json", result: EvalResultSchema.parse(fullUnmarked) };
    expect(layer1For({ ...listing, results: [oldFull, before] }, oldFull)?.file).toBe(before.file);
  });

  it("an api run leads over a newer claude-cli run (domain §6.1: claude-cli numbers are never published); claude-cli leads only without one", async () => {
    expect(await cli([], deps({ now: () => new Date("2026-10-19T12:00:00Z") }))).toBe(0);
    const [fake] = (await listEvalResults(dir)).results;
    const api = as(fake, "2026-10-18-api-x.json", { backend: "api", timestamp: "2026-10-18T09:00:00.000Z" });
    const cliRun = as(fake, "2026-10-19-claude-cli-x.json", { backend: "claude-cli", timestamp: "2026-10-19T09:00:00.000Z" });
    const both = { results: [fake, cliRun, api], unreadable: [] }; // newest first
    expect(pickLatest(both).main?.file).toBe(api.file);
    expect(latestMeasuredOf(both.results)?.file).toBe(api.file);
    expect(pickLatest({ results: [fake, cliRun], unreadable: [] }).main?.file).toBe(cliRun.file);
    expect(savedRunsOrder(both).map((s) => s.file)).toEqual([api.file, cliRun.file, fake.file]);
    // The same rule for the holdout headline and for other sets' cards.
    const hApi = as(api, "h-api.json", { set: "holdout" });
    const hCli = as(cliRun, "h-cli.json", { set: "holdout" });
    expect(latestHoldout({ results: [hCli, hApi], unreadable: [] })?.file).toBe(hApi.file);
    const silverSet = "silver" as EvalSet; // the set arrives from another branch; the page reads any string
    const sApi = { file: "s-api.json", result: { ...api.result, set: silverSet } };
    const sCli = { file: "s-cli.json", result: { ...cliRun.result, set: silverSet } };
    expect(otherSetRuns({ results: [sCli, sApi], unreadable: [] })).toEqual([{ set: "silver", measured: sApi, simulated: null }]);
  });
});
