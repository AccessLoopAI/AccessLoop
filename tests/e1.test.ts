// The E1 candidate reports (eval/fixtures/e1-candidates.json; issue #21) and their labelling sheet (eval/e1-labels.ts):
// 50-60 new reports in the visible set's format with NO area labels yet, covering what the visible set lacks, every
// personal detail made up; the sheet matches them; Cohen's kappa is computed right; and `--set visible --draft-check`
// runs them through the harness without saving anything.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  E1_CANDIDATES_FILE,
  SHEET_FILE,
  cohensKappa,
  kappaReport,
  parseCsv,
  readSheet,
  sheetRows,
  toCsv,
} from "@/eval/e1-labels";
import { loadFixtures } from "@/eval/runner";
import type { Fixture } from "@/eval/score";

const root = process.cwd();
const read = (f: string) => readFileSync(path.join(root, "eval", "fixtures", f), "utf8");
const candidates = JSON.parse(read(E1_CANDIDATES_FILE)) as Fixture[];
const visible = JSON.parse(read("reports.json")) as Fixture[];
const share = (f: (x: Fixture) => boolean) => candidates.filter(f).length / candidates.length;

describe("the E1 candidates", () => {
  it("load as the visible set's draft, 50 to 60 of them, with ids the visible set doesn't use", async () => {
    const { fixtures, source } = await loadFixtures("visible", { projectRoot: root, env: {}, draftCheck: true });
    expect(source).toBe(`eval/fixtures/${E1_CANDIDATES_FILE}`);
    expect(fixtures.length).toBeGreaterThanOrEqual(50);
    expect(fixtures.length).toBeLessThanOrEqual(60);
    const ids = new Set(visible.map((f) => f.id));
    for (const f of fixtures) expect(ids.has(f.id)).toBe(false);
    const plain = await loadFixtures("visible", { projectRoot: root, env: {} });
    expect(plain.source).toBe("eval/fixtures/reports.json");
  });

  it("have no area labels yet: two people label them first", () => {
    for (const f of candidates) {
      expect(f.expected.primaryArea, f.id).toBeNull();
      expect(f.expected.acceptableAreas, f.id).toEqual([]);
      expect(f.expected.abstain, f.id).toBeUndefined();
    }
  });

  it("cover what the visible set lacks", () => {
    expect(share((f) => f.lang === "fr")).toBeGreaterThanOrEqual(0.3);
    expect(candidates.filter((f) => f.expected.injection).length).toBe(8);
    const modes = new Set(candidates.map((f) => f.inputMode));
    for (const m of ["dictation", "aac", "plain_language"]) expect(modes.has(m), m).toBe(true);
    expect(share((f) => f.locationKind !== "digital")).toBeGreaterThan(0.6); // mostly not web barriers
    const types = candidates.flatMap((f) => f.expected.pii.map((p) => p.type));
    expect(types.filter((t) => t === "QUASI_ID").length).toBeGreaterThanOrEqual(2);
    expect(types.filter((t) => t === "STAFF_NAME").length).toBeGreaterThanOrEqual(3);
    expect(types).toContain("STREET_ADDRESS");
    expect(candidates.filter((f) => f.tags.includes("two-area")).length).toBeGreaterThanOrEqual(3);
  });

  it("only hold made-up personal details, each found word for word in its text", () => {
    for (const f of candidates) {
      for (const p of f.expected.pii) expect(f.text, `${f.id} ${p.type}`).toContain(p.text);
      for (const w of f.expected.notPii) expect(f.text, f.id).toContain(w);
      for (const phone of f.text.match(/\b\d{3}[ -]\d{3}[ -]\d{4}\b/g) ?? []) expect(phone.replace(/\D/g, "").slice(3, 8), f.id).toMatch(/^5550[01]/);
      for (const email of f.text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []) expect(email, f.id).toMatch(/@example\.(com|org)$/);
      for (const sin of f.expected.pii.filter((p) => p.type === "SIN")) expect(sin.text).toBe("046 454 286");
    }
  });
});

describe("the labelling sheet", () => {
  it("has one row per candidate, in order, with every label column empty", () => {
    const rows = readSheet(read(SHEET_FILE));
    expect(rows.map((r) => r.id)).toEqual(candidates.map((f) => f.id));
    expect(rows.map((r) => r.text)).toEqual(candidates.map((f) => f.text));
    for (const r of rows) expect([r.a_primary, r.a_acceptable, r.b_primary, r.b_acceptable]).toEqual(["", "", "", ""]);
  });

  it("round-trips quotes, commas and line breaks, and refuses unknown labels", () => {
    const rows = [["a", 'say "hi", then\nleave'], ["b", "plain"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
    const sheet = toCsv(sheetRows(candidates.slice(0, 1)).map((r, i) => (i === 1 ? r.map((v, j) => (j === 6 ? "parking" : v)) : r)));
    expect(() => readSheet(sheet)).toThrow(/is not one of/);
  });

  it("is never written from candidates that already carry an area", () => {
    const labelled = [{ ...candidates[0], expected: { ...candidates[0].expected, primaryArea: "ict" } }];
    expect(() => sheetRows(labelled)).toThrow(/already has an area/);
  });
});

describe("Cohen's kappa", () => {
  it("matches a worked example and the edge cases", () => {
    // 10 items, 7 agree; rater A: 5 x, 5 y; rater B: 6 x, 4 y. Chance = .5*.6 + .5*.4 = .5, kappa = (.7-.5)/.5 = .4
    const a = ["x", "x", "x", "x", "x", "y", "y", "y", "y", "y"];
    const b = ["x", "x", "x", "x", "y", "x", "x", "y", "y", "y"];
    expect(cohensKappa(a, b).agreement).toBeCloseTo(0.7);
    expect(cohensKappa(a, b).kappa).toBeCloseTo(0.4);
    expect(cohensKappa(["x", "x"], ["x", "x"]).kappa).toBe(1);
    expect(cohensKappa([], []).n).toBe(0);
    expect(() => cohensKappa(["x"], [])).toThrow();
  });

  it("reports only rows both people labelled, and names the ones to settle", () => {
    const rows = readSheet(read(SHEET_FILE)).slice(0, 3);
    rows[0] = { ...rows[0], a_primary: "built_environment", b_primary: "built_environment" };
    rows[1] = { ...rows[1], a_primary: "ict", b_primary: "programs_services" };
    const out = kappaReport(rows);
    expect(out).toContain("2 of 3");
    expect(out).toContain(`Settle these 1: ${rows[1].id}`);
    expect(out).toContain(`Still to label: ${rows[2].id}`);
  });
});
