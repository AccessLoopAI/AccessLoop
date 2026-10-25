import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ReporterShell } from "@/components/layout/ReporterShell";
import { SignOutForm } from "@/components/layout/SignOutForm";
import { StaffShell } from "@/components/layout/StaffShell";
import { EvidenceChecks, EvidenceLegend, EvidenceRecords, EvidenceVerdict } from "@/components/report/EvidenceCheck";
import { ReportStateBadge } from "@/components/report/ReportStateBadge";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { Announce } from "@/components/ui/StatusRegion";
import { StepList, StepListItem } from "@/components/ui/StepList";
import { STAFF_ROLE_LABELS, getStaffOrg, staffNav } from "@/lib/auth/staff";
import { formatDateLong } from "@/lib/format";
import { limitRequest } from "@/lib/rate-limit";
import { RATE_LIMITED_MESSAGE } from "@/lib/rate-limit-message";
import { isReportId, loadPublicEvidence, loadStaffEvidence, type Evidence } from "@/lib/report/access";
import { bundleFilename } from "@/lib/report/bundle";
import { evidenceBundlePath, SIGNING_KEYS_PATH, VERIFIER_PATH } from "@/lib/report/labels";
import { receivedPhrase, reportState } from "@/lib/report/view";

// The evidence check (docs/domain.md §8; CLAUDE.md signature moment 3). Public for a signed-off AND published report
// (its org from resolvePublishedReport()); a draft only for the signed-in lead or auditor of its org (getStaff);
// anything else is a 404. It recomputes the fingerprint, runs the frozen verifyCaseChain on every cited case history
// and replays each one up to the record the report froze: never the `cases` projection. h1 "Evidence check"; the
// status line is shown visibly and announced through the ONE StatusRegion (<Announce>); one "Records" table row per
// cited case. Anyone who is not the report's own staff is rate-limited (verify_view). The last section says how to run
// the same checks offline on the evidence bundle (tools/verify-bundle.mjs, docs/domain.md §8).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Evidence check" };

type Props = { params: Promise<{ reportId: string }> };

export default async function VerifyPage({ params }: Props) {
  const { reportId } = await params;
  if (!isReportId(reportId)) notFound();

  const staff = await getStaffOrg();
  const own = staff ? await loadStaffEvidence(staff, reportId) : null;
  if (staff && own) {
    return (
      <StaffShell
        orgName={staff.orgName}
        userName={staff.displayName}
        userRole={STAFF_ROLE_LABELS[staff.role]}
        nav={staffNav(staff.role)}
        signOut={<SignOutForm />}
      >
        <EvidencePage evidence={own} orgSlug={staff.orgSlug} backHref={`/app/reports/${reportId}`} caseHref={(ref) => `/app/cases/${ref}`} />
      </StaffShell>
    );
  }

  if (!(await limitRequest("verify_view")).ok) {
    return (
      <ReporterShell>
        <PageHeader title="Please wait a few minutes" description={RATE_LIMITED_MESSAGE} />
      </ReporterShell>
    );
  }
  const pub = await loadPublicEvidence(reportId);
  if (!pub) notFound();
  return (
    <ReporterShell orgName={pub.org.name} orgSlug={pub.org.slug} width="wide">
      <EvidencePage evidence={pub} orgSlug={pub.org.slug} backHref={`/p/${pub.org.slug}/reports/${reportId}`} />
    </ReporterShell>
  );
}

function EvidencePage({
  evidence,
  orgSlug,
  backHref,
  caseHref,
}: {
  evidence: Evidence;
  orgSlug: string;
  backHref: string;
  caseHref?: (ref: string) => string;
}): ReactNode {
  const { target, check } = evidence;
  const state = reportState(target);
  const checkedAt = new Date();
  return (
    <div className="al-evidence grid gap-10">
      <Announce message={check.line} />
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <ReportStateBadge state={state} />
            <span>{target.title}</span>
          </span>
        }
        title="Evidence check"
        description={
          <p>
            This page recomputes the report&rsquo;s fingerprint and replays every case history it cites, straight from the
            case records, so anyone can see whether anything changed after the report was built.
            {state === "draft" ? " Draft: only your team can see this check." : ""}
          </p>
        }
        meta={
          <>
            <span>Feedback received {receivedPhrase({ start: target.periodStart, end: target.periodEnd })}</span>
            <span>
              Built <time dateTime={target.createdAt.toISOString()}>{formatDateLong(target.createdAt)}</time>
            </span>
            {target.publishedAt ? (
              <span>
                Published <time dateTime={target.publishedAt.toISOString()}>{formatDateLong(target.publishedAt)}</time>
              </span>
            ) : null}
          </>
        }
        actions={
          <ButtonLink href={backHref} variant="secondary" iconStart={<Icon icon={ArrowLeft} />}>
            Back to the report
          </ButtonLink>
        }
        className="mb-0"
      />

      <EvidenceVerdict check={check} checkedAt={checkedAt} />

      <section aria-labelledby="evidence-checks-title" className="grid gap-4">
        <h2 id="evidence-checks-title">The five checks</h2>
        <EvidenceChecks check={check} />
      </section>

      <section aria-labelledby="evidence-cases-title" className="grid gap-4">
        <div className="grid gap-2">
          <h2 id="evidence-cases-title">Each case&rsquo;s history</h2>
          <p className="max-w-[72ch] text-ink-muted">
            One row for each case the report cites, with each check&rsquo;s result for that case. Only the kind of each
            record, its date and its fingerprint are shown here, never what anyone wrote.
          </p>
        </div>
        {check.readable ? (
          <>
            <EvidenceRecords check={check} caseHref={caseHref} />
            <EvidenceLegend />
          </>
        ) : (
          <p className="font-bold text-danger">The records frozen into this report can&rsquo;t be read, so no case can be checked.</p>
        )}
      </section>

      <OfflineCheck evidence={evidence} orgSlug={orgSlug} />
    </div>
  );
}

/** How to run the same checks offline on the evidence bundle, without trusting this page (docs/domain.md §8). */
function OfflineCheck({ evidence, orgSlug }: { evidence: Evidence; orgSlug: string }): ReactNode {
  const { target } = evidence;
  const published = target.status === "signed_off" && !!target.publishedAt;
  const file = bundleFilename(target.title);
  return (
    <section aria-labelledby="evidence-offline-title" className="grid gap-4">
      <div className="grid gap-2">
        <h2 id="evidence-offline-title">Check it yourself, offline</h2>
        <p className="max-w-[72ch]">
          You don&rsquo;t have to trust this page. A one-file script runs the same checks on your own computer, with no
          internet connection: the signature, the signed fingerprint, every case history in the evidence bundle and the
          report&rsquo;s numbers. It needs only Node.js 20 or later.
        </p>
      </div>
      {published ? (
        <StepList>
          <StepListItem n={1} title="Download the evidence bundle">
            <p>
              <a href={evidenceBundlePath(orgSlug, target.id)} download>
                Download evidence bundle
              </a>{" "}
              (a JSON file with public information only: no one&rsquo;s words, names or contact details).
            </p>
          </StepListItem>
          <StepListItem n={2} title="Save AccessLoop’s signing keys">
            <p>
              Save <a href={SIGNING_KEYS_PATH}>AccessLoop&rsquo;s published signing keys</a> as{" "}
              <code className="font-mono text-small font-bold wrap-anywhere">accessloop-signing-keys.json</code>. If you
              already hold this key from another source, use that copy.
            </p>
          </StepListItem>
          <StepListItem n={3} title="Get the checking script">
            <p>
              <a href={VERIFIER_PATH} download>
                Download the checking script (verify-bundle.mjs)
              </a>
              . It is also <code className="font-mono text-small font-bold wrap-anywhere">tools/verify-bundle.mjs</code> in
              AccessLoop&rsquo;s source code. It is one short file you can read before you run it.
            </p>
          </StepListItem>
          <StepListItem n={4} title="Run it">
            <p className="wrap-anywhere">
              <code className="font-mono text-small font-bold" data-testid="offline-command">
                node verify-bundle.mjs {file} --keys accessloop-signing-keys.json
              </code>
            </p>
            <p>
              It prints each check and ends with &ldquo;All checks passed&rdquo; or what failed. To compare with the signed
              fingerprint the organization gave the regulator, add{" "}
              <code className="font-mono text-small font-bold wrap-anywhere">--expect-root</code> and that fingerprint.
            </p>
          </StepListItem>
        </StepList>
      ) : (
        <p className="max-w-[72ch] text-ink-muted">
          The evidence bundle and the checking script work once the report is signed off and published.
        </p>
      )}
    </section>
  );
}
