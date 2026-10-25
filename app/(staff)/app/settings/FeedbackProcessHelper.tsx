// Under the Settings form (docs/phase7-prompt.md T6 item 4): the ACR s.9 checklist for the organization's feedback
// process, flagging what is missing, beside a preview of the description the public reads on /p/{org} (the SAME
// component that page renders, so nothing is written twice). Server component: it reads the saved settings (the
// page passes them) and this year's acknowledgements from lib/metrics (the dashboard's numbers), so a save, which
// refreshes the page, updates both. Lead only, like the page. Never "compliant": each row says what AccessLoop sees.
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FeedbackProcessDescription } from "@/components/feedback-process/FeedbackProcessDescription";
import { Card } from "@/components/ui/Card";
import { CheckRing, type CheckRingState } from "@/components/ui/CheckRing";
import { Icon } from "@/components/ui/Icon";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import {
  feedbackProcessChecks,
  processCheckSummary,
  type AcknowledgementSeen,
  type FeedbackProcessSettings,
  type ProcessCheck,
  type ProcessCheckState,
} from "@/lib/feedback-process";
import { acknowledgementCompliance, inboxHref, thisYear } from "@/lib/metrics";
import { loadMetricCases } from "@/lib/metrics/load";

const RING: Record<ProcessCheckState, CheckRingState> = { met: "passed", missing: "missing", check: "to_write" };
const STATE_WORD: Record<ProcessCheckState, string> = { met: "In place", missing: "Missing", check: "Check this yourself" };

/** This year's non-anonymous feedback and how much has no acknowledgement recorded (null if it can't be read). */
async function acknowledgementSeen(staff: { orgId: string; role: "lead" }, now: Date): Promise<AcknowledgementSeen | null> {
  try {
    const period = thisYear(now);
    const cases = await loadMetricCases({ orgId: staff.orgId, role: staff.role });
    const ack = acknowledgementCompliance({ cases, period, now });
    return {
      required: ack.required.count,
      missing: ack.missing.count,
      missingHref: ack.missing.count > 0 ? inboxHref(ack.missing.filter) : null,
      periodLabel: period.start.slice(0, 4),
    };
  } catch (err) {
    console.error(`[settings] could not read this year's acknowledgements (${err instanceof Error ? err.name : "UnknownError"})`);
    return null;
  }
}

function CheckRow({ check }: { check: ProcessCheck }) {
  return (
    <li className="al-check" data-state={RING[check.state]} data-check={check.id}>
      <CheckRing state={RING[check.state]} />
      <span className="al-check-text">
        <span className="al-check-label font-bold">{check.label}</span>
        <VisuallyHidden>. </VisuallyHidden>
        <span className="al-check-meta">
          <span className="al-check-state">{STATE_WORD[check.state]}</span>
          <VisuallyHidden>. </VisuallyHidden>
          <span className="al-check-cite">{check.rule}</span>
        </span>
        <span className="mt-1 text-small">{check.detail}</span>
        {check.action ? (
          <Link href={check.action.href} className="inline-flex min-h-11 items-center gap-1.5 text-small font-bold">
            <span>
              {check.action.text}
              <VisuallyHidden>{` (${check.rule})`}</VisuallyHidden>
            </span>
            <Icon icon={ArrowRight} size="1em" />
          </Link>
        ) : null}
      </span>
    </li>
  );
}

export async function FeedbackProcessHelper({ staff, org }: { staff: { orgId: string; role: "lead" }; org: FeedbackProcessSettings }) {
  const checks = feedbackProcessChecks(org, await acknowledgementSeen(staff, new Date()));
  const allMet = checks.every((c) => c.state === "met");
  return (
    <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-10">
      <Card
        as="section"
        id="process-check"
        title="Your feedback process (ACR s.9)"
        description="What the regulations ask your feedback process to include, and what AccessLoop sees in place. It uses your saved settings and this year's cases."
      >
        <p className="al-checks-summary mt-0" data-ok={allMet || undefined} data-testid="process-check-summary">
          <CheckRing state={allMet ? "passed" : checks.some((c) => c.state === "missing") ? "missing" : "to_write"} />
          <span>{processCheckSummary(checks)}</span>
        </p>
        <ul className="al-checklist mt-5 gap-5">
          {checks.map((c) => (
            <CheckRow key={c.id} check={c} />
          ))}
        </ul>
      </Card>

      <Card
        as="section"
        id="process-preview"
        title="Preview of your public description"
        description="People read this on your public feedback page, made from the settings above. Save to update it."
        tone="inset"
      >
        <div data-personality="reporter" className="grid gap-4">
          <FeedbackProcessDescription org={org} id="preview-give-feedback" headingLevel={3} />
        </div>
        <p className="mt-5">
          <Link href={`/p/${org.slug}`} className="inline-flex min-h-11 items-center gap-1.5 font-bold">
            <span>Open your public feedback page</span>
            <Icon icon={ArrowRight} size="1em" />
          </Link>
        </p>
      </Card>
    </div>
  );
}
