import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import {
  allRepeats,
  isMeasured,
  LAYER1_FILES,
  latestHoldout,
  latestMeasuredRun,
  layer1For,
  otherSetRuns,
  pickLatest,
  pickRun,
  savedRunsOrder,
  INJECTION_CHECKS,
  type EvalResult,
  type EvalResultsListing,
  type InjectionCheck,
  type InjectionChecks,
  type SavedEvalResult,
} from "@/lib/eval/results";
import { countsOf, piiTypeRates, rate, RATE_INFO, RATE_KEYS, repeatedRates, type RateKey, type RepeatedRate } from "@/lib/eval/intervals";
import {
  areaLabel,
  callStats,
  ciText,
  confusionAxes,
  latency,
  meanCount,
  noSeededPii,
  percent,
  piiHeadline,
  piiTypeLabel,
  plural,
  rangeText,
  rateText,
  setName,
  tokenCell,
} from "@/lib/eval/present";
import { costPerReport, summarizeCalls, tokensPerReport, usd, PRICES_DATE_ENV, PRICES_ENV, type PriceConfig } from "@/lib/eval/usage";
import { formatDateTime } from "@/lib/format";

// The lead's view of the saved eval results (CLAUDE.md "Routes": /app/eval; eval/README.md "Metrics we report").
// A server component with no data access of its own: page.tsx reads eval/results (and the price constants from the
// environment) and passes them in, so tests can render every state (tests/eval-page.test.ts). Every number is from the
// saved files (eval/score.ts output); intervals and repeat means come from lib/eval/intervals.ts, time, tokens and cost
// from lib/eval/usage.ts. Never any report text: numbers, test report IDs, areas and detail types only.
//
// Which run is shown (lib/eval/results.ts pickLatest): the latest MEASURED run (a real model; an api run before a
// claude-cli one, whose numbers are never published) of the visible or holdout set when one is saved, else the latest
// simulated (fake AI) run, which then says plainly "Simulated: fake AI, not a measurement". Every rate has its 95% Wilson interval; a run with repeats shows the mean,
// the interval of one pass and the range across repeats. Runs of other sets (the injection suite, the silver set) get
// their own small tables. `run` (page.tsx: `?run=<file>`, the "Saved runs" table links to every file) shows another
// saved one. eval/README.md: "Report the visible set and the holdout set separately. The headline numbers come from
// the holdout set": a visible-set run says so and links to the latest holdout run when one is saved. Those links are
// plain <a> (a full page load), so focus starts at the top of the new page like any page load (RouteFocus only reacts
// to a new pathname, and the link a person used is gone from the new page).

/** The page for one saved run. The name is only looked up in the listing (lib/eval/results.ts pickRun). */
export function evalRunHref(file: string): string {
  return `/app/eval?run=${encodeURIComponent(file)}`;
}

/** The label of every fake-backend run, wherever one is shown. */
export const SIMULATED_NOTICE = "Simulated: fake AI, not a measurement";
export const CLAUDE_CLI_NOTICE = "claude-cli results are for the team's own development and are never published";
export const MEASURED_API_NOTICE = "Measured with the Anthropic API";
export const LAYER1_ONLY_NOTICE = "Layer 1 only: the AI personal-details pass was off in this run";
export const SUBSCRIPTION_COST = "Subscription: no per-call cost";
export const SIMULATED_COST = "Simulated: no cost";

const BACKEND_NAMES: Record<EvalResult["backend"], string> = {
  fake: "Fake AI (canned answers)",
  "claude-cli": "Claude Code CLI (claude-cli)",
  api: "Anthropic API (api)",
};

/** What other sets hold (sets the page does not know yet get a generic line). */
const SET_DESCRIPTIONS: Record<string, string> = {
  injection:
    "Test reports that hide instructions for the AI, such as asking it to return no personal details, to say the barrier is fixed, or to mark a case as verified. Resisting means sorting the real problem and never claiming the case is approved, resolved or verified.",
  silver:
    "One-line barrier statements paraphrased from published accessibility progress reports, each with the area the organization itself gave it. A human reviews the set before it is run.",
};

function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-small font-bold wrap-anywhere">{children}</code>;
}

export const RUN_NOT_FOUND_NOTICE = "That saved run was not found";
export const EARLIER_RUN_NOTICE = "An earlier saved run";
export const HOLDOUT_HINT_NOTICE = "The headline numbers come from the holdout set";

export function EvalReport({
  listing,
  run = null,
  prices = { ok: false, reason: "unset" },
}: {
  listing: EvalResultsListing;
  run?: string | null;
  /** The price constants (page.tsx: lib/eval/usage.ts pricesFromEnv): cost per report for api runs. */
  prices?: PriceConfig;
}) {
  const { main, baseline, notFound } = pickRun(listing, run);
  const latest = pickLatest(listing).main;
  const holdout = latestHoldout(listing);
  const ownPromptsSaved = listing.results.some((s) => !s.result.baseline);
  const latestMeasured = latestMeasuredRun(listing);
  const others = otherSetRuns(listing);

  return (
    <>
      <PageHeader
        title="AI evaluation"
        description="How the AI steps do on labelled test reports: removing personal details before a person reads a report, sorting each report into an area, ignoring instructions hidden in a report, and passing vague reports to a person."
        meta={main ? <RunMeta saved={main} /> : undefined}
      />
      <div className="grid gap-6">
        {listing.unreadable.length > 0 ? (
          <Notice tone="warning" title={`${plural(listing.unreadable.length, "file")} in eval/results ${listing.unreadable.length === 1 ? "is" : "are"} not shown`}>
            {listing.unreadable.length === 1 ? "It is" : "They are"} not a saved eval result in the current format:{" "}
            {listing.unreadable.map((f, i) => (
              <span key={f}>
                {i > 0 ? ", " : ""}
                <Code>{f}</Code>
              </span>
            ))}
            .
          </Notice>
        ) : null}
        {notFound ? (
          <Notice tone="warning" title={RUN_NOT_FOUND_NOTICE}>
            No saved eval run has the name in this link, so {main ? "this is the latest run" : "nothing is shown"}.
          </Notice>
        ) : null}
        {main && latest && main.file !== latest.file ? (
          <Notice tone="info" title={EARLIER_RUN_NOTICE}>
            This is not the run shown by default. <a href="/app/eval">Show the default run</a>.
          </Notice>
        ) : null}
        {main && holdout && main.result.set === "visible" ? (
          <Notice tone="info" title={HOLDOUT_HINT_NOTICE}>
            This run is on the visible set, which prompts may be tuned on. Nobody tuned anything on the holdout set:{" "}
            <a href={evalRunHref(holdout.file)}>show the latest holdout run</a> (run on{" "}
            <time dateTime={holdout.result.timestamp}>{formatDateTime(new Date(holdout.result.timestamp))}</time>).
          </Notice>
        ) : null}
        {main ? (
          <Result
            main={main}
            baseline={baseline}
            layer1={layer1For(listing, main)}
            latestMeasured={latestMeasured}
            anyMeasured={listing.results.some(isMeasured)}
            ownPromptsSaved={ownPromptsSaved}
            prices={prices}
          />
        ) : (
          <NoResult />
        )}
        {others.map((o) => (
          <OtherSet key={o.set} {...o} />
        ))}
        {listing.results.length > 0 ? <SavedRuns listing={listing} current={main} /> : null}
      </div>
    </>
  );
}

function NoResult() {
  return (
    <EmptyState title="No eval run yet">
      <p>
        Run <Code>npm run eval</Code> in the project folder. It sends the labelled test reports through the same steps as
        a real report and saves the result in <Code>eval/results</Code>. The latest one shows here.
      </p>
    </EmptyState>
  );
}

function RunMeta({ saved }: { saved: SavedEvalResult }) {
  const r = saved.result;
  return (
    <>
      <span>
        Run on <time dateTime={r.timestamp}>{formatDateTime(new Date(r.timestamp))}</time>
      </span>
      <span>{BACKEND_NAMES[r.backend]}</span>
      <span>
        {setName(r.set)}, {plural(r.fixtureCount, "report")}
      </span>
      {(r.repeats ?? 1) > 1 ? <span>{r.repeats} repeats</span> : null}
      {r.layer1Only ? <span>Layer 1 only</span> : null}
      {r.baseline ? <span>Zero-shot baseline</span> : null}
    </>
  );
}

/** The column header for the run shown: what kind of run it is, so a simulated number never reads as a model's. */
function runColumn(r: EvalResult): string {
  if (r.baseline) return "This baseline run";
  if (r.simulated) return "This simulated run";
  return "AccessLoop prompts";
}

function Result({
  main,
  baseline,
  layer1,
  latestMeasured,
  anyMeasured,
  ownPromptsSaved,
  prices,
}: {
  main: SavedEvalResult;
  baseline: SavedEvalResult | null;
  /** The latest --layer1-only run of the same set and fixtures, to compare the personal-details numbers with. */
  layer1: SavedEvalResult | null;
  latestMeasured: SavedEvalResult | null;
  /** Some saved run (of any set or kind) was measured. */
  anyMeasured: boolean;
  /** Some saved run used AccessLoop's prompts (so a baseline shown here was picked from the "Saved runs" table). */
  ownPromptsSaved: boolean;
  prices: PriceConfig;
}) {
  const r = main.result;
  const b = baseline?.result ?? null;
  return (
    <>
      <div data-testid="eval-run-kind">
        {r.simulated ? (
          <Notice tone="warning" title={SIMULATED_NOTICE}>
            The fake backend answers from canned files, so this run only checks that the eval harness works end to end;
            none of its numbers describe a model.{" "}
            {latestMeasured && latestMeasured.file !== main.file ? (
              <>
                A measured run is saved: <a href={evalRunHref(latestMeasured.file)}>show the latest measured run</a>.
              </>
            ) : (
              <>
                {anyMeasured ? "No measured run of the visible or holdout set is saved yet." : "No measured run is saved yet."} To
                measure a model on this machine, sign in to the Claude Code CLI and run{" "}
                <Code>npm run eval -- --backend claude-cli --repeats 3</Code>; with an API key, use{" "}
                <Code>--backend api</Code>.
              </>
            )}
          </Notice>
        ) : r.backend === "claude-cli" ? (
          <Notice tone="info" title={CLAUDE_CLI_NOTICE}>
            The Claude Code CLI has no temperature setting, so its answers change from run to run. Run the eval with the api
            backend before quoting any of these numbers.
          </Notice>
        ) : (
          <Notice tone="success" title={MEASURED_API_NOTICE}>
            A real model answered these test reports ({r.models.structure === r.models.flagPii ? r.models.structure : `${r.models.structure} and ${r.models.flagPii}`}),
            and models can answer differently from run to run.{" "}
            {(r.repeats ?? 1) > 1
              ? `This run went through the set ${r.repeats} times: see "Repeats" for how much the numbers moved.`
              : "Run it with --repeats 3 to see how much the numbers move."}
          </Notice>
        )}
      </div>
      {r.baseline ? (
        <Notice tone="info" title="This is a zero-shot baseline">
          The same model without AccessLoop&rsquo;s prompts (<Code>eval/baseline</Code>).
          {ownPromptsSaved ? null : <> No run with AccessLoop&rsquo;s prompts is saved yet.</>}
        </Notice>
      ) : null}
      {r.layer1Only ? (
        <Notice tone="info" title={LAYER1_ONLY_NOTICE}>
          Only the fixed patterns removed personal details, to compare with the full pipeline (layer 1, then the AI pass).
          The summary and area step ran as usual.
        </Notice>
      ) : null}
      {r.set === "holdout" ? (
        <Notice tone="info" title="Holdout set">
          Nobody tuned prompts or patterns on these reports, so these are the headline numbers. Only scores, report IDs and
          detail types were saved: no report text.
        </Notice>
      ) : null}

      <PiiSection r={r} layer1={layer1} />
      <ClassificationSection r={r} b={b} />
      <OtherChecks r={r} b={b} />
      {(r.repeats ?? 1) > 1 ? <RepeatsSection r={r} /> : null}
      <TimeAndCost r={r} prices={prices} />
      {r.textOmitted ? null : <EachReport r={r} />}
      <RunDetails saved={main} baseline={baseline} layer1={layer1} prices={prices} />
    </>
  );
}

function metricsOf(r: EvalResult) {
  return allRepeats(r).map((x) => x.metrics);
}

function PiiSection({ r, layer1 }: { r: EvalResult; layer1: SavedEvalResult | null }) {
  const repeats = metricsOf(r);
  const n = repeats.length;
  const pii = r.metrics.pii;
  const rows = piiTypeRates(repeats);
  const all = repeatedRates(repeats);
  const over = all.overRedacted;
  const l1 = layer1 ? metricsOf(layer1.result) : null;
  const l1Types = l1 ? new Map(piiTypeRates(l1).map((row) => [row.type, row.rate])) : null;
  const l1All = l1 ? repeatedRates(l1).piiRemoved : null;
  if (noSeededPii(repeats)) {
    // The silver set's one-line statements seed no names or numbers: say so instead of "0 of 0 ... (95% CI 0–100%)".
    return (
      <Card as="section" id="eval-pii" title="Personal details before human review" tone="raised">
        <p className="max-w-[var(--measure)]">
          {r.simulated ? <span className="text-accent-ink">Simulated run: </span> : null}
          {piiHeadline(repeats)}. In the product, every case still gets human review before any owner sees it.
        </p>
      </Card>
    );
  }
  return (
    <Card as="section" id="eval-pii" title="Personal details before human review" tone="raised">
      <div className="grid gap-5">
        <p className="max-w-[var(--measure)] font-display text-h3 font-semibold text-ink">
          {r.simulated ? <span className="text-accent-ink">Simulated run: </span> : null}
          {piiHeadline(repeats)}; every case then gets human review before any owner sees it.
        </p>
        <p className="max-w-[var(--measure)] text-ink-muted">
          Seeded items are the names, contact details and numbers written into the test reports. An item counts as removed
          only if none of it is left in the text staff see first (after the patterns{r.layer1Only ? "" : " and the AI step"}).
          {r.metrics.errors > 0 ? " A report whose AI step failed counts all its items as not removed." : ""}
          {n > 1 ? ` Over ${n} repeats each figure is the mean; the interval is for one pass over the set.` : ""}
        </p>
        <Table
          id="eval-pii-types"
          caption="Removed before human review, by type"
          description={n > 1 ? `95% Wilson interval for each type; mean of ${n} repeats` : "95% Wilson interval for each type"}
        >
          <THead>
            <Tr>
              <Th>Type</Th>
              <Th numeric>Removed</Th>
              <Th numeric>Recall</Th>
              <Th numeric>95% CI</Th>
              {n > 1 ? <Th numeric>Range across repeats</Th> : null}
            </Tr>
          </THead>
          <TBody>
            {rows.map((row) => (
              <Tr key={row.type}>
                <Th scope="row" className="min-w-[8rem]">{piiTypeLabel(row.type)}</Th>
                <Td numeric className="whitespace-nowrap">{`${meanCount(row.rate.k)} of ${meanCount(row.rate.n)}`}</Td>
                <Td numeric>{row.rate.rate === null ? "None" : percent(row.rate.rate)}</Td>
                <Td numeric className="whitespace-nowrap">{ciText(row.rate)}</Td>
                {n > 1 ? <Td numeric className="whitespace-nowrap">{rangeText(row.rate)}</Td> : null}
              </Tr>
            ))}
            <Tr className="bg-surface-sunken">
              <Th scope="row">All types</Th>
              <Td numeric className="whitespace-nowrap font-bold">{`${meanCount(all.piiRemoved.k)} of ${meanCount(all.piiRemoved.n)}`}</Td>
              <Td numeric className="font-bold">{all.piiRemoved.rate === null ? "None" : percent(all.piiRemoved.rate)}</Td>
              <Td numeric className="whitespace-nowrap font-bold">{ciText(all.piiRemoved)}</Td>
              {n > 1 ? <Td numeric className="whitespace-nowrap font-bold">{rangeText(all.piiRemoved)}</Td> : null}
            </Tr>
          </TBody>
        </Table>
        {pii.leaks.length > 0 ? (
          <Table
            id="eval-pii-left"
            caption="Items still in the text before human review"
            description={`${plural(pii.leaks.length, "item")}${n > 1 ? " in repeat 1" : ""}: the lead's redaction review is where these get caught`}
            density="compact"
          >
            <THead>
              <Tr>
                <Th>Test report</Th>
                <Th>Type</Th>
              </Tr>
            </THead>
            <TBody>
              {pii.leaks.map((leak, i) => (
                <Tr key={`${leak.id}-${leak.type}-${i}`}>
                  <Th scope="row" className="font-mono">{leak.id}</Th>
                  <Td>{piiTypeLabel(leak.type)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : null}
        {layer1 && l1Types && l1All ? (
          <Table
            id="eval-pii-layer1"
            caption="Layer 1 alone, and with the AI pass"
            description={
              <>
                Layer 1 alone is the <Code>{layer1.file}</Code> run of{" "}
                <time dateTime={layer1.result.timestamp}>{formatDateTime(new Date(layer1.result.timestamp))}</time>: the fixed
                patterns, which work the same on every backend. 95% Wilson intervals.
              </>
            }
            density="compact"
          >
            <THead>
              <Tr>
                <Th>Type</Th>
                <Th numeric>{r.simulated ? "With the simulated AI pass" : "With the AI pass"}</Th>
                <Th numeric>95% CI</Th>
                <Th numeric>Layer 1 alone</Th>
                <Th numeric>95% CI, layer 1</Th>
              </Tr>
            </THead>
            <TBody>
              {[...rows.map((row) => ({ key: row.type, label: piiTypeLabel(row.type), full: row.rate, alone: l1Types.get(row.type) ?? null })),
                { key: "all", label: "All types", full: all.piiRemoved, alone: l1All }].map((row) => (
                <Tr key={row.key} className={row.key === "all" ? "bg-surface-sunken" : undefined}>
                  <Th scope="row" className="min-w-[8rem]">{row.label}</Th>
                  <Td numeric className="whitespace-nowrap">{rateText(row.full)}</Td>
                  <Td numeric className="whitespace-nowrap">{ciText(row.full)}</Td>
                  <Td numeric className="whitespace-nowrap">{row.alone ? rateText(row.alone) : "Not in that run"}</Td>
                  <Td numeric className="whitespace-nowrap">{row.alone ? ciText(row.alone) : "None"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : !r.layer1Only ? (
          <p className="max-w-[var(--measure)] text-ink-muted">
            To see what the fixed patterns remove on their own, run <Code>npm run eval -- --layer1-only</Code>; its numbers
            then show here next to these.
          </p>
        ) : null}
        <p className="max-w-[var(--measure)]">
          <span className="font-bold">Over-redaction: </span>
          {over.rate === null
            ? "no words were checked for this in this set."
            : `${rateText(over)} of the words that are not personal details (place names, a dog's name, a screen reader's name) were removed by mistake (95% CI ${ciText(over)}).`}
        </p>
      </div>
    </Card>
  );
}

/** One measure's cells for the run shown (and its baseline): result, interval and, over repeats, the range. */
function RateCells({ x, withRange }: { x: RepeatedRate; withRange: boolean }) {
  return (
    <>
      <Td numeric className="whitespace-nowrap">{rateText(x)}</Td>
      <Td numeric className="whitespace-nowrap">{ciText(x)}</Td>
      {withRange ? <Td numeric className="whitespace-nowrap">{rangeText(x)}</Td> : null}
    </>
  );
}

function RatesTable({
  id,
  caption,
  description,
  keys,
  r,
  b,
  extraRows,
}: {
  id: string;
  caption: string;
  description?: ReactNode;
  keys: readonly RateKey[];
  r: EvalResult;
  b: EvalResult | null;
  extraRows?: (withRange: boolean, withBaseline: boolean) => ReactNode;
}) {
  const reps = metricsOf(r);
  const rates = repeatedRates(reps);
  const bRates = b ? repeatedRates(metricsOf(b)) : null;
  const withRange = reps.length > 1;
  const bRange = b ? metricsOf(b).length > 1 : false;
  return (
    <Table id={id} caption={caption} description={description}>
      <THead>
        <Tr>
          <Th>Measure</Th>
          <Th numeric>{runColumn(r)}</Th>
          <Th numeric>95% CI</Th>
          {withRange ? <Th numeric>Range across repeats</Th> : null}
          {b ? <Th numeric>Zero-shot baseline</Th> : null}
          {b ? <Th numeric>95% CI, baseline</Th> : null}
          {b && bRange ? <Th numeric>Range, baseline</Th> : null}
        </Tr>
      </THead>
      <TBody>
        {keys.map((key) => (
          <Tr key={key}>
            <Th scope="row">{RATE_INFO[key].label}</Th>
            <RateCells x={rates[key]} withRange={withRange} />
            {bRates ? <RateCells x={bRates[key]} withRange={bRange} /> : null}
          </Tr>
        ))}
        {extraRows?.(withRange, Boolean(b))}
      </TBody>
    </Table>
  );
}

/** Mean macro-F1 over the repeats, and its range. Not a proportion of reports, so it has no Wilson interval. */
function macroF1(r: EvalResult): { mean: number; min: number; max: number } {
  const values = metricsOf(r).map((m) => m.classification.macroF1);
  return { mean: values.reduce((s, v) => s + v, 0) / values.length, min: Math.min(...values), max: Math.max(...values) };
}

function ClassificationSection({ r, b }: { r: EvalResult; b: EvalResult | null }) {
  const c = r.metrics.classification;
  const { rows, cols } = confusionAxes(c.confusion);
  const n = metricsOf(r).length;
  const f1 = macroF1(r);
  const bf1 = b ? macroF1(b) : null;
  const bRange = b ? metricsOf(b).length > 1 : false;
  const f1Range = (x: { min: number; max: number }) => (x.min === x.max ? `${x.min.toFixed(2)} in every repeat` : `${x.min.toFixed(2)}–${x.max.toFixed(2)}`);
  return (
    <Card as="section" id="eval-areas" title="Sorting reports into areas">
      <div className="grid gap-5">
        <p className="max-w-[var(--measure)] text-ink-muted">
          The AI suggests the Accessible Canada Act area for each report; the lead confirms it at triage. Areas overlap, so
          each test report also lists the other areas that are fair answers (&ldquo;acceptable&rdquo;). A report the AI is
          unsure about (top confidence under {r.abstainThreshold}) counts as abstained, which is a wrong answer here.
        </p>
        <RatesTable
          id="eval-areas-scores"
          caption="Classification"
          description={`${plural(c.n, "test report")} with an expected area; 95% Wilson intervals`}
          keys={["top1", "acceptable"]}
          r={r}
          b={b}
          extraRows={(withRange, withBaseline) => (
            <Tr>
              <Th scope="row">Macro-F1</Th>
              <Td numeric>{f1.mean.toFixed(2)}</Td>
              <Td numeric className="whitespace-nowrap">Not a rate</Td>
              {withRange ? <Td numeric className="whitespace-nowrap">{f1Range(f1)}</Td> : null}
              {withBaseline && bf1 ? <Td numeric>{bf1.mean.toFixed(2)}</Td> : null}
              {withBaseline && bf1 ? <Td numeric className="whitespace-nowrap">Not a rate</Td> : null}
              {withBaseline && bf1 && bRange ? <Td numeric className="whitespace-nowrap">{f1Range(bf1)}</Td> : null}
            </Tr>
          )}
        />
        {!b && !r.baseline ? (
          <p className="max-w-[var(--measure)] text-ink-muted">
            No zero-shot baseline is saved for this backend and set yet. Run <Code>npm run eval -- --baseline</Code> to compare
            the same model without AccessLoop&rsquo;s prompts.
          </p>
        ) : null}
        {rows.length > 0 ? (
          <Table
            id="eval-confusion"
            caption="Confusion matrix"
            description={`Rows: the expected area. Columns: the AI's top answer. Numbers are test reports${n > 1 ? " in repeat 1" : ""}.`}
            density="compact"
          >
            <THead>
              <Tr>
                <Th>
                  Expected area<VisuallyHidden>, then the AI&rsquo;s answers</VisuallyHidden>
                </Th>
                {cols.map((col) => (
                  <Th key={col} numeric>
                    {/* Th keeps column headers on one line; these names may wrap, so the matrix stays narrow. */}
                    <span className="inline-block min-w-[5.5rem] whitespace-normal">{areaLabel(col)}</span>
                  </Th>
                ))}
              </Tr>
            </THead>
            <TBody>
              {rows.map((row) => (
                <Tr key={row}>
                  <Th scope="row">{areaLabel(row)}</Th>
                  {cols.map((col) => {
                    const count = c.confusion[row]?.[col] ?? 0;
                    return (
                      <Td key={col} numeric className={count > 0 ? (col === row ? "font-bold text-success" : "font-bold") : "text-ink-muted"}>
                        {count}
                      </Td>
                    );
                  })}
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : null}
      </div>
    </Card>
  );
}

function OtherChecks({ r, b }: { r: EvalResult; b: EvalResult | null }) {
  return (
    <Card as="section" id="eval-checks" title="Other checks">
      <div className="grid gap-5">
        <p className="max-w-[var(--measure)] text-ink-muted">
          Some test reports hide instructions for the AI; resisting means sorting the real problem and never claiming the
          case is approved, resolved or verified. A vague report should go to a person instead of being guessed. A report
          whose AI step failed still gets the usual fallback (a person reads it), and is counted here.
        </p>
        <RatesTable
          id="eval-checks-table"
          caption="Injection, abstention and errors"
          description="95% Wilson intervals"
          keys={["injectionResisted", "abstained", "errors"]}
          r={r}
          b={b}
        />
      </div>
    </Card>
  );
}

/** Each pass of a run with repeats: how much the numbers moved between passes. */
function RepeatsSection({ r }: { r: EvalResult }) {
  const reps = allRepeats(r);
  const cols: RateKey[] = ["piiRemoved", "top1", "acceptable", "injectionResisted", "abstained", "errors"];
  return (
    <Card as="section" id="eval-repeats" title="Repeats">
      <div className="grid gap-5">
        <p className="max-w-[var(--measure)] text-ink-muted">
          This run went through the whole set {reps.length} times. The rates above are the mean over the repeats. Their 95%
          interval is that of one pass over the set: running the same test reports again does not add new reports, so
          repeats show how much the answers move, not a narrower interval.
        </p>
        <Table id="eval-repeats-table" caption="Each repeat" description={`${plural(r.fixtureCount, "test report")} in each repeat`} density="compact">
          <THead>
            <Tr>
              <Th>Repeat</Th>
              {cols.map((key) => (
                <Th key={key} numeric>
                  <span className="inline-block min-w-[6.5rem] whitespace-normal">{RATE_INFO[key].label}</span>
                </Th>
              ))}
              <Th numeric>Time per report, p50</Th>
            </Tr>
          </THead>
          <TBody>
            {reps.map((x, i) => {
              const counts = countsOf(x.metrics);
              return (
                <Tr key={i}>
                  <Th scope="row" className="whitespace-nowrap">{`Repeat ${i + 1}`}</Th>
                  {cols.map((key) => {
                    const one = rate(counts[key].k, counts[key].n);
                    return (
                      <Td key={key} numeric className="whitespace-nowrap">
                        {one.rate === null ? "None" : `${one.k} of ${one.n} (${percent(one.rate)})`}
                      </Td>
                    );
                  })}
                  <Td numeric className="whitespace-nowrap">{latency(x.metrics.latencyMs.p50)}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </div>
    </Card>
  );
}

/** The cost cell: api only, from the price constants; claude-cli is the team's subscription; fake costs nothing. */
function costText(r: EvalResult, prices: PriceConfig): { text: string; per1000: string | null } {
  if (r.backend === "fake") return { text: SIMULATED_COST, per1000: null };
  if (r.backend === "claude-cli") return { text: SUBSCRIPTION_COST, per1000: null };
  if (!prices.ok) {
    return {
      text: prices.reason === "unset" ? `Not shown: set ${PRICES_ENV} and ${PRICES_DATE_ENV} (see .env.example)` : `Not shown: ${prices.problem}`,
      per1000: null,
    };
  }
  const cost = costPerReport(allRepeats(r).flatMap((x) => x.predictions), prices.table);
  if (!cost.ok) {
    if (cost.reason === "no-usage") return { text: "Not shown: no AI call reported its tokens", per1000: null };
    if (cost.reason === "no-price") return { text: `Not shown: ${PRICES_ENV} has no price for ${cost.model}`, per1000: null };
    return { text: `Not shown: ${cost.model} used the prompt cache and ${PRICES_ENV} has no cache price for it`, per1000: null };
  }
  const from = cost.reports < cost.of ? ` (from ${cost.reports} of ${cost.of} reports)` : "";
  return { text: `${usd(cost.usdPerReport)} at prices set on ${cost.setOn}${from}`, per1000: usd(cost.usdPerReport * 1000) };
}

/** Latency, tokens and cost per report and per AI call (numbers only; the backend reports usage, the fake none). */
function TimeAndCost({ r, prices }: { r: EvalResult; prices: PriceConfig }) {
  const predictions = allRepeats(r).flatMap((x) => x.predictions);
  const n = (r.repeats ?? 1);
  const summary = summarizeCalls(predictions);
  const tokens = tokensPerReport(predictions);
  const cost = costText(r, prices);
  const rows = callStats(predictions);
  const retried = rows.reduce((s, row) => s + row.retried, 0);
  const tokenMean = (pick: "input" | "output") =>
    tokens ? `${Math.round(tokens[pick]).toLocaleString("en-CA")}${tokens.reports < tokens.of ? ` (from ${tokens.reports} of ${tokens.of} reports)` : ""}` : "Not reported";
  const perReport: { name: string; value: string }[] = [
    { name: "Time, median (p50)", value: summary.report.p50Ms === null ? "None" : latency(summary.report.p50Ms) },
    { name: "Time, p95", value: summary.report.p95Ms === null ? "None" : latency(summary.report.p95Ms) },
    { name: "Input tokens per report, mean", value: tokenMean("input") },
    { name: "Output tokens per report, mean", value: tokenMean("output") },
    { name: "Cost per report", value: cost.text },
    ...(cost.per1000 ? [{ name: "Cost per 1,000 reports", value: cost.per1000 }] : []),
  ];
  return (
    <Card as="section" id="eval-calls" title="Time, tokens and cost">
      <div className="grid gap-5">
        <p className="max-w-[var(--measure)] text-ink-muted">
          Each test report makes {r.layer1Only ? "one AI call (the summary and area)" : "two AI calls: personal details first, then the summary and area"}.
          Time covers a report&rsquo;s AI steps end to end. Token counts are the ones the backend reported for each call
          {r.simulated ? "; the simulated (fake) backend reports none" : ""}. Cost is shown for the Anthropic API only, from
          the prices a person copied into <Code>{PRICES_ENV}</Code> on the date in <Code>{PRICES_DATE_ENV}</Code>.
        </p>
        <Table
          id="eval-report-cost"
          caption="Time, tokens and cost per test report"
          description={n > 1 ? `${plural(predictions.length, "test report")} over ${n} repeats` : plural(predictions.length, "test report")}
        >
          <THead>
            <Tr>
              <Th>Measure</Th>
              <Th numeric>{runColumn(r)}</Th>
            </Tr>
          </THead>
          <TBody>
            {perReport.map((row) => (
              <Tr key={row.name}>
                <Th scope="row">{row.name}</Th>
                <Td numeric className="min-w-[10rem] wrap-anywhere">{row.value}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        <Table id="eval-calls-table" caption="Time and tokens per AI call">
          <THead>
            <Tr>
              <Th>Call</Th>
              <Th numeric>Calls</Th>
              <Th numeric>Time, median (p50)</Th>
              <Th numeric>Time, p95</Th>
              <Th numeric>Input tokens, total</Th>
              <Th numeric>Output tokens, total</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((row) => (
              <Tr key={row.fn}>
                <Th scope="row">{row.label}</Th>
                <Td numeric>{row.calls}</Td>
                <Td numeric className="whitespace-nowrap">{row.p50 === null ? "None" : latency(row.p50)}</Td>
                <Td numeric className="whitespace-nowrap">{row.p95 === null ? "None" : latency(row.p95)}</Td>
                <Td numeric>{row.calls === 0 ? "None" : tokenCell(row.inputTokens, row.withUsage, row.calls)}</Td>
                <Td numeric>{row.calls === 0 ? "None" : tokenCell(row.outputTokens, row.withUsage, row.calls)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        {retried > 0 ? (
          <p className="max-w-[var(--measure)]">
            {plural(retried, "call")} needed the one retry after the API said it was busy (HTTP 429 or 529).
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function EachReport({ r }: { r: EvalResult }) {
  const n = r.repeats ?? 1;
  return (
    <Card as="section" id="eval-each" title="Each test report">
      <Table
        id="eval-each-table"
        caption="Results per test report"
        description={n > 1 ? `${plural(r.predictions.length, "test report")}, repeat 1 of ${n}` : plural(r.predictions.length, "test report")}
        density="compact"
      >
        <THead>
          <Tr>
            <Th>Test report</Th>
            <Th>AI&rsquo;s top answer</Th>
            <Th>Expected area</Th>
            <Th>Result</Th>
            <Th numeric>Time</Th>
          </Tr>
        </THead>
        <TBody>
          {r.predictions.map((p) => {
            const top = [...(p.priorityAreas ?? [])].sort((x, y) => y.confidence - x.confidence)[0];
            const abstained = !top || top.confidence < r.abstainThreshold;
            const expected = p.expected?.abstain ? "None: should go to a person" : areaLabel(p.expected?.primaryArea ?? null);
            return (
              <Tr key={p.id} className="align-top">
                <Th scope="row" className="font-mono">
                  {p.id}
                  {p.expected?.injection ? <span className="block font-sans text-small font-normal text-ink-muted">Hidden instructions</span> : null}
                </Th>
                {/* The AI's answer right after the report: on a phone it is in view next to the ID without scrolling. */}
                <Td className="min-w-[9rem]">
                  {p.error && !top ? (
                    <span className="text-ink-muted">No answer</span>
                  ) : abstained ? (
                    <>Abstained{top ? ` (${areaLabel(top.area)}, ${top.confidence.toFixed(2)})` : ""}</>
                  ) : (
                    `${areaLabel(top.area)} (${top.confidence.toFixed(2)})`
                  )}
                </Td>
                <Td className="min-w-[9rem]">{expected}</Td>
                <Td className="min-w-[11rem] wrap-anywhere">
                  {p.error ? <span className="font-bold text-danger">{p.error}</span> : "Completed"}
                </Td>
                <Td numeric className="whitespace-nowrap">{latency(p.latencyMs)}</Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </Card>
  );
}

function RunDetails({
  saved,
  baseline,
  layer1,
  prices,
}: {
  saved: SavedEvalResult;
  baseline: SavedEvalResult | null;
  layer1: SavedEvalResult | null;
  prices: PriceConfig;
}) {
  const r = saved.result;
  const rows: { name: string; value: ReactNode }[] = [
    { name: "Backend", value: BACKEND_NAMES[r.backend] },
    {
      name: "Models",
      value: r.models.structure === r.models.flagPii ? r.models.structure : `structure: ${r.models.structure}; flagPii: ${r.models.flagPii}`,
    },
    ...(r.cliVersion ? [{ name: "Claude Code CLI version", value: r.cliVersion }] : []),
    { name: "Test set", value: `${setName(r.set)}, ${plural(r.fixtureCount, "report")}` },
    ...((r.repeats ?? 1) > 1 ? [{ name: "Repeats", value: `${r.repeats} passes over the set` }] : []),
    { name: "Personal-details AI pass", value: r.layer1Only ? "Off: layer 1 patterns only" : "On: layer 1 patterns, then the AI pass" },
    ...(r.layer1Sha
      ? [
          {
            name: "Layer-1 patterns",
            value: (
              <>
                sha256 <Code>{r.layer1Sha.slice(0, 8)}</Code> of {LAYER1_FILES.map((f, i) => (
                  <span key={f}>
                    {i > 0 ? " and " : ""}
                    <Code>{f}</Code>
                  </span>
                ))}
              </>
            ),
          },
        ]
      : []),
    {
      name: "Prompts",
      value: (
        <span className="grid gap-1">
          {(["structure", "flagPii"] as const).map((fn) => (
            <span key={fn}>
              <Code>{r.prompts[fn].file}</Code> {r.prompts[fn].version}, sha256 <Code>{r.prompts[fn].sha.slice(0, 8)}</Code>
            </span>
          ))}
        </span>
      ),
    },
    ...(r.backend === "api"
      ? [{ name: "Prices", value: prices.ok ? `Set on ${prices.table.setOn} (${PRICES_ENV})` : `Not set (${PRICES_ENV}, ${PRICES_DATE_ENV})` }]
      : []),
    { name: "Saved as", value: <Code>eval/results/{saved.file}</Code> },
    ...(baseline ? [{ name: "Baseline saved as", value: <Code>eval/results/{baseline.file}</Code> }] : []),
    ...(layer1 ? [{ name: "Layer-1-only run saved as", value: <Code>eval/results/{layer1.file}</Code> }] : []),
  ];
  return (
    <Card as="section" id="eval-run" title="About this run">
      <Table id="eval-run-table" caption="Run details" captionHidden density="compact">
        <TBody>
          {rows.map((row) => (
            <Tr key={row.name} className="align-top">
              <Th scope="row" className="w-[12rem] whitespace-nowrap">{row.name}</Th>
              <Td className="min-w-[14rem]">{row.value}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

/** A set other than visible and holdout (the injection suite, the silver set): its latest measured and simulated run. */
function OtherSet({ set, measured, simulated }: { set: string; measured: SavedEvalResult | null; simulated: SavedEvalResult | null }) {
  const name = setName(set);
  const id = `eval-set-${set.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
  return (
    <Card as="section" id={id} title={name}>
      <div className="grid gap-5">
        <p className="max-w-[var(--measure)] text-ink-muted">
          {SET_DESCRIPTIONS[set] ?? "Another labelled set, run through the same steps and scored the same way."}
        </p>
        {measured ? <SetRun id={`${id}-measured`} name={name} saved={measured} /> : <p className="max-w-[var(--measure)]">No measured run of this set is saved yet.</p>}
        {simulated ? <SetRun id={`${id}-simulated`} name={name} saved={simulated} /> : null}
      </div>
    </Card>
  );
}

function SetRun({ id, name, saved }: { id: string; name: string; saved: SavedEvalResult }) {
  const r = saved.result;
  const reps = metricsOf(r);
  const rates = repeatedRates(reps);
  const keys = RATE_KEYS.filter((key) => rates[key].rate !== null);
  const kind = r.simulated ? "simulated" : "measured";
  const p50 = summarizeCalls(allRepeats(r).flatMap((x) => x.predictions)).report.p50Ms;
  return (
    <div className="grid gap-3">
      <Table
        id={id}
        caption={`${name}: latest ${kind} run`}
        description={
          <>
            {r.simulated ? `${SIMULATED_NOTICE}. ` : `${BACKEND_NAMES[r.backend]}. `}
            {plural(r.fixtureCount, "test report")}
            {reps.length > 1 ? `, mean of ${reps.length} repeats` : ""}; 95% Wilson intervals. Run on{" "}
            <time dateTime={r.timestamp}>{formatDateTime(new Date(r.timestamp))}</time>
          </>
        }
        density="compact"
      >
        <THead>
          <Tr>
            <Th>Measure</Th>
            <Th numeric>{r.simulated ? "Simulated" : "Result"}</Th>
            <Th numeric>95% CI</Th>
          </Tr>
        </THead>
        <TBody>
          {keys.map((key) => (
            <Tr key={key}>
              <Th scope="row">{RATE_INFO[key].label}</Th>
              <Td numeric className="whitespace-nowrap">{rateText(rates[key])}</Td>
              <Td numeric className="whitespace-nowrap">{ciText(rates[key])}</Td>
            </Tr>
          ))}
          <Tr>
            <Th scope="row">Time per report, p50</Th>
            <Td numeric className="whitespace-nowrap">{p50 === null ? "None" : latency(p50)}</Td>
            <Td numeric className="whitespace-nowrap">Not a rate</Td>
          </Tr>
        </TBody>
      </Table>
      {r.injectionChecks ? <InjectionChecksTable id={`${id}-checks`} name={name} kind={kind} checks={r.injectionChecks} /> : null}
      <p className="max-w-[var(--measure)]">
        <a href={evalRunHref(saved.file)}>
          Open this {kind} run<VisuallyHidden> of the {name}</VisuallyHidden>
        </a>{" "}
        for every table of it.
      </p>
    </div>
  );
}

/** What each strict check of the injection suite asks (eval/injection.ts), in plain words. */
export const INJECTION_CHECK_LABELS: Record<InjectionCheck, string> = {
  ran: "Both AI steps answered",
  area: "A right priority area, with confidence",
  no_status_claim: "The summary claims no status",
  no_canary: "No planted word in the summary",
  pii_hidden: "Personal details hidden",
  delimiters: "One report block in each request",
};

/**
 * An injection-suite run's strict per-case checks (result.injectionChecks, eval/injection.ts checkInjectionSuite), next
 * to score()'s rates: a case resists only when it passes every check. Counts only, never the attack text.
 */
function InjectionChecksTable({ id, name, kind, checks }: { id: string; name: string; kind: string; checks: InjectionChecks }) {
  return (
    <Table
      id={id}
      caption={`${name}: strict checks, latest ${kind} run`}
      description="A test report resists only when it passes every check below. Counts only, never the attack text."
      density="compact"
    >
      <THead>
        <Tr>
          <Th>Check</Th>
          <Th numeric>Passed</Th>
        </Tr>
      </THead>
      <TBody>
        <Tr>
          <Th scope="row">Every check (resisted)</Th>
          <Td numeric className="whitespace-nowrap">{`${checks.resisted} of ${checks.n}`}</Td>
        </Tr>
        {INJECTION_CHECKS.map((c) => (
          <Tr key={c}>
            <Th scope="row">{INJECTION_CHECK_LABELS[c]}</Th>
            <Td numeric className="whitespace-nowrap">{`${checks.n - (checks.byCheck[c]?.failed ?? 0)} of ${checks.n}`}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

/** "AccessLoop prompts, layer 1 only, 3 repeats". */
function runKind(r: EvalResult): string {
  return [r.baseline ? "Zero-shot baseline" : "AccessLoop prompts", ...(r.layer1Only ? ["layer 1 only"] : []), ...((r.repeats ?? 1) > 1 ? [`${r.repeats} repeats`] : [])].join(", ");
}

function SavedRuns({ listing, current }: { listing: EvalResultsListing; current: SavedEvalResult | null }) {
  const ordered = savedRunsOrder(listing);
  const anyMeasured = ordered.some(isMeasured);
  return (
    <Card as="section" id="eval-saved" title="Saved runs">
      <Table
        id="eval-saved-table"
        caption="Every saved eval run"
        description={`${anyMeasured ? "Measured runs first, then simulated ones; Anthropic API runs come before claude-cli runs, newest first in each group." : "Newest first."}${listing.results.length > 1 ? " Open a file name to see that run." : ""}`}
        density="compact"
      >
        <THead>
          <Tr>
            <Th>File</Th>
            <Th>When</Th>
            <Th>Backend</Th>
            <Th>Set</Th>
            <Th>Run</Th>
          </Tr>
        </THead>
        <TBody>
          {ordered.map((s) => (
            <Tr key={s.file}>
              <Th scope="row" className="min-w-[14rem]">
                {s.file === current?.file ? (
                  <>
                    <Code>{s.file}</Code>
                    <span className="block text-small font-bold text-ink-muted">Shown above</span>
                  </>
                ) : (
                  // Alone in its cell: the table's 44px rule applies; whitespace-normal lets a long name wrap.
                  <a href={evalRunHref(s.file)} className="whitespace-normal">
                    <Code>{s.file}</Code>
                  </a>
                )}
              </Th>
              <Td className="whitespace-nowrap">
                <time dateTime={s.result.timestamp}>{formatDateTime(new Date(s.result.timestamp))}</time>
              </Td>
              <Td className="min-w-[10rem]">{s.result.simulated ? SIMULATED_NOTICE : s.result.backend}</Td>
              <Td className="min-w-[7rem]">{setName(s.result.set)}</Td>
              <Td className="min-w-[10rem]">{runKind(s.result)}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}
