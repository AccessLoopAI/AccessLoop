// The CAN-ASC-5.2.1 clause 17 panel (docs/phase7-prompt.md T6 item 5): the four steps the clause names, receive,
// acknowledge, address and respond, each with the count lib/metrics already has for the period (lib/standards/
// clause17.ts picks them) and a link to exactly those cases. One short quoted line, cited. It shows what the records
// say for each step and never says the organization meets the standard ("compliant" is never written).
// Link names are unique on the dashboard ("See the cases for clause 17: Receive"), and nothing here is a chart table.
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Disclosure } from "@/components/ui/Disclosure";
import { Icon } from "@/components/ui/Icon";
import { Quote } from "@/components/ui/Quote";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import type { DashboardMetrics } from "@/lib/metrics";
import { CLAUSE_17_QUOTE, CLAUSE_17_SOURCE, CLAUSE_17_URL, clause17Steps } from "@/lib/standards/clause17";

export function Clause17Panel({ metrics, className }: { metrics: DashboardMetrics; className?: string }) {
  const steps = clause17Steps(metrics);
  return (
    <Card
      as="section"
      id="clause-17"
      title="CAN-ASC-5.2.1, clause 17: what your records show"
      className={className}
    >
      <div data-testid="clause-17" className="grid gap-6">
        <Quote source={{ href: CLAUSE_17_URL, label: CLAUSE_17_SOURCE }} className="max-w-[var(--measure)]">
          {CLAUSE_17_QUOTE}
        </Quote>

        <ol className="m-0 grid list-none gap-x-6 gap-y-8 p-0 sm:grid-cols-2 xl:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.key} data-step={s.key} className="group relative flex flex-col gap-2">
              {/* The rail joining the four steps (one row from xl): decorative, the order is the list's. */}
              <span
                aria-hidden="true"
                className="absolute top-[calc(1.375rem-1px)] left-14 hidden h-0.5 w-[calc(100%-2.5rem)] bg-border-strong group-last:hidden xl:block"
              />
              <span
                aria-hidden="true"
                className="relative flex size-11 shrink-0 items-center justify-center self-start rounded-pill border-2 border-primary bg-surface-raised font-display text-h4 font-bold text-primary"
              >
                {i + 1}
              </span>
              <h3 className="mt-1">
                <VisuallyHidden>{`Step ${i + 1}: `}</VisuallyHidden>
                {s.name}
              </h3>
              <p data-step-value="" className="font-display text-stat font-semibold text-ink">
                {s.count}
                {s.of !== null ? (
                  <>
                    {" "}
                    <span className="font-sans text-lead font-bold text-ink-muted">of {s.of}</span>
                  </>
                ) : null}
              </p>
              <p className="text-small text-ink-muted">{s.what}</p>
              {/* At the bottom of the step, so the four steps' links line up in one row however their words wrap. */}
              <div className="mt-auto grid justify-items-start gap-y-1">
                <Disclosure
                  summary={
                    <>
                      What is counted?<VisuallyHidden>{` (${s.name})`}</VisuallyHidden>
                    </>
                  }
                  panelClassName="text-small text-ink"
                  className="text-small"
                >
                  {s.counted}
                </Disclosure>
                {s.href ? (
                  <Link href={s.href} className="inline-flex min-h-11 items-center gap-1.5 text-small font-bold">
                    <span>
                      See the cases
                      <VisuallyHidden>{` for clause 17: ${s.name}`}</VisuallyHidden>
                    </span>
                    <Icon icon={ArrowRight} size="1em" />
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ol>

        <p className="max-w-[var(--measure)] text-small text-ink-muted">
          Counted from your case records for the period above. This shows what was recorded at each step. It does not
          decide whether your process meets the standard: that is for you and your regulator.
        </p>
      </div>
    </Card>
  );
}
