import Link from "next/link";
import { FilePlus2, ShieldAlert, ShieldCheck } from "lucide-react";
import { ReportStateBadge } from "@/components/report/ReportStateBadge";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { CheckRing } from "@/components/ui/CheckRing";
import { Icon } from "@/components/ui/Icon";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import { formatDateLong, formatDateTime } from "@/lib/format";
import { countLabel, inboxHref, type CaseSet, type Period } from "@/lib/metrics";
import type { IntegrityCheck } from "@/lib/metrics/integrity";
import type { DashboardReport, DashboardReports } from "@/lib/report/access";
import { REPORT_STATE_LABELS } from "@/lib/report/view";

// The dashboard's two report cards (docs/domain.md §10 items 5 and 6). Report readiness: the newest report for the
// selected period (its state, its heading checks re-run by lib/report, a link to it) or plainly none, and the lead's
// "Generate report" link to /app/reports/new with the period's dates filled in (never "New report": that link name
// belongs to /app/reports). Evidence integrity: verifyCaseChain over the period's cases (lib/metrics), and a link to
// the evidence check (/verify) of the org's latest report, or plainly that no report exists yet. Every case number
// comes from lib/metrics; the check counts come from lib/report's checker. Server components.

const CARD = "al-card grid content-start gap-3 rounded-lg border border-border bg-surface p-[var(--card-pad)]";
const TITLE = "text-card-title font-sans font-bold tracking-normal";

/** /app/reports/new?start=…&end=…: the new-report form with the dashboard's period filled in. */
export function generateReportHref(period: Period): string {
  return `/app/reports/new?${new URLSearchParams({ start: period.start, end: period.end }).toString()}`;
}

function builtLine(r: DashboardReport) {
  return (
    <>
      Built <time dateTime={r.createdAt.toISOString()}>{formatDateLong(r.createdAt)}</time>
      {r.createdByName ? ` by ${r.createdByName}` : ""}.
    </>
  );
}

export function ReportReadinessCard({
  period,
  total,
  report,
  canGenerate,
}: {
  period: Period;
  /** The period's cases (lib/metrics totalReceived). */
  total: CaseSet;
  report: DashboardReports["forPeriod"];
  /** Only the lead can open /app/reports/new. */
  canGenerate: boolean;
}) {
  const r = report?.readiness;
  return (
    <div data-testid="report-readiness" className={CARD}>
      <h2 className={TITLE}>Report readiness</h2>
      {report && r ? (
        <>
          <div className="grid justify-items-start gap-1">
            <ReportStateBadge state={report.state} />
            <Link href={`/app/reports/${report.id}`} data-testid="readiness-report" className="inline-flex min-h-11 items-center font-bold">
              <span>{report.title}</span>
            </Link>
            <p className="text-small text-ink-muted">{builtLine(report)}</p>
          </div>
          <p data-testid="readiness-checks" className={`flex items-center gap-2 font-bold ${r.ok ? "text-success" : "text-danger"}`}>
            <CheckRing state={r.ok ? "passed" : "missing"} className="al-check-ring-inline" />
            <span>{r.summary}</span>
          </p>
          <p data-testid="readiness-next" className="text-small text-ink">
            {report.state === "draft" ? `${r.toWriteLine}. ` : ""}
            {r.next}
          </p>
        </>
      ) : (
        <>
          <p data-testid="readiness-none" className="flex items-center gap-2 font-bold text-ink">
            <CheckRing state="to_write" className="al-check-ring-inline" />
            <span>No report for this period yet</span>
          </p>
          <p className="text-small text-ink-muted">
            A draft&apos;s Feedback section is counted from the same records as this page:{" "}
            {total.count > 0 ? (
              <Link href={inboxHref(total.filter)}>{countLabel(total.count)} received in this period</Link>
            ) : (
              "no cases received in this period yet"
            )}
            .
          </p>
        </>
      )}
      {canGenerate ? (
        <div className="grid justify-items-start gap-2">
          <ButtonLink href={generateReportHref(period)} variant={report ? "secondary" : "primary"} iconStart={<Icon icon={FilePlus2} />}>
            Generate report
          </ButtonLink>
          <p className="text-small text-ink-muted">
            {report
              ? "This builds a new version from today's records, with this period's dates filled in. Earlier versions never change."
              : "Opens the new report with this period's dates filled in. Nothing is public until you sign off and publish."}
          </p>
        </div>
      ) : (
        <p className="text-small text-ink-muted">Only the lead can generate a report.</p>
      )}
    </div>
  );
}

export function EvidenceIntegrityCard({
  integrity,
  total,
  latest,
}: {
  integrity: IntegrityCheck;
  /** The period's cases (lib/metrics totalReceived): the chains checked. */
  total: CaseSet;
  latest: DashboardReports["latest"];
}) {
  return (
    <div data-testid="evidence-integrity" className={CARD}>
      <h2 className={TITLE}>Evidence integrity</h2>
      {integrity.checked === 0 ? (
        <p className="text-ink">No records to check in this period yet.</p>
      ) : integrity.broken.length === 0 ? (
        <p className="flex items-center gap-2 font-bold text-success">
          <Icon icon={ShieldCheck} size="1.35em" />
          <span data-testid="integrity-line">All {integrity.checked} records verify</span>
        </p>
      ) : (
        <>
          <p className="flex items-center gap-2 font-bold text-danger">
            <Icon icon={ShieldAlert} size="1.35em" />
            <span data-testid="integrity-line">
              {integrity.broken.length} of {integrity.checked} records don&apos;t verify
            </span>
          </p>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 p-0">
            {integrity.broken.map((b) => (
              <li key={b.caseId}>
                <Link href={`/app/cases/${b.ref}`} className="inline-flex min-h-11 items-center font-mono font-bold">
                  {b.ref}
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-small text-ink">
            An event in these cases was changed or deleted after it was written. The records stay as they are, so
            someone can look into it.
          </p>
        </>
      )}
      <p className="text-small text-ink-muted">
        Each case&apos;s history is a chain of hashed records: changing or deleting any record breaks the chain.
        Checked {formatDateTime(integrity.checkedAt)}; checked again at most once a minute.
      </p>
      {latest ? (
        <p data-testid="integrity-latest" className="text-small text-ink">
          The latest report is <span className="font-bold">{latest.title}</span> ({REPORT_STATE_LABELS[latest.state].toLowerCase()}).
          Its evidence check recomputes the report&apos;s fingerprint and replays every case it cites.
        </p>
      ) : (
        <p data-testid="integrity-no-report" className="text-small text-ink">
          No progress report exists yet, so there is no evidence check to open. Each report gets one when it is built.
        </p>
      )}
      {latest || total.count > 0 ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {latest ? (
            <ButtonLink href={`/verify/${latest.id}`} variant="secondary" iconStart={<Icon icon={ShieldCheck} />}>
              Open the evidence check<VisuallyHidden>{` for ${latest.title}`}</VisuallyHidden>
            </ButtonLink>
          ) : null}
          {total.count > 0 ? (
            <Link href={inboxHref(total.filter)} className="inline-flex min-h-11 items-center text-small font-bold">
              <span>
                See the cases<VisuallyHidden> for Evidence integrity</VisuallyHidden>
              </span>
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
