import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Search } from "lucide-react";
import { orgContact, OtherWaysToReach } from "@/components/layout/OrgContacts";
import { ReporterShell, orgQuery } from "@/components/layout/ReporterShell";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { RedactedText } from "@/components/ui/RedactedText";
import { formatDateLong } from "@/lib/format";
import { getPublicOrg, getPublicOrgById, type PublicOrg } from "@/lib/orgs";
import { limitRequest } from "@/lib/rate-limit";
import { RATE_LIMITED_MESSAGE } from "@/lib/rate-limit-message";
import { loadReporterCaseById } from "@/lib/reporter-case";
import { readRetestLink, retestLinkExpired, retestLinkSecret } from "@/lib/retest-link";
import { RetestPanel } from "../../[code]/RetestPanel";
import { answerRetestByLink } from "./actions";

// The page a re-test email's link opens (docs/archive/phase7-prompt.md T3 item 11; docs/domain.md §3, §4): the same view as
// /r/[code], opened by a one-round token (lib/retest-link.ts) instead of the receipt code. It answers the question of
// the round the email was about, and nothing else: no "Stop contact" form, no later round. GET only RENDERS (email
// link scanners open links); the answer is a POST. A token this server did not make is a 404 before the database is
// touched; an expired one, or one for an earlier round, gets a calm page that points to the receipt code and, as
// every page about one organization (domain §4, ACR s.9(3)), offers the other ways to reach it: the org of the
// link's MAC-checked claims (the email already named it), never one from the request.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your report",
  // The token is in this URL: never send the address to another site (same-origin, not no-referrer: a native form
  // POST under no-referrer carries `Origin: null`, which Next refuses; next.config.ts), and never index the page.
  referrer: "same-origin",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ token: string }> };

export default async function RetestLinkPage({ params }: Props) {
  const { token } = await params;
  const claims = readRetestLink(token, retestLinkSecret());
  if (!claims) notFound();
  if (retestLinkExpired(claims)) return <LinkEnded reason="expired" org={await getPublicOrgById(claims.orgId)} />;

  // Count every lookup a valid link makes (as /r/[code] does), before it reaches the database.
  if (!(await limitRequest("receipt_view")).ok) return <TooManyTries />;

  const report = await loadReporterCaseById({ orgId: claims.orgId, caseId: claims.caseId });
  if (!report) notFound();
  // A newer round has started since this email: its own email has its own link.
  if (report.retestRound !== claims.round) return <LinkEnded reason="later_round" org={await getPublicOrg(report.orgSlug)} />;
  // As on /r/[code] (Phase 7 T4.1): the organization's other ways to reach it, by the slug the token's case belongs
  // to (never from the request), last on the page; the footer links its feedback page.
  const org = await getPublicOrg(report.orgSlug);

  return (
    <ReporterShell orgName={report.orgName} orgSlug={report.orgSlug}>
      <PageHeader
        title="Your report"
        description={`This page shows where your report to ${report.orgName} is, and asks if the fix works for you. It opened from the link in our email, so keep that email private.`}
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
        link={{ token, action: answerRetestByLink }}
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

/** The link is ours but no longer opens anything. It never says more about the report than the email did. */
function LinkEnded({ reason, org }: { reason: "expired" | "later_round"; org: PublicOrg | null }) {
  return (
    <ReporterShell orgName={org?.name} orgSlug={org?.slug}>
      <PageHeader
        title="This link no longer works"
        description={
          reason === "expired"
            ? "The link in our email works for 30 days at most, and that time has passed."
            : "This link was for an earlier check of the fix. A newer email has a new link."
        }
      />
      <div className="grid justify-items-start gap-4">
        <p className="max-w-[var(--measure)]">
          Your report is safe. Nothing about it has changed. You can still see it, and answer, with your receipt code.
        </p>
        <ButtonLink href={`/check${orgQuery(org?.slug)}`} variant="secondary" iconStart={<Icon icon={Search} />}>
          Check your report with your code
        </ButtonLink>
      </div>
      {org ? <OtherWaysToReach org={orgContact(org)} className="mt-[var(--stack-lg)]" /> : null}
    </ReporterShell>
  );
}

/** Over the limit: the same calm page /r/[code] shows (the case was not looked up). */
function TooManyTries() {
  return (
    <ReporterShell>
      <PageHeader title="Please wait a few minutes" description={RATE_LIMITED_MESSAGE} />
      <p className="max-w-[var(--measure)]">Your report is safe. Nothing about it has changed.</p>
    </ReporterShell>
  );
}
