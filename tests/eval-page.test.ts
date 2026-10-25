// The lead's /app/eval view (app/(staff)/app/eval/EvalReport.tsx), rendered to static HTML for every state: no result,
// a simulated (fake) run, a claude-cli run, a holdout run, a run next to its zero-shot baseline, a measured run with
// repeats and a cost per report, a layer-1-only comparison and the small tables of other sets. Results come from real
// fake runs of the runner (eval/runner.ts) in a temp folder, then edited where a state needs a real backend; the
// measured run is a sample FILE written to a temp folder and read back through listEvalResults (never into
// eval/results). The page's e2e (axe in light and dark) is e2e/eval.spec.ts.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fixturesJson from "@/eval/fixtures/reports.json";
import {
  CLAUDE_CLI_NOTICE,
  EARLIER_RUN_NOTICE,
  EvalReport,
  HOLDOUT_HINT_NOTICE,
  INJECTION_CHECK_LABELS,
  LAYER1_ONLY_NOTICE,
  MEASURED_API_NOTICE,
  RUN_NOT_FOUND_NOTICE,
  SIMULATED_COST,
  SIMULATED_NOTICE,
  SUBSCRIPTION_COST,
  evalRunHref,
} from "@/app/(staff)/app/eval/EvalReport";
import { cli } from "@/eval/runner";
import { wilson } from "@/eval/score";
import { RATE_KEYS, repeatedRates } from "@/lib/eval/intervals";
import { callStats, ciRange, ciText, confusionAxes, NO_SEEDED_PII, piiHeadline, piiSentence, piiTypeRows, rangeText, tokenCell } from "@/lib/eval/present";
import {
  allRepeats,
  EvalResultSchema,
  INJECTION_CHECKS,
  listEvalResults,
  pickLatest,
  type EvalResult,
  type EvalResultsListing,
  type SavedEvalResult,
} from "@/lib/eval/results";
import { costPerReport, pricesFromEnv, summarizeCalls, usd, type PriceConfig } from "@/lib/eval/usage";
import { asSet, measuredSample, SAMPLE_PRICES } from "./support/eval-sample";

let root: string;
let fake: SavedEvalResult;
let fakeBaseline: SavedEvalResult;
let fakeLayer1: SavedEvalResult;

/** The page as HTML, with the entities React writes for ' " & turned back into characters. */
const html = (listing: EvalResultsListing, run: string | null = null, prices?: PriceConfig) =>
  renderToStaticMarkup(createElement(EvalReport, { listing, run, prices }))
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
const listingOf = (...results: SavedEvalResult[]): EvalResultsListing => ({ results, unreadable: [] });
/** The notice that says what kind of run is shown (simulated, claude-cli, measured with the api), up to the first card. */
function kindNotice(out: string): string {
  const i = out.indexOf('data-testid="eval-run-kind"');
  return i < 0 ? "" : out.slice(i, out.indexOf('id="eval-pii"', i));
}
/** The same saved result as if a real backend had produced it (the schema keeps `simulated` honest). */
function asBackend(s: SavedEvalResult, backend: "api" | "claude-cli", extra: Partial<EvalResult> = {}): SavedEvalResult {
  const result = EvalResultSchema.parse({ ...s.result, backend, simulated: false, ...extra });
  return { file: s.file.replace("-fake-", `-${backend}-`), result };
}
/** The same saved result as a holdout run saves it: scores, IDs and types only. */
function asHoldout(s: SavedEvalResult, extra: Partial<EvalResult> = {}): SavedEvalResult {
  const r = s.result;
  const result = EvalResultSchema.parse({
    ...r,
    set: "holdout",
    textOmitted: true,
    predictions: r.predictions.map(({ id, latencyMs, calls }) => ({ id, latencyMs, calls })),
    metrics: { ...r.metrics, pii: { ...r.metrics.pii, leaks: r.metrics.pii.leaks.map(({ id, type }) => ({ id, type })) } },
    ...extra,
  });
  return { file: s.file.replace("-fake-", "-fake-holdout-"), result };
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "al-eval-page-"));
  vi.stubEnv("FAKE_LLM", "1");
  vi.stubEnv("AI_BACKEND", "fake");
  const quiet = { resultsDir: root, stdout: () => {}, stderr: () => {} };
  expect(await cli([], { ...quiet, now: () => new Date("2026-10-19T14:00:00Z") })).toBe(0);
  expect(await cli(["--baseline"], { ...quiet, now: () => new Date("2026-10-19T13:00:00Z") })).toBe(0);
  expect(await cli(["--layer1-only"], { ...quiet, now: () => new Date("2026-10-19T12:00:00Z") })).toBe(0);
  const listing = await listEvalResults(root);
  fake = listing.results.find((r) => !r.result.baseline && !r.result.layer1Only)!;
  fakeBaseline = listing.results.find((r) => r.result.baseline)!;
  fakeLayer1 = listing.results.find((r) => r.result.layer1Only)!;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("/app/eval", () => {
  it('says "No eval run yet" when nothing is saved', () => {
    const out = html({ results: [], unreadable: [] });
    expect(out).toContain("No eval run yet");
    expect(out).toContain("npm run eval");
    expect(out.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(out).not.toContain("<table");
  });

  it("a fake run is prominently marked simulated, with accessible tables", () => {
    const out = html(listingOf(fake));
    expect(out).toContain(SIMULATED_NOTICE);
    expect(out).not.toContain(CLAUDE_CLI_NOTICE);
    expect(out.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(out).not.toMatch(/role="status"/); // the page has one, the global StatusRegion
    for (const caption of [
      "Removed before human review, by type",
      "Classification",
      "Confusion matrix",
      "Injection, abstention and errors",
      "Time, tokens and cost per test report",
      "Time and tokens per AI call",
      "Results per test report",
      "Run details",
      "Every saved eval run",
    ]) {
      expect(out).toMatch(new RegExp(`<caption[^>]*>.*?${caption.replace(/[()]/g, "\\$&")}`));
    }
    expect(out).toContain('scope="col"');
    expect(out).toContain('scope="row"');
    expect(out.match(/<caption/g)!.length).toBe(out.match(/<table/g)!.length);
  });

  it("phrases PII recall as eval/README.md asks, with the 95% Wilson interval, never \"0 missed\"", () => {
    const pii = fake.result.metrics.pii;
    const removed = pii.total - pii.leakedBeforeHuman;
    const sentence = `${removed} of ${pii.total} seeded items removed before human review (95% CI ${ciRange(pii.recall95ci)})`;
    expect(piiSentence(pii)).toBe(sentence);
    expect(html(listingOf(fake))).toContain(`${sentence}; every case then gets human review before any owner sees it.`);
    // A perfect run still gets the interval, never a "none missed" claim.
    const perfect = { ...pii, leakedBeforeHuman: 0, recallBeforeHuman: 1, recall95ci: wilson(pii.total, pii.total), leaks: [] };
    const out = html(listingOf({ ...fake, result: { ...fake.result, metrics: { ...fake.result.metrics, pii: perfect } } }));
    expect(out).toContain(`${pii.total} of ${pii.total} seeded items removed before human review (95% CI ${ciRange(wilson(pii.total, pii.total))})`);
    expect(out).not.toMatch(/0 missed|none missed|no leaks/i);
    expect(out).not.toContain("Items still in the text");
  });

  it("recall by type has its own Wilson interval per type", () => {
    const rows = piiTypeRows(fake.result.metrics.pii);
    const totals = Object.values(fake.result.metrics.pii.byType).reduce((s, t) => s + t.total, 0);
    expect(rows.reduce((s, r) => s + r.total, 0)).toBe(totals);
    for (const r of rows) expect(r.ci).toEqual(wilson(r.removed, r.total));
  });

  it("the confusion matrix lists expected areas as rows and the AI's answers as columns, abstain last", () => {
    const { rows, cols } = confusionAxes({ ict: { ict: 3, abstain: 1 }, employment: { ict: 1 } });
    expect(rows).toEqual(["employment", "ict"]);
    expect(cols).toEqual(["employment", "ict", "abstain"]);
  });

  it("pairs a run with its zero-shot baseline", () => {
    const out = html(listingOf(fake, fakeBaseline));
    expect(out).toContain("Zero-shot baseline");
    expect(out).toContain(`eval/results/${fakeBaseline.file}`);
    expect(out).not.toContain("No zero-shot baseline is saved");
    expect(html(listingOf(fake))).toContain("No zero-shot baseline is saved");
  });

  it("claude-cli: never published; api: neither notice", () => {
    const cliRun = asBackend(fake, "claude-cli", { cliVersion: "2.1.300" });
    const out = html(listingOf(cliRun));
    expect(out).toContain(CLAUDE_CLI_NOTICE);
    expect(out).not.toContain(SIMULATED_NOTICE);
    expect(out).toContain("2.1.300");
    const api = html(listingOf(asBackend(fake, "api")));
    expect(api).not.toContain(CLAUDE_CLI_NOTICE);
    expect(api).not.toContain(SIMULATED_NOTICE);
  });

  it("a holdout run shows scores only", () => {
    const out = html(listingOf(asHoldout(fake)));
    expect(out).toContain("Holdout set");
    expect(out).not.toContain("Results per test report");
    expect(out).not.toContain(HOLDOUT_HINT_NOTICE);
  });

  it("every other saved run is a link to its own view; the one shown says so", () => {
    const fakeOnly = listingOf(fake, fakeBaseline);
    const out = html(fakeOnly);
    expect(out).toContain(`href="${evalRunHref(fakeBaseline.file)}"`);
    expect(out).not.toContain(`href="${evalRunHref(fake.file)}"`); // shown above, not a link to itself
    expect(out).toContain("Shown above");
    expect(out).toContain("Open a file name to see that run.");
    expect(out).not.toContain(EARLIER_RUN_NOTICE);
    expect(out).not.toContain(RUN_NOT_FOUND_NOTICE);

    const picked = html(fakeOnly, fakeBaseline.file);
    expect(picked).toContain(EARLIER_RUN_NOTICE);
    expect(picked).toContain('href="/app/eval"');
    expect(picked).toContain(`eval/results/${fakeBaseline.file}`); // "About this run"
    expect(picked).toContain(`href="${evalRunHref(fake.file)}"`);
    expect(picked).not.toContain(`href="${evalRunHref(fakeBaseline.file)}"`);
  });

  it("a measured run is the default view even when simulated runs are newer; simulated runs are listed below it", () => {
    const older = asBackend(fake, "api", { timestamp: "2026-10-19T09:00:00.000Z" });
    const listing = listingOf(fake, fakeBaseline, older);
    expect(pickLatest(listing).main?.file).toBe(older.file);
    const out = html(listing);
    expect(kindNotice(out)).toContain(MEASURED_API_NOTICE);
    expect(kindNotice(out)).not.toContain(SIMULATED_NOTICE);
    expect(out).toContain(`eval/results/${older.file}`); // "About this run"
    expect(out).toContain("No zero-shot baseline is saved"); // the fake baseline is another backend's
    // "Saved runs": the measured run first, then every simulated run, each labelled.
    const table = out.slice(out.indexOf('id="eval-saved-table"'));
    expect(table.indexOf(older.file)).toBeLessThan(table.indexOf(fake.file));
    expect(table.indexOf(older.file)).toBeLessThan(table.indexOf(fakeBaseline.file));
    expect(table.split(SIMULATED_NOTICE).length - 1).toBe(2);
    expect(out).toContain("Measured runs first, then simulated ones");

    // Picking the newer fake run from the table: an earlier-run notice, labelled simulated, with a link back.
    const picked = html(listing, fake.file);
    expect(picked).toContain(EARLIER_RUN_NOTICE);
    expect(kindNotice(picked)).toContain(SIMULATED_NOTICE);
    expect(kindNotice(picked)).toContain(`href="${evalRunHref(older.file)}">show the latest measured run</a>`);
  });

  it("a link to a run that isn't saved says so and shows the latest", () => {
    const out = html(listingOf(fake), "2026-01-01-api-00000000.json");
    expect(out).toContain(RUN_NOT_FOUND_NOTICE);
    expect(out).toContain("so this is the latest run");
    expect(out).toContain(SIMULATED_NOTICE);
    expect(out).not.toContain("2026-01-01-api-00000000.json"); // the name from the link is never echoed
    expect(html(listingOf(), "x.json")).toContain("No eval run yet");
  });

  it("a visible-set run points to the latest holdout run, where the headline numbers come from", () => {
    const holdout = asHoldout(fake, { timestamp: "2026-10-19T08:00:00.000Z" });
    const out = html(listingOf(fake, holdout));
    expect(out).toContain(HOLDOUT_HINT_NOTICE);
    expect(out).toContain(`href="${evalRunHref(holdout.file)}">show the latest holdout run</a>`);
    const onHoldout = html(listingOf(fake, holdout), holdout.file);
    expect(onHoldout).not.toContain(HOLDOUT_HINT_NOTICE);
    expect(onHoldout).toContain(EARLIER_RUN_NOTICE);
    expect(onHoldout).not.toContain("Results per test report");
  });

  it("a baseline picked from the table does not claim no other run is saved", () => {
    const none = "No run with AccessLoop’s prompts is saved yet."; // &rsquo; in the page
    expect(html(listingOf(fakeBaseline))).toContain(none);
    const picked = html(listingOf(fake, fakeBaseline), fakeBaseline.file);
    expect(picked).toContain("This is a zero-shot baseline");
    expect(picked).not.toContain(none);
    expect(picked).not.toContain("No run with AccessLoop");
  });

  it("names files it can't read, without showing them", () => {
    const out = html({ results: [fake], unreadable: ["old-format.json"] });
    expect(out).toContain("old-format.json");
    expect(out).toContain("not shown");
  });

  it("AI calls: time per call for every run; tokens 'Not reported' for the fake backend", () => {
    const out = html(listingOf(fake));
    expect(out).toContain('id="eval-calls"');
    expect(out).toContain("Time and tokens per AI call");
    expect(out).toContain("Personal details (flagPii)");
    expect(out).toContain("Summary and area (structure)");
    expect(out).toContain("Not reported");
    expect(out).toContain("the simulated (fake) backend reports none");
    const rows = callStats(fake.result.predictions);
    expect(rows.map((r) => [r.fn, r.calls, r.withUsage])).toEqual([
      ["flagPii", fake.result.fixtureCount, 0],
      ["structure", fake.result.fixtureCount, 0],
    ]);
  });

  it("AI calls: an api run's reported tokens are summed per function, with p50/p95 latency and retries", () => {
    const n = fake.result.predictions.length;
    const api = asBackend(fake, "api", {
      predictions: fake.result.predictions.map((p, i) => ({
        ...p,
        calls: {
          flagPii: { model: "m-p", promptSha: "s", latencyMs: 1000 + i, usage: { inputTokens: 300, outputTokens: 10 }, attempts: i === 0 ? 2 : 1 },
          // one structure call without usage (e.g. saved by an older runner)
          structure: i === 1 ? { model: "m-s", promptSha: "s", latencyMs: 2000 } : { model: "m-s", promptSha: "s", latencyMs: 2000 + i, usage: { inputTokens: 800, outputTokens: 60 } },
        },
      })),
    });
    const [pii, structure] = callStats(api.result.predictions);
    expect(pii).toMatchObject({ calls: n, withUsage: n, inputTokens: 300 * n, outputTokens: 10 * n, retried: 1, p50: 1000 + Math.floor(n / 2) });
    expect(structure).toMatchObject({ calls: n, withUsage: n - 1, inputTokens: 800 * (n - 1), outputTokens: 60 * (n - 1), retried: 0 });
    expect(tokenCell(structure.inputTokens, structure.withUsage, structure.calls)).toBe(`${(800 * (n - 1)).toLocaleString("en-CA")} (from ${n - 1} of ${n} calls)`);
    const out = html(listingOf(api));
    expect(out).toContain((300 * n).toLocaleString("en-CA"));
    expect(out).toContain("1 call needed the one retry after the API said it was busy (HTTP 429 or 529).");
    expect(out).not.toContain("the simulated (fake) backend reports none");
  });

  it("never claims compliance", () => {
    const out = html(listingOf(fake, fakeBaseline));
    expect(out).not.toMatch(/compliant|certified|guarantee/i);
  });
});

// ---- Measured runs, intervals, cost, layer 1, other sets ----

const PRICES = SAMPLE_PRICES;
const FIXTURE_TEXTS = (fixturesJson as { text: string }[]).map((f) => f.text);

describe("/app/eval: a measured run (a sample file in a temp folder, never in eval/results)", () => {
  let listing: EvalResultsListing;
  let measured: SavedEvalResult;

  beforeAll(async () => {
    const dir = path.join(root, "measured");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "2026-10-20-api-d654e056.json"), JSON.stringify(measuredSample(fake.result)));
    await writeFile(path.join(dir, fake.file), JSON.stringify({ ...fake.result, timestamp: "2026-10-20T12:00:00.000Z" })); // newer, simulated
    listing = await listEvalResults(dir);
    measured = listing.results.find((s) => s.result.backend === "api")!;
  });

  it("is shown first, ahead of a newer simulated run", () => {
    expect(listing.unreadable).toEqual([]);
    expect(listing.results.map((s) => s.result.backend)).toEqual(["fake", "api"]); // newest first
    expect(pickLatest(listing).main?.file).toBe(measured.file);
    const out = html(listing, null, PRICES);
    expect(kindNotice(out)).toContain(MEASURED_API_NOTICE);
    expect(kindNotice(out)).not.toContain(SIMULATED_NOTICE);
    expect(out).toContain("AccessLoop prompts");
    expect(out).not.toContain("This simulated run");
    const table = out.slice(out.indexOf('id="eval-saved-table"'));
    expect(table.indexOf(measured.file)).toBeLessThan(table.indexOf(fake.file));
    expect(table).toContain(SIMULATED_NOTICE);
  });

  it("every rate has its 95% Wilson interval; repeats show the mean, one pass's interval and the range", () => {
    const repeats = allRepeats(measured.result).map((x) => x.metrics);
    const rates = repeatedRates(repeats);
    const out = html(listing, null, PRICES);
    for (const key of RATE_KEYS) {
      if (rates[key].rate === null) continue;
      expect(rates[key].ci).toEqual(wilson(rates[key].k, rates[key].n)); // one pass's width, not N passes pooled
      expect(out).toContain(ciText(rates[key]));
    }
    expect(out).toContain(piiHeadline(repeats));
    expect(out).toContain("Range across repeats");
    expect(rates.top1.min).toBeLessThan(rates.top1.max!); // the sample's second repeat got one more right
    expect(out).toContain(rangeText(rates.top1));
    expect(out).toContain("Not a rate"); // macro-F1 is not a proportion of reports
    expect(out).toMatch(/<caption[^>]*>.*?Each repeat/);
    for (const n of [1, 2, 3]) expect(out).toContain(`>Repeat ${n}</th>`);
    expect(out).toContain("repeat 1 of 3"); // the per-report table shows the first pass
  });

  it("shows time per report, tokens per report and the cost per report from the dated price constants", () => {
    const out = html(listing, null, PRICES);
    // Per report: haiku 400 in / 30 out at 0.1 / 0.5, sonnet 1000 in / 120 out at 2 / 10 (US$ per million tokens).
    const expected = (400 * 0.1 + 30 * 0.5 + 1000 * 2 + 120 * 10) / 1_000_000;
    const cost = costPerReport(allRepeats(measured.result).flatMap((x) => x.predictions), PRICES.ok ? PRICES.table : (null as never));
    expect(cost).toMatchObject({ ok: true, reports: 3 * fake.result.fixtureCount });
    expect(cost.ok && cost.usdPerReport).toBeCloseTo(expected, 12);
    expect(out).toContain(`${usd(expected)} at prices set on 2026-10-20`);
    expect(out).toContain("US$0.0033 at prices set on 2026-10-20");
    expect(out).toContain("Cost per 1,000 reports");
    expect(out).toContain(`>${usd((cost.ok ? cost.usdPerReport : 0) * 1000)}<`);
    expect(out).toContain(">1,400<"); // input tokens per report, mean
    expect(out).toContain(">150<"); // output tokens per report, mean
    const summary = summarizeCalls(allRepeats(measured.result).flatMap((x) => x.predictions));
    expect(out).toContain(`${(summary.report.p50Ms! / 1000).toFixed(1)} s`);
  });

  it("without price constants, or without a price for a model, says what is missing instead of guessing", () => {
    expect(html(listing)).toContain("Not shown: set AI_PRICES_USD_PER_MTOK and AI_PRICES_SET_ON");
    const onlySonnet = pricesFromEnv({ AI_PRICES_SET_ON: "2026-10-20", AI_PRICES_USD_PER_MTOK: "claude-sonnet-5-5=2/10" });
    expect(html(listing, null, onlySonnet)).toContain("has no price for claude-haiku-5-5");
    const badDate = pricesFromEnv({ AI_PRICES_SET_ON: "yesterday", AI_PRICES_USD_PER_MTOK: "claude-sonnet-5-5=2/10" });
    expect(html(listing, null, badDate)).toContain("Not shown: AI_PRICES_SET_ON must be the date");
    expect(html(listing, null, badDate)).not.toContain("Cost per 1,000 reports");
  });

  it("claude-cli: subscription, no per-call cost; fake: simulated, no cost, and how to measure", () => {
    const cliRun = { file: "2026-10-20-claude-cli-d654e056.json", result: measuredSample(fake.result, "claude-cli") };
    const out = html(listingOf(cliRun), null, PRICES);
    expect(out).toContain(SUBSCRIPTION_COST);
    expect(kindNotice(out)).toContain(CLAUDE_CLI_NOTICE);
    expect(out).not.toContain("US$");
    const f = html(listingOf(fake), null, PRICES);
    expect(f).toContain(SIMULATED_COST);
    expect(f).toContain("Simulated run: ");
    expect(f).toContain("This simulated run");
    expect(kindNotice(f)).toContain(SIMULATED_NOTICE);
    expect(kindNotice(f)).toContain("No measured run is saved yet.");
    expect(kindNotice(f)).toContain("npm run eval -- --backend claude-cli --repeats 3");
  });

  it("never shows report text: no summaries, no masked text, no fixture words", () => {
    const out = html(listing, null, PRICES);
    for (const p of allRepeats(measured.result).flatMap((x) => x.predictions)) {
      if (p.summary && p.summary.length > 12) expect(out).not.toContain(p.summary);
      if (p.redactedBeforeHuman) expect(out).not.toContain(p.redactedBeforeHuman.slice(0, 40));
    }
    for (const text of FIXTURE_TEXTS) expect(out).not.toContain(text.slice(0, 40));
    expect(out).not.toMatch(/compliant|certified|guarantee/i);
  });
});

describe("/app/eval: layer 1 alone, and other sets", () => {
  it("puts a layer-1-only run's numbers next to the full pipeline's; the layer-1 run itself says so", () => {
    expect(fakeLayer1.file).toMatch(/-fake-layer1-[0-9a-f]{8}\.json$/);
    const listing = listingOf(fake, fakeLayer1);
    expect(pickLatest(listing).main?.file).toBe(fake.file); // a layer-1-only run is never the default view
    const out = html(listing);
    expect(out).toMatch(/<caption[^>]*>.*?Layer 1 alone, and with the AI pass/);
    expect(out).toContain("With the simulated AI pass");
    expect(out).toContain(`eval/results/${fakeLayer1.file}`);
    expect(out).not.toContain(LAYER1_ONLY_NOTICE);
    expect(html(listingOf(fake))).toContain("npm run eval -- --layer1-only");

    const own = html(listing, fakeLayer1.file);
    expect(own).toContain(LAYER1_ONLY_NOTICE);
    expect(own).not.toContain("Layer 1 alone, and with the AI pass");
    expect(own).not.toContain("npm run eval -- --layer1-only");
    // The fake AI pass only adds to layer 1, so layer 1 alone never removes more.
    expect(fakeLayer1.result.metrics.pii.leakedBeforeHuman).toBeGreaterThanOrEqual(fake.result.metrics.pii.leakedBeforeHuman);
  });

  it("runs of other sets (injection, silver) get their own small tables; the main view stays on the visible set", () => {
    const injection = asSet(asBackend(fake, "api", { timestamp: "2026-10-20T10:00:00.000Z" }), "injection");
    const injectionFake = asSet({ ...fake, result: { ...fake.result, timestamp: "2026-10-20T11:00:00.000Z" } }, "injection");
    const silver = asSet(fake, "silver");
    const listing = listingOf(injectionFake, injection, fake, silver);
    expect(pickLatest(listing).main?.file).toBe(fake.file);
    const out = html(listing);
    expect(kindNotice(out)).toContain("No measured run of the visible or holdout set is saved yet.");
    expect(out).toContain('id="eval-set-injection"');
    expect(out).toContain('id="eval-set-silver"');
    expect(out).toMatch(/<caption[^>]*>.*?Injection set: latest measured run/);
    expect(out).toMatch(/<caption[^>]*>.*?Injection set: latest simulated run/);
    expect(out).toMatch(/<caption[^>]*>.*?Silver set \(published reports\): latest simulated run/);
    expect(out).toContain("No measured run of this set is saved yet.");
    expect(out).toContain(`href="${evalRunHref(injection.file)}">Open this measured run`);
    const rates = repeatedRates([injection.result.metrics]);
    expect(out).toContain(ciText(rates.injectionResisted));
    expect(out.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(out.match(/<caption/g)!.length).toBe(out.match(/<table/g)!.length);
  });

  it("an injection-suite run from the runner shows its strict checks (eval/injection.ts) as counts only", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "al-eval-injection-"));
    try {
      const quiet = { resultsDir: dir, stdout: () => {}, stderr: () => {} };
      expect(await cli(["--set", "injection"], { ...quiet, now: () => new Date("2026-10-19T11:00:00Z") })).toBe(0);
      const saved = await listEvalResults(dir);
      expect(saved.unreadable).toEqual([]);
      const injection = saved.results.find((r) => r.result.set === "injection")!;
      const checks = injection.result.injectionChecks!;
      expect(checks.n).toBe(injection.result.fixtureCount);
      // The merged runner keeps T1c's fields on an injection run too.
      expect(injection.result.callSummary).toBeDefined();
      const listing = listingOf(injection, fake);
      expect(pickLatest(listing).main?.file).toBe(fake.file);
      const out = html(listing);
      expect(out).toMatch(/<caption[^>]*>.*?Injection set: strict checks, latest simulated run/);
      const cell = (label: string, value: string) => new RegExp(`${label.replace(/[()]/g, "\\$&")}</th><td[^>]*>${value}</td>`);
      expect(out).toMatch(cell("Every check (resisted)", `${checks.resisted} of ${checks.n}`));
      for (const c of INJECTION_CHECKS) {
        expect(out).toMatch(cell(INJECTION_CHECK_LABELS[c], `${checks.n - checks.byCheck[c].failed} of ${checks.n}`));
      }
      // IDs and check names stay in the file; the page shows counts, never a failing case's text.
      for (const failure of checks.failures) expect(out).not.toContain(`>${failure.id}<`);
      expect(out.match(/<caption/g)!.length).toBe(out.match(/<table/g)!.length);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("/app/eval: T1c gate", () => {
  it("an api run leads over a newer claude-cli run; a simulated run links to the api run", () => {
    const api = asBackend(fake, "api", { timestamp: "2026-10-19T08:00:00.000Z" });
    const cliRun = { ...asBackend(fake, "claude-cli", { timestamp: "2026-10-19T09:00:00.000Z", cliVersion: "2.1.299" }), file: "2026-10-19-claude-cli-d654e056.json" };
    const listing = listingOf(fake, cliRun, api); // newest first
    const out = html(listing);
    expect(kindNotice(out)).toContain(MEASURED_API_NOTICE);
    expect(kindNotice(out)).not.toContain(CLAUDE_CLI_NOTICE);
    const table = out.slice(out.indexOf('id="eval-saved-table"'));
    expect(table.indexOf(api.file)).toBeLessThan(table.indexOf(cliRun.file));
    expect(table.indexOf(cliRun.file)).toBeLessThan(table.indexOf(fake.file));
    expect(out).toContain("Anthropic API runs come before claude-cli runs");
    // The newer claude-cli run is still one click away, and says what it is.
    const picked = html(listing, cliRun.file);
    expect(picked).toContain(EARLIER_RUN_NOTICE);
    expect(kindNotice(picked)).toContain(CLAUDE_CLI_NOTICE);
    // A simulated run opened from the table points to the api run, not the newer claude-cli one.
    expect(kindNotice(html(listing, fake.file))).toContain(`href="${evalRunHref(api.file)}">show the latest measured run</a>`);
  });

  it("a set with no seeded personal details (the silver set) says so instead of 0 of 0", () => {
    const m = fake.result.metrics;
    const none = { ...m, pii: { total: 0, leakedBeforeHuman: 0, recallBeforeHuman: 1, recall95ci: [0, 1] as [number, number], byType: {}, leaks: [], overRedacted: { checked: 0, wronglyRemoved: 0 } } };
    const silver = asSet({ ...fake, result: { ...fake.result, metrics: none } }, "silver");
    expect(piiHeadline([none])).toBe(NO_SEEDED_PII);
    const out = html(listingOf(fake, silver), silver.file);
    expect(out).toContain(`${NO_SEEDED_PII}. In the product, every case still gets human review before any owner sees it.`);
    expect(out).not.toMatch(/0 of 0 seeded/);
    expect(out).not.toContain("Removed before human review, by type");
    expect(out).not.toContain("npm run eval -- --layer1-only");
    expect(out.match(/<caption/g)!.length).toBe(out.match(/<table/g)!.length);
  });

  it("About this run names the layer-1 patterns a new run used", () => {
    expect(fake.result.layer1Sha).toMatch(/^[0-9a-f]{64}$/);
    const out = html(listingOf(fake));
    expect(out).toContain("Layer-1 patterns");
    expect(out).toContain(`>${fake.result.layer1Sha!.slice(0, 8)}</code>`);
    expect(out).toContain("lib/redaction/patterns.ts");
  });
});
