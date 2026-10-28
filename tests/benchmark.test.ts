// The Feedback-section benchmark (docs/archive/phase7-prompt.md T6 item 3; data/benchmark/README.md): the committed CSV
// (every row unverified, seeded from the review's reading), the parser that refuses a half-checked file, the median
// over VERIFIED rows only, what a draft built by AccessLoop covers, and the "How your Feedback section compares" card
// rendered to static HTML (hidden with no verified row; "Your draft covers N of 7 elements; published median is M").
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BENCHMARK_CARD_TITLE, FeedbackBenchmarkView, benchmarkHeadline } from "@/components/benchmark/FeedbackBenchmarkCard";
import {
  BENCHMARK_ELEMENT_KEYS,
  BENCHMARK_HEADER,
  benchmarkSummary,
  draftCoverage,
  median,
  parseBenchmarkCsv,
  parseCsv,
  rowScore,
} from "@/lib/benchmark/feedback-sections";
import { BENCHMARK_CSV, loadFeedbackBenchmark } from "@/lib/benchmark/load";
import { zonedNoon } from "@/lib/dates";
import type { MetricCase } from "@/lib/metrics";
import { compileClaims } from "@/lib/report/claims";
import { buildContent, reportSettings } from "@/lib/report/compose";
import { snapshotFromCases } from "@/lib/report/snapshot";
import { chooseSentences, validationContext } from "@/lib/report/validate";
import { SCENARIO_SOURCES } from "@/lib/scenarios";
import { Story, caseId, ref } from "./support/report-story";

const CSV = readFileSync(path.join(process.cwd(), BENCHMARK_CSV), "utf8");
const NOW = zonedNoon("2026-10-19");
const YEAR = { start: "2026-01-01", end: "2026-12-31" };
const ORG = {
  name: "Test Org",
  slug: "test-org",
  feedbackDesignateTitle: "Manager, Accessibility",
  contactMailingAddress: "1 Test Road, Ottawa, ON K1A 0A0",
  contactPhone: "1-800-555-0199",
  contactEmail: "access@example.org",
};

const html = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/** The committed file with some rows marked as checked by a person (values made complete where needed). */
function withVerified(ids: Record<string, Partial<Record<(typeof BENCHMARK_ELEMENT_KEYS)[number], string>>>): string {
  const [header, ...rows] = parseCsv(CSV);
  const out = rows.map((cells) => {
    const id = cells[0];
    if (!(id in ids)) return cells;
    const next = [...cells];
    for (const key of BENCHMARK_ELEMENT_KEYS) {
      const i = BENCHMARK_HEADER.indexOf(key);
      next[i] = ids[id][key] ?? (next[i] === "unknown" ? "no" : next[i]);
    }
    next[BENCHMARK_HEADER.indexOf("verified_by_human")] = "true";
    next[BENCHMARK_HEADER.indexOf("verified_by")] = "QA";
    next[BENCHMARK_HEADER.indexOf("verified_on")] = "2026-10-21";
    return next;
  });
  const quote = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return [header, ...out].map((r) => r.map(quote).join(",")).join("\n") + "\n";
}

describe("data/benchmark/feedback-sections.csv as committed", () => {
  const parsed = parseBenchmarkCsv(CSV);
  const rows = parsed.ok ? parsed.rows : [];

  it("parses, with one row per report the T6 sources list names and every row unverified", () => {
    expect(parsed.ok, parsed.ok ? "" : parsed.errors.join("\n")).toBe(true);
    expect(rows.map((r) => r.sourceId).sort()).toEqual(SCENARIO_SOURCES.map((s) => s.id).sort());
    for (const r of rows) {
      const source = SCENARIO_SOURCES.find((s) => s.id === r.sourceId)!;
      expect(r.reportUrl, r.sourceId).toBe(source.url);
      expect(r.organization, r.sourceId).toBe(source.org);
      expect(r.verifiedByHuman, r.sourceId).toBe(false);
      expect([r.verifiedBy, r.verifiedOn], r.sourceId).toEqual(["", ""]);
    }
  });

  it("reproduces the review's tallies: 6 of 11 give no total, 3 break down by area, 0 report reporter confirmation", () => {
    const yes = (k: (typeof BENCHMARK_ELEMENT_KEYS)[number]) => rows.filter((r) => r.elements[k] === "yes").length;
    expect(rows).toHaveLength(11);
    expect(rows.length - yes("total_count")).toBe(6);
    expect(yes("by_area")).toBe(3);
    expect(yes("reporters_confirmed_fixes")).toBe(0);
  });

  it("copies no figures from the reports: notes hold no digits except the date we read them", () => {
    for (const r of rows) expect(r.notes.replace(/October 20, 2026/g, ""), r.sourceId).not.toMatch(/\d/);
  });

  it("feeds no number while nothing is verified, so the card stays hidden", async () => {
    expect(benchmarkSummary(rows)).toBeNull();
    expect(await loadFeedbackBenchmark()).toBeNull();
  });
});

describe("parseCsv and parseBenchmarkCsv", () => {
  it("reads quoted fields with commas, doubled quotes and line breaks, LF or CRLF", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,"two\nlines",3\n')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "two\nlines", "3"],
    ]);
    expect(() => parseCsv('a,"open')).toThrow(/unterminated/);
  });

  it("refuses the whole file for a wrong header, a bad value, or a verified row that is not complete", () => {
    expect(parseBenchmarkCsv("source_id,organization\nx,y\n")).toMatchObject({ ok: false });
    const bad = CSV.replace(",yes,yes,partly,yes,yes,yes,no,", ",maybe,yes,partly,yes,yes,yes,no,");
    expect(parseBenchmarkCsv(bad)).toMatchObject({ ok: false, errors: [expect.stringMatching(/line 2: total_count must be yes, partly, no or unknown/)] });
    // bce-2025 has unknown values (we could not open it): marking it verified without filling them in is refused.
    const [header, ...rows] = parseCsv(CSV);
    const bce = rows.findIndex((r) => r[0] === "bce-2025");
    const half = rows.map((r, i) => (i === bce ? [...r.slice(0, -3), "true", "QA", "2026-10-21"] : r));
    const text = [header, ...half].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const res = parseBenchmarkCsv(text);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join("\n")).toMatch(/a verified row has no unknown values \(by_channel\)/);
    // ...and so is a verified row with no reviewer or date.
    const anon = rows.map((r) => (r[0] === "hc-2024" ? [...r.slice(0, -3), "true", "", "21/10/2026"] : r));
    const res2 = parseBenchmarkCsv([header, ...anon].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n"));
    expect(res2.ok).toBe(false);
    if (!res2.ok) expect(res2.errors).toEqual([expect.stringMatching(/needs verified_by/), expect.stringMatching(/needs verified_on/)]);
  });
});

describe("the published side: verified rows only", () => {
  it("scores a report by the elements it covers fully and takes the median over verified rows", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 6])).toBe(2.5);
    const parsed = parseBenchmarkCsv(withVerified({ "hc-2024": {}, "scotia-2025": {}, "ac-2025": {}, "wage-2024": {} }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const scores = Object.fromEntries(parsed.rows.filter((r) => r.verifiedByHuman).map((r) => [r.sourceId, rowScore(r)]));
    expect(scores).toEqual({ "hc-2024": 5, "scotia-2025": 5, "ac-2025": 0, "wage-2024": 1 }); // "partly" never counts
    const summary = benchmarkSummary(parsed.rows)!;
    expect(summary).toMatchObject({ reports: 4, median: 3 });
    expect(summary.covered).toMatchObject({ total_count: 3, by_area: 2, by_channel: 0, process_changes: 2, reporters_confirmed_fixes: 0 });
  });

  it("the loader reads a file, and hides the card (with one text-free warning) when the file is refused", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "al-bench-"));
    try {
      const good = path.join(dir, "good.csv");
      await writeFile(good, withVerified({ "rogers-2024": {} }));
      expect(await loadFeedbackBenchmark(good)).toMatchObject({ reports: 1, median: 2 });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const broken = path.join(dir, "broken.csv");
      await writeFile(broken, "not,a,benchmark\n");
      expect(await loadFeedbackBenchmark(broken)).toBeNull();
      expect(await loadFeedbackBenchmark(path.join(dir, "missing.csv"))).toBeNull();
      expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
      for (const call of warn.mock.calls) expect(String(call[0])).not.toMatch(/Health Canada|A table counts/);
      warn.mockRestore();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("what a draft covers (from its stored sentences)", () => {
  const casesOf = (list: Story[]): MetricCase[] => list.map((s) => s.case);
  function draft(stories: Story[], planAreas: ("ict" | "built_environment" | "transportation")[]) {
    const { snapshot } = snapshotFromCases(casesOf(stories), YEAR, NOW);
    const settings = reportSettings({ ...ORG, planAreas }, "http://localhost:3000/o/test-org/report");
    const claims = compileClaims(snapshot, settings);
    const sentences = chooseSentences(claims, null, validationContext(snapshot));
    return buildContent(settings, YEAR, claims, sentences, { ok: false, backend: null, model: null, promptSha: null, latencyMs: null });
  }

  it("a draft with a fixed case covers 6 of 7: AccessLoop never drafts changes to the feedback process", () => {
    const content = draft(
      [
        new Story(caseId(1), ref(1), "2026-02-01T15:00:00Z").triage(0, "ict", "The app's sign-in button had no label.").assign(1).fixWithRetest(10).verdict(14, "fixed"),
        new Story(caseId(2), ref(2), "2026-03-01T15:00:00Z", { channel: "email", anonymous: false }).ack(1, "email").triage(0, "ict", "A form timed out."),
      ],
      ["ict", "built_environment"],
    );
    const c = draftCoverage(content);
    expect(c).toEqual({
      total_count: true,
      by_area: true,
      by_channel: true,
      areas_without_feedback: true, // "Feedback received in this area: 0" for the built environment
      how_considered: true,
      process_changes: false,
      reporters_confirmed_fixes: true,
    });
  });

  it("with no fix logged yet, how feedback was considered is not covered", () => {
    const content = draft([new Story(caseId(1), ref(1), "2026-02-01T15:00:00Z").triage(0, "ict", "A form timed out.")], ["ict"]);
    expect(draftCoverage(content)).toMatchObject({ how_considered: false, process_changes: false, total_count: true });
  });
});

describe("the card", () => {
  const coverage = { total_count: true, by_area: true, by_channel: true, areas_without_feedback: true, how_considered: true, process_changes: false, reporters_confirmed_fixes: true };
  const summary = { reports: 4, median: 3, covered: { total_count: 3, by_area: 2, by_channel: 0, areas_without_feedback: 2, how_considered: 3, process_changes: 3, reporters_confirmed_fixes: 0 } };

  it("says 'Your draft covers N of 7 elements; published median is M', element by element, never as a region", () => {
    const out = html(createElement(FeedbackBenchmarkView, { coverage, summary, signedOff: false, lastSection: 4 }));
    expect(out).toContain(`<h2 id="feedback-benchmark-title"`);
    expect(out).toContain(BENCHMARK_CARD_TITLE);
    expect(out).toContain("Your draft covers 6 of 7 elements; published median is 3.");
    expect(out).toContain("4 published progress reports that a person on our team read and checked");
    expect(out).toContain("Changes to your feedback process");
    expect(out).toContain("Not in your draft");
    expect(out).toContain("AccessLoop does not draft this part.");
    expect(out).toContain("0 of 4 published");
    expect(out).not.toMatch(/<section|role="region"|aria-labelledby/); // the page keeps ONE region named "Feedback"
    expect(out).not.toMatch(/complian|certified|guarantee/i);
  });

  it("a signed-off report says 'Your report covers', and a half median shows one decimal", () => {
    expect(benchmarkHeadline(6, 7, 2.5, true)).toBe("Your report covers 6 of 7 elements; published median is 2.5.");
    const out = html(createElement(FeedbackBenchmarkView, { coverage, summary: { ...summary, reports: 1 }, signedOff: true, lastSection: 4 }));
    expect(out).toContain("Your report covers 6 of 7 elements");
    expect(out).toContain("1 published progress report that");
  });
});
