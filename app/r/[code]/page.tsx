import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { orgContact, OtherWaysToReach } from "@/components/layout/OrgContacts";
import { ReporterShell } from "@/components/layout/ReporterShell";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { RedactedText } from "@/components/ui/RedactedText";
import { formatDateLong } from "@/lib/format";
import { limitRequest } from "@/lib/rate-limit";
import { getPublicOrg } from "@/lib/orgs";
import { RATE_LIMITED_MESSAGE } from "@/lib/rate-limit-message";
import { formatReceiptCode, normalizeReceiptCode } from "@/lib/receipt-code";
import { loadReporterCase, safeDecode } from "@/lib/reporter-case";
import { RetestPanel } from "./RetestPanel";

// The reporter's own page for one report (docs/domain.md §3, §4), opened with the receipt code.
// GET only RENDERS: nothing about the case changes here, because email link scanners prefetch links.
// Answers are POSTs (a server action in RetestPanel). Unknown, malformed and expired codes are a 404.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your report",
  // The code is in this URL: never send it on as a referrer, never index the page.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ code: string }> };

export default async function ReportStatusPage({ params }: Props) {
  const normalized = normalizeReceiptCode(safeDecode((await params).code));
  if (!normalized) notFound();

  // Count every lookup of a well-formed code (the guessable kind) before it reaches the database.
  // An App Router page can't answer 429 (only proxy.ts could, and it stays free of the database), so the
  // calm message is the page itself.
  if (!(await limitRequest("receipt_view")).ok) return <TooManyTries />;

  const report = await loadReporterCase(normalized);
  if (!report) notFound();
  const code = formatReceiptCode(normalized);
  // The organization's public contact details (by the slug the code resolved to, never from the request): the
  // other ways to reach it, last on the page (Phase 7 T4.1).
  const org = await getPublicOrg(report.orgSlug);

  return (
    <ReporterShell orgName={report.orgName} orgSlug={report.orgSlug}>
      <PageHeader
        title="Your report"
        description={`This page shows where your report to ${report.orgName} is. The link has your code in it, so keep it private.`}
        meta={
          <>
            <span>
              Reference: <strong className="font-mono tracking-[0.04em] text-ink">{report.ref}</strong>
            </span>
            <span>
              Received <time dateTime={report.receivedAt.toISOString()}>{formatDateLong(report.receivedAt)}</time>
            </span>
          </>
        }
      />
      <RetestPanel
        code={code}
        orgSlug={report.orgSlug}
        status={report.status}
        closedReason={report.closedReason}
        wantsRetest={report.wantsRetest}
        offerText={report.status === "retest_open" ? report.retestOfferText : null}
        fixSection={
          report.fixDescription ? (
            <Card as="section" id="team-changed" title="What the team changed" titleLevel={2} padding="lg">
              <RedactedText text={report.fixDescription} />
            </Card>
          ) : null
        }
      />
      {org ? <OtherWaysToReach org={orgContact(org)} className="mt-[var(--stack-lg)]" /> : null}
    </ReporterShell>
  );
}

/** Over the limit: the same calm page whether or not the code exists (it was never looked up). */
function TooManyTries() {
  return (
    <ReporterShell>
      <PageHeader title="Please wait a few minutes" description={RATE_LIMITED_MESSAGE} />
      <p className="max-w-[var(--measure)]">Your report is safe. Nothing about it has changed.</p>
    </ReporterShell>
  );
}
