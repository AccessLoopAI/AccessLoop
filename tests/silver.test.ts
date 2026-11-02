// The silver-label eval set (docs/archive/phase7-prompt.md T6 item 2; lib/eval/silver.ts; eval/README.md): the agent-written
// DRAFT file's shape and honesty, and `npm run eval -- --set silver`, which refuses the draft unless `--draft-check`
// says the run only checks the harness (then it saves nothing). Fake backend only, never a real model.
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import draftJson from "@/eval/fixtures/public-silver.draft.json";
import { EXIT_USAGE, DRAFT_CHECK_LABEL, cli, parseEvalArgs, type EvalDeps } from "@/eval/runner";
import { EvalResultSchema, resultFileName } from "@/lib/eval/results";
import { LABEL_BASES, SILVER_MAX, SILVER_MIN, SilverFileSchema, silverFixtures } from "@/lib/eval/silver";
import { PRIORITY_AREAS } from "@/lib/report/headings";
import { SCENARIO_SOURCES } from "@/lib/scenarios";

const draft = SilverFileSchema.parse(draftJson);

describe("the draft silver file", () => {
  it("is marked DRAFT, reviewed by nobody yet, with 60-100 one-line statements", () => {
    expect(draft.status).toBe("DRAFT");
    expect(draft.reviewedBy).toEqual([]);
    expect(draft.notice).toMatch(/DRAFT, NOT REVIEWED/);
    expect(draft.statements.length).toBeGreaterThanOrEqual(SILVER_MIN);
    expect(draft.statements.length).toBeLessThanOrEqual(SILVER_MAX);
    for (const s of draft.statements) expect(s.text).not.toMatch(/[\r\n]/);
  });

  it("labels only with ACA areas, says how each label was read, and uses reports we read", () => {
    for (const s of draft.statements) expect(PRIORITY_AREAS).toContain(s.area);
    expect(new Set(draft.statements.map((s) => s.labelBasis))).toEqual(new Set(LABEL_BASES));
    for (const src of draft.sources) {
      const read = SCENARIO_SOURCES.find((x) => x.id === src.id);
      expect(read?.status, src.id).toBe("read");
      expect(read?.url).toBe(src.url);
      expect(read?.org).toBe(src.org);
    }
    // Transportation was almost empty in the visible set; the airline reports fill it.
    expect(draft.statements.filter((s) => s.area === "transportation").length).toBeGreaterThanOrEqual(5);
  });

  it("names no organization and copies no figure into a statement", () => {
    const orgs = SCENARIO_SOURCES.map((s) => s.org.toLowerCase());
    for (const s of draft.statements) {
      for (const o of orgs) expect(s.text.toLowerCase(), s.id).not.toContain(o);
      expect(s.text, s.id).not.toMatch(/\d/);
      expect(s.text, s.id).not.toMatch(/\b(compliant|certified|guarantee)/i);
    }
  });

  it("becomes classification-only eval fixtures (no PII is seeded in these statements)", () => {
    const fx = silverFixtures(draft);
    expect(fx).toHaveLength(draft.statements.length);
    expect(fx[0]).toMatchObject({
      id: draft.statements[0].id,
      inputMode: "paraphrase",
      expected: { primaryArea: draft.statements[0].area, acceptableAreas: [draft.statements[0].area], pii: [], notPii: [] },
    });
  });

  it("refuses a 'reviewed' file that names no reviewer", () => {
    expect(SilverFileSchema.safeParse({ ...draftJson, status: "reviewed", reviewedBy: [] }).success).toBe(false);
    expect(SilverFileSchema.safeParse({ ...draftJson, status: "reviewed", reviewedBy: ["A. Human"] }).success).toBe(true);
  });
});

let dir: string;
let out: string;
let err: string;
const NOW = new Date("2026-10-20T15:00:00Z");

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

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(os.tmpdir(), "al-silver-")), "results");
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

describe("npm run eval -- --set silver", () => {
  it("parses --set silver and --draft-check, and --draft-check goes with the silver set only", () => {
    expect(parseEvalArgs(["--set", "silver"])).toEqual({ set: "silver", baseline: false, backend: null });
    expect(parseEvalArgs(["--set", "silver", "--draft-check"])).toEqual({ set: "silver", baseline: false, backend: null, draftCheck: true });
    expect(() => parseEvalArgs(["--draft-check"])).toThrow(/only goes with --set silver/);
    expect(() => parseEvalArgs(["--set", "holdout", "--draft-check"])).toThrow(/only goes with --set silver/);
  });

  it("refuses to run while the set is only a draft, says what a human must do, and saves nothing", async () => {
    expect(await cli(["--set", "silver"], deps())).toBe(EXIT_USAGE);
    expect(err).toContain("eval/fixtures/public-silver.json does not exist yet");
    expect(err).toContain("DRAFT");
    expect(err).toContain("--draft-check");
    expect(await saved()).toEqual([]);
  });

  it("--draft-check runs the draft through the harness, prints metrics marked DRAFT, and saves nothing", async () => {
    expect(await cli(["--set", "silver", "--draft-check"], deps())).toBe(0);
    expect(await saved()).toEqual([]);
    const printed = JSON.parse(out);
    expect(printed).toMatchObject({ draftCheck: true, simulated: true, backend: "fake", set: "silver", savedAs: null });
    expect(printed.label).toContain(DRAFT_CHECK_LABEL);
    expect(printed.metrics.n).toBe(draft.statements.length);
    expect(printed.metrics.classification.n).toBe(draft.statements.length);
    expect(printed.metrics.pii.total).toBe(0);
    expect(err).toContain("Nothing was saved");
  });

  it("refuses a public-silver.json that is still marked DRAFT", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "al-silver-root-"));
    try {
      await mkdir(path.join(root, "eval", "fixtures"), { recursive: true });
      await writeFile(path.join(root, "eval", "fixtures", "public-silver.json"), JSON.stringify(draftJson));
      expect(await cli(["--set", "silver"], deps({ projectRoot: root }))).toBe(EXIT_USAGE);
      expect(err).toContain('still marked "status": "DRAFT"');
      expect(await saved()).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs and saves a reviewed set as a silver result", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "al-silver-root-"));
    try {
      await mkdir(path.join(root, "eval", "fixtures"), { recursive: true });
      const reviewed = { ...draftJson, status: "reviewed", reviewedBy: ["A. Human (test)"] };
      await writeFile(path.join(root, "eval", "fixtures", "public-silver.json"), JSON.stringify(reviewed));
      expect(await cli(["--set", "silver"], deps({ projectRoot: root }))).toBe(0);
      const files = await saved();
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^2026-10-20-fake-silver-[0-9a-f]{8}\.json$/);
      const r = EvalResultSchema.parse(JSON.parse(await readFile(path.join(dir, files[0]), "utf8")));
      expect(r).toMatchObject({ set: "silver", simulated: true, fixtureCount: draft.statements.length, textOmitted: false });
      expect(r.label).not.toContain("DRAFT");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("names silver results like the others", () => {
    expect(resultFileName({ date: "2026-10-20", backend: "api", set: "silver", baseline: true, promptSha8: "1a2b3c4d" }))
      .toBe("2026-10-20-api-silver-baseline-1a2b3c4d.json");
  });
});
