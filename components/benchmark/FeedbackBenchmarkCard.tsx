// "How your Feedback section compares" (docs/phase7-prompt.md T6 item 3): on a progress report's page, beside
// "Report checks". "Your draft covers N of 7 elements; published median is M": N from the report's own stored
// sentences (lib/benchmark draftCoverage), M ONLY from benchmark rows a person checked (verified_by_human = true in
// data/benchmark/feedback-sections.csv). With no checked row the card is not rendered at all.
//
// Page contract (components/ui/README.md "Report pages"): this card is a plain <div>, never a region, so the page
// keeps exactly one region whose name contains "Feedback"; its h2 is not "Feedback". It sits after the sign-off
// panel, so the Tab order through the checks and sign-off is unchanged.
import type { CSSProperties } from "react";
import { CheckRing } from "@/components/ui/CheckRing";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import {
  BENCHMARK_ELEMENTS,
  ESDC_GUIDANCE_URL,
  draftCoverage,
  medianLabel,
  type BenchmarkElement,
  type BenchmarkSummary,
} from "@/lib/benchmark/feedback-sections";
import { loadFeedbackBenchmark } from "@/lib/benchmark/load";
import type { ReportContent } from "@/lib/report/types";

/** Why an element is missing from a draft, when it is not obvious. */
const MISSING_WHY: Partial<Record<BenchmarkElement, string>> = {
  how_considered: "No fix was logged for this period's feedback yet, so there is nothing to describe.",
  process_changes: "AccessLoop does not draft this part.",
};

export const BENCHMARK_CARD_TITLE = "How your Feedback section compares";

/** The headline sentence (the phrase the card is known by). */
export function benchmarkHeadline(covered: number, total: number, median: number, signedOff: boolean): string {
  return `Your ${signedOff ? "report" : "draft"} covers ${covered} of ${total} elements; published median is ${medianLabel(median)}.`;
}

interface ViewProps {
  coverage: Record<BenchmarkElement, boolean>;
  summary: BenchmarkSummary;
  /** Signed off or published: "Your report covers" instead of "Your draft covers". */
  signedOff: boolean;
  /** The Feedback section's index: on a just-built draft the rings tick with it (app/globals.css [data-building]). */
  lastSection: number;
}

/** The card itself (pure, so the tests render it): only ever called with a summary of checked rows. */
export function FeedbackBenchmarkView({ coverage, summary, signedOff, lastSection }: ViewProps) {
  const covered = BENCHMARK_ELEMENTS.filter((e) => coverage[e.key]).length;
  const reports = summary.reports === 1 ? "1 published progress report" : `${summary.reports} published progress reports`;
  return (
    <div id="feedback-benchmark" data-testid="feedback-benchmark" className="al-card al-checks">
      <h2 id="feedback-benchmark-title" className="text-card-title font-sans font-bold tracking-normal">
        {BENCHMARK_CARD_TITLE}
      </h2>
      <p className="mt-3 text-lead font-bold" data-testid="benchmark-headline">
        {benchmarkHeadline(covered, BENCHMARK_ELEMENTS.length, summary.median, signedOff)}
      </p>
      <p className="mt-2 text-small text-ink-muted">
        The median is over {reports} that a person on our team read and checked. A report counts an element only when
        its Feedback section covers it fully.
      </p>

      <h3 className="al-subhead mt-5">Element by element</h3>
      <ul className="al-checklist">
        {BENCHMARK_ELEMENTS.map((e) => {
          const inDraft = coverage[e.key];
          const why = inDraft ? null : MISSING_WHY[e.key];
          return (
            <li key={e.key} className="al-check" data-state={inDraft ? "passed" : "to_write"} style={{ "--i": lastSection } as CSSProperties}>
              <CheckRing state={inDraft ? "passed" : "to_write"} />
              <span className="al-check-text">
                <span className="al-check-label">{e.label}</span>
                <VisuallyHidden>. </VisuallyHidden>
                <span className="al-check-meta">
                  <span className="al-check-state">{inDraft ? `In your ${signedOff ? "report" : "draft"}` : `Not in your ${signedOff ? "report" : "draft"}`}</span>
                  <VisuallyHidden>. </VisuallyHidden>
                  <span>
                    {summary.covered[e.key]} of {summary.reports} published
                  </span>
                </span>
                {why ? <span className="text-small text-ink-muted">{why}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-5 text-small text-ink-muted">
        Six elements come from{" "}
        <a href={ESDC_GUIDANCE_URL} rel="noopener noreferrer">
          ESDC&rsquo;s guidance on preparing a progress report
        </a>
        . The last one, whether the people who reported barriers confirmed the fixes, is AccessLoop&rsquo;s own.
      </p>
    </div>
  );
}

/**
 * The card for a report's page: one line in app/(staff)/app/reports/[id]/page.tsx. Renders nothing until a person
 * has checked at least one benchmark row.
 */
export async function FeedbackBenchmarkCard({ content, signedOff }: { content: Pick<ReportContent, "sections" | "settings">; signedOff: boolean }) {
  const summary = await loadFeedbackBenchmark();
  if (!summary) return null;
  return <FeedbackBenchmarkView coverage={draftCoverage(content)} summary={summary} signedOff={signedOff} lastSection={content.sections.length - 1} />;
}
