// The "Report checks" region (docs/domain.md §7 step 6, handoff Phase 4 item 2): the frozen ACR s.14 checker's
// results for this draft as a live checklist, re-run on every save. NOT a live region: the page's one StatusRegion
// announces changes. The first line says exactly "All required checks pass" when every required check passes and no
// sentence blocks sign-off (demo.spec). Placeholders are warnings, listed separately under "Still to write".
// Each row carries --i = its section's index, so on a just-built draft its ring ticks as that section fills in.
import type { CSSProperties } from "react";
import { CheckRing, type CheckRingState } from "@/components/ui/CheckRing";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import { checksSummary, toWriteLine, type CheckView, type ChecksView } from "@/lib/report/view";

const STATE_WORD: Record<CheckRingState, string> = { passed: "Passed", missing: "Missing", to_write: "To write" };

function Row({ check }: { check: Pick<CheckView, "label" | "citation" | "state" | "section"> }) {
  return (
    <li className="al-check" data-state={check.state} style={{ "--i": check.section } as CSSProperties}>
      <CheckRing state={check.state} />
      <span className="al-check-text">
        <span className="al-check-label">{check.label}</span>
        <VisuallyHidden>. </VisuallyHidden>
        <span className="al-check-meta">
          <span className="al-check-state">{STATE_WORD[check.state]}</span>
          {check.citation ? <span className="al-check-cite">{check.citation}</span> : null}
        </span>
      </span>
    </li>
  );
}

interface ReportChecksProps {
  checks: ChecksView;
  /** Sentences without sources or blocked by the validator (they block sign-off and export). */
  blockers: number;
  toWrite: number;
  /** Index of the last section (Feedback): the evidence rows tick with it. */
  lastSection: number;
}

export function ReportChecks({ checks, blockers, toWrite, lastSection }: ReportChecksProps) {
  const ok = checks.passes && blockers === 0;
  const evidence: Pick<CheckView, "label" | "citation" | "state" | "section">[] = [
    {
      label: "Every generated sentence cites its records",
      citation: "Checked by the sentence checks",
      state: blockers === 0 ? "passed" : "missing",
      section: lastSection,
    },
    {
      label: "Every case history checked out when this draft was built",
      citation: "Checked against each hash chain",
      state: "passed",
      section: lastSection,
    },
  ];
  return (
    <section id="report-checks" aria-labelledby="report-checks-title" className="al-card al-checks">
      <h2 id="report-checks-title" className="text-card-title font-sans font-bold tracking-normal">
        Report checks
      </h2>
      <p className="al-checks-summary" data-ok={ok || undefined}>
        <CheckRing state={ok ? "passed" : "missing"} />
        <span>{checksSummary(checks, blockers)}</span>
      </p>
      <p className="text-small text-ink-muted">{toWriteLine(toWrite)}</p>

      <h3 className="al-subhead mt-5">Required headings and contents</h3>
      <ul className="al-checklist">
        {checks.required.map((c) => (
          <Row key={c.id} check={c} />
        ))}
      </ul>

      {checks.toWrite.length ? (
        <>
          <h3 className="al-subhead mt-5">Still to write</h3>
          <ul className="al-checklist">
            {checks.toWrite.map((c) => (
              <Row key={c.id} check={c} />
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="al-subhead mt-5">Evidence</h3>
      <ul className="al-checklist">
        {evidence.map((c) => (
          <Row key={c.label} check={c} />
        ))}
      </ul>
    </section>
  );
}
