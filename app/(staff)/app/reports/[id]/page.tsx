import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, ShieldCheck } from "lucide-react";
import { FeedbackBenchmarkCard } from "@/components/benchmark/FeedbackBenchmarkCard";
import { LeadText, ReportBody } from "@/components/report/ReportBody";
import { ReportChecks } from "@/components/report/ReportChecks";
import { ReportStateBadge } from "@/components/report/ReportStateBadge";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { HashChip } from "@/components/ui/HashChip";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireStaff } from "@/lib/auth/staff";
import { formatDateLong, formatDateTime } from "@/lib/format";
import { loadStaffReport } from "@/lib/report/access";
import { BUILT_COOKIE } from "@/lib/report/labels";
import { leadPrompt, leadTextFor, reportChecks } from "@/lib/report/compose";
import { readSigning } from "@/lib/report/signing";
import { REGULATOR_NAMES, checksView, leadLabel, receivedPhrase, regulatorNoticeDue, reportState, reportView, toWriteLine, type SectionView } from "@/lib/report/view";
import { BuildReveal, LeadEditor, SignOffPanel } from "./ReportEditors";

// One progress report, as a finished publication (docs/domain.md §7 steps 6-9; CLAUDE.md signature moment 2).
// Lead: the draft with a text box per plan area and Consultations, the live "Report checks", sign-off (immutable
// afterwards) and publishing (with the ACR s.16 48-hour reminder). Auditor: the same page read-only. Owners and
// other orgs: 404. The header's "Verify evidence chain" is the page's only link of that name (demo.spec). Once
// signed off, the footer shows the signed fingerprint (the root signed at sign-off, docs/domain.md §8) that the lead
// includes in the ACR s.16 notice to the regulator.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Progress report" };

type Props = { params: Promise<{ id: string }> };

export default async function ReportPage({ params }: Props) {
  const staff = await requireStaff(["lead", "auditor"]);
  const { id } = await params;
  const loaded = await loadStaffReport(staff, id);
  if (!loaded) notFound();
  const { report, createdByName, signedOffByName } = loaded;
  // Just built by "Generate draft" (lib/report/labels.ts BUILT_COOKIE): sections fill in while the checks tick.
  const built = (await cookies()).get(BUILT_COOKIE)?.value === report.id;

  const state = reportState(report);
  const isLead = staff.role === "lead";
  const editable = isLead && state === "draft";
  const view = reportView(report.content, report.snapshot);
  const live = reportChecks(report.content, report.areaText, report.consultationsText);
  const checks = checksView(live.results, view.sections);
  const regulator = REGULATOR_NAMES[loaded.regulator] ?? "your regulator";
  const signing = readSigning(report.content);

  const missing: string[] = [];
  if (!live.passes) missing.push("Fix the required checks marked Missing.");
  if (live.toWrite > 0) missing.push(`${toWriteLine(live.toWrite)}: write each part marked "Still to write".`);
  if (live.blockers.length > 0) missing.push("A sentence has no sources or did not pass the sentence checks. Build a new draft.");

  const lead = (s: SectionView) => {
    const text = leadTextFor(s.key, report.areaText, report.consultationsText);
    if (editable) {
      return <LeadEditor reportId={report.id} sectionKey={s.key} heading={s.heading} label={leadLabel(s.key, s.heading)} hint={leadPrompt(s.key)} initial={text} />;
    }
    return <LeadText text={text} hint={leadPrompt(s.key)} draft={state === "draft"} />;
  };

  const due = report.publishedAt ? regulatorNoticeDue(report.publishedAt) : null;

  return (
    <>
      {built ? <BuildReveal /> : null}
      <p className="mb-4" data-print-hide>
        <Link href="/app/reports" className="inline-flex min-h-11 items-center gap-1.5 font-bold">
          <Icon icon={ArrowLeft} size="1em" />
          <span>All progress reports</span>
        </Link>
      </p>

      <div className="al-report-layout" data-building={built || undefined}>
        <div className="min-w-0">
          <article className="al-sheet">
            <PageHeader
              className="al-report-cover"
              eyebrow={
                <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <ReportStateBadge state={state} />
                  <span>{report.content.settings.orgName}</span>
                </span>
              }
              title={report.title}
              meta={
                <>
                  <span>Feedback received {receivedPhrase(report.snapshot.period)}</span>
                  <span>
                    Built <time dateTime={report.createdAt.toISOString()}>{formatDateLong(report.createdAt)}</time>
                    {createdByName ? ` by ${createdByName}` : ""}
                  </span>
                  {report.signedOffAt ? (
                    <span>
                      Signed off <time dateTime={report.signedOffAt.toISOString()}>{formatDateLong(report.signedOffAt)}</time>
                    </span>
                  ) : null}
                  {report.publishedAt ? (
                    <span>
                      Published <time dateTime={report.publishedAt.toISOString()}>{formatDateLong(report.publishedAt)}</time>
                    </span>
                  ) : null}
                </>
              }
              actions={
                <div className="flex flex-wrap gap-3" data-print-hide>
                  <ButtonLink href={`/verify/${report.id}`} variant="secondary" iconStart={<Icon icon={ShieldCheck} />}>
                    Verify evidence chain
                  </ButtonLink>
                  {live.blockers.length === 0 ? (
                    <ButtonLink href={`/app/reports/${report.id}/text`} download variant="quiet" iconStart={<Icon icon={Download} />}>
                      Download as plain text
                    </ButtonLink>
                  ) : null}
                </div>
              }
            />
            {!report.content.phrase.ok ? (
              <Notice tone="info" className="mb-8">
                Wording comes from the templates (the AI wording step was not available).
              </Notice>
            ) : null}
            {state === "draft" ? (
              <p className="al-report-draft-note" data-print-hide>
                {editable
                  ? "This is a draft: only your team can see it. The numbers and their sources come from the records; you write your progress for each area and how you consulted persons with disabilities."
                  : "This is a draft: only your team can see it."}{" "}
                {/* At every width: beside the report (lg up) the checks and sign-off are still after every footnote
                    in the Tab order, so keyboard users need this way past them as much as phone users do. */}
                <a href="#report-checks">Go to the report checks</a>
              </p>
            ) : null}

            <ReportBody view={view} lead={lead} caseLinkBase="/app/cases/" showCitations />

            <footer className="al-report-footer">
              <p className="font-bold">Fingerprint of this report (SHA-256)</p>
              <p>
                <HashChip hash={report.manifestHash} label="Fingerprint of this report (SHA-256)" length={16} />
              </p>
              <p className="text-small text-ink-muted">
                Computed from the records frozen into this report on {formatDateTime(new Date(report.snapshot.asOf))}. The
                evidence check recomputes it and replays every cited case history.
              </p>
              {signing ? (
                <div className="grid gap-2" data-testid="notice-fingerprint">
                  <p className="font-bold">Signed fingerprint for your notice to {regulator} (ACR s.16)</p>
                  <p className="font-mono text-small font-bold wrap-anywhere" translate="no">
                    {signing.root}
                  </p>
                  <p className="text-small text-ink-muted">
                    Include this fingerprint when you tell {regulator} that the report is published. At sign-off AccessLoop
                    sealed this report, your text and every case history of {report.content.settings.orgName} into it, and signed
                    it (Ed25519, key {signing.keyId}), so the regulator can check later that no record was rewritten.
                  </p>
                </div>
              ) : state === "draft" ? (
                <p className="text-small text-ink-muted">
                  When you sign off, the signed fingerprint for your notice to {regulator} appears here.
                </p>
              ) : null}
            </footer>
          </article>
        </div>

        <div className="al-report-rail" data-print-hide>
          <ReportChecks checks={checks} blockers={live.blockers.length} toWrite={live.toWrite} lastSection={view.sections.length - 1} />
          <SignOffPanel
            reportId={report.id}
            state={state}
            canAct={isLead}
            canSignOff={live.canSignOff}
            missing={state === "draft" ? missing : []}
            signedOff={report.signedOffAt ? { by: signedOffByName, at: formatDateTime(report.signedOffAt), atIso: report.signedOffAt.toISOString() } : null}
            published={
              report.publishedAt && due
                ? { at: formatDateTime(report.publishedAt), atIso: report.publishedAt.toISOString(), due: formatDateTime(due), dueIso: due.toISOString(), regulator, signed: !!signing }
                : null
            }
            publicHref={`/p/${staff.orgSlug}/reports/${report.id}`}
          />
          <FeedbackBenchmarkCard content={report.content} signedOff={state !== "draft"} />
        </div>
      </div>
    </>
  );
}
