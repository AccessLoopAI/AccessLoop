import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowRight, CalendarPlus, Download, PenLine, Search } from "lucide-react";
import { cases } from "@/db/schema";
import { resolveReceipt, withOrg } from "@/db/tenant";
import { OrgContactList, orgContact, OtherWaysToReach } from "@/components/layout/OrgContacts";
import { orgQuery, ReporterShell } from "@/components/layout/ReporterShell";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { CodeDisplay } from "@/components/ui/CodeDisplay";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { LoopTimeline, loopState } from "@/components/ui/Timeline";
import { absoluteUrl } from "@/lib/app-url";
import { RECEIPT_COOKIE, reportPath } from "@/lib/intake/receipt-cookie";
import { dataUrl, receiptTextFile, reminderCalendar, REMINDER_DAYS, spellCode } from "@/lib/intake/receipt-extras";
import { getPublicOrg, type PublicOrg } from "@/lib/orgs";
import { limitRequest } from "@/lib/rate-limit";
import { RATE_LIMITED_MESSAGE } from "@/lib/rate-limit-message";
import { formatReceiptCode, hashReceiptCode, normalizeReceiptCode } from "@/lib/receipt-code";
import { CopyCodeButton } from "./CopyCodeButton";
import { PrintReceiptButton } from "./PrintReceiptButton";
import { ReceiptSeen } from "./ReceiptSeen";

// The on-screen acknowledgement of a web report (ACR s.9(4), domain §4). The receipt code arrives in a
// short-lived httpOnly cookie scoped to this path, never in the URL, and is shown ONCE: as soon as the page is on
// screen it clears the cookie (ReceiptSeen; Phase 7 T3.10). A code of another org is a 404. The safeguards for
// keeping the code (Phase 7 T4.4): copy (without hyphens), a text file, print, and a calendar reminder that links to
// /check and never holds the code.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your receipt" };

type Props = { params: Promise<{ orgSlug: string }> };

const CODE_ELEMENT_ID = "receipt-code-value";

/** The code and case ref behind the cookie, or null when there is no usable cookie. */
async function loadReceipt(org: PublicOrg, cookieValue: string | undefined) {
  const normalized = cookieValue ? normalizeReceiptCode(cookieValue) : null;
  const hash = normalized ? hashReceiptCode(normalized) : null;
  if (!normalized || !hash) return null;
  const found = await resolveReceipt(hash);
  if (!found) return null;
  if (found.orgId !== org.id) notFound(); // e.g. a Maple Harbour code in a Lakeview context
  const [row] = await withOrg({ orgId: org.id, role: "reporter" }, (tx) =>
    tx
      .select({ ref: cases.ref })
      .from(cases)
      .where(and(eq(cases.id, found.caseId), eq(cases.orgId, org.id)))
      .limit(1),
  );
  return row ? { code: formatReceiptCode(normalized), ref: row.ref } : null;
}

export default async function ReceiptPage({ params }: Props) {
  const org = await getPublicOrg((await params).orgSlug);
  if (!org) notFound();

  const cookieValue = (await cookies()).get(RECEIPT_COOKIE)?.value;
  // A well-formed code in the cookie is looked up, so it is counted first, like /r/[code] (a forged cookie could
  // be used to guess codes). No cookie, or a malformed one, is never looked up and never counted.
  if (cookieValue && normalizeReceiptCode(cookieValue) && !(await limitRequest("receipt_page")).ok) {
    return <TooManyTries org={org} />;
  }
  const receipt = await loadReceipt(org, cookieValue);
  if (!receipt) return <NoReceipt org={org} />;
  const { code, ref } = receipt;
  const checkUrl = absoluteUrl(`/check${orgQuery(org.slug)}`);
  const [sayFirst, saySecond] = spellCode(code);
  const textFile = receiptTextFile({ orgName: org.name, ref, code, checkUrl, reportUrl: absoluteUrl(`/r/${code}`) });
  const reminder = reminderCalendar({ orgName: org.name, ref, checkUrl, now: new Date(), uid: randomUUID() });

  return (
    <ReporterShell orgName={org.name} orgSlug={org.slug}>
      <ReceiptSeen orgSlug={org.slug} />
      <PageHeader
        title="We got your report"
        focusOnMount
        description={`Thank you for telling ${org.name}. Your report is with their accessibility team now.`}
      />

      <div className="grid gap-[var(--stack-lg)]">
        <div className="grid gap-5">
          <CodeDisplay
            code={code}
            label="Your receipt code"
            data-testid="receipt-code"
            codeId={CODE_ELEMENT_ID}
            halves
            reading={
              <p>
                <span className="font-bold text-ink">Spelled out: </span>
                <span className="block">{sayFirst};</span>
                <span className="block">then {saySecond}.</span>
              </p>
            }
          >
            <CopyCodeButton code={code} codeElementId={CODE_ELEMENT_ID}>
              <ButtonLink
                href={dataUrl("text/plain", textFile)}
                download={`accessloop-receipt-${ref}.txt`}
                variant="secondary"
                iconStart={<Icon icon={Download} />}
              >
                Download as a text file
              </ButtonLink>
              <PrintReceiptButton />
              <ButtonLink
                href={dataUrl("text/calendar", reminder)}
                download={`accessloop-reminder-${ref}.ics`}
                variant="secondary"
                iconStart={<Icon icon={CalendarPlus} />}
              >
                Add a reminder to my calendar
              </ButtonLink>
            </CopyCodeButton>
          </CodeDisplay>
          <div className="grid gap-2">
            <p className="max-w-[var(--measure)] font-bold">
              Keep this code. It is the only way to check your report or confirm a fix if you stay anonymous.
            </p>
            <p className="max-w-[var(--measure)]">
              For your privacy, this page shows your code only once. If you leave or reload it, the code is not shown
              again, so save it now. The calendar reminder is for {REMINDER_DAYS} days from now and does not have
              your code in it.
            </p>
          </div>
          <div className="grid gap-1">
            <p>
              Reference: <strong data-testid="case-ref" className="font-mono tracking-[0.04em]">{ref}</strong>
            </p>
            <p className="max-w-[var(--measure)] text-small text-ink-muted">
              The reference is not secret. You can give it if you call {org.name} about your report. Keep your code to
              yourself.
            </p>
          </div>
        </div>

        {/* A new case: the reporter's own step (sending) is done; the team's step is next. */}
        <section aria-labelledby="what-next" className="grid gap-5">
          <h2 id="what-next">What happens next</h2>
          <LoopTimeline wording="reporter" {...loopState("new", "reporter")!} />
        </section>

        <section aria-labelledby="check-later" className="grid gap-4">
          <h2 id="check-later">Check on your report later</h2>
          <p className="max-w-[var(--measure)]">
            Your report page shows where things are. When a fix is ready, you can tell us there if it works for you.
            The link has your code in it, so keep it private too.
          </p>
          <p data-print-hide>
            <a href={`/r/${code}`} className="inline-flex min-h-11 items-center gap-2 font-bold">
              <span>Open your report page</span>
              <Icon icon={ArrowRight} />
            </a>
          </p>
          <p className="max-w-[var(--measure)]">
            On another device, go to <a href={`/check${orgQuery(org.slug)}`}>the Check your report page</a> and type
            your code.
          </p>
          {/* On paper the links can't be followed: print where the Check page is. */}
          <p className="al-print-only">Check your report: {checkUrl}</p>
        </section>

        <div data-print-hide>
          <OtherWaysToReach org={orgContact(org)} />
        </div>
        <section aria-labelledby="print-other-ways" className="al-print-only">
          <h2 id="print-other-ways">Other ways to reach {org.name}</h2>
          <OrgContactList org={orgContact(org)} />
        </section>
      </div>
    </ReporterShell>
  );
}

/**
 * Over the limit: the code was not looked up, so this page can't say anything about it. The cookie lasts only 2
 * minutes, so a reload may no longer find it: the page says so, and says how else to reach the organization.
 */
function TooManyTries({ org }: { org: PublicOrg }) {
  return (
    <ReporterShell orgName={org.name} orgSlug={org.slug}>
      <PageHeader title="Please wait a few minutes" description={RATE_LIMITED_MESSAGE} />
      <div className="grid gap-[var(--stack)]">
        <p className="max-w-[var(--measure)]">
          If you just sent a report, it is safe. Try reloading this page in a minute to see your receipt code. For your
          privacy, this page can show it only in the first 2 minutes after you send. If you added your email, the code
          is also in the email we sent you.
        </p>
        <OtherWaysToReach org={orgContact(org)} />
      </div>
    </ReporterShell>
  );
}

/** No code to show (the page was opened directly, reloaded after the code was shown, or the cookie expired). */
function NoReceipt({ org }: { org: PublicOrg }) {
  return (
    <ReporterShell orgName={org.name} orgSlug={org.slug}>
      <PageHeader
        title="Your receipt"
        description="This page shows your code right after you send a report. For your privacy, it shows it only once."
      />
      <div className="grid gap-[var(--stack)]">
        <p className="max-w-[var(--measure)]">
          If you sent a report before, use the code you saved to check on it. If you want to tell {org.name} about a
          barrier, you can start a new report.
        </p>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href={reportPath(org.slug)} iconStart={<Icon icon={PenLine} />}>
            Report a barrier
          </ButtonLink>
          <ButtonLink href={`/check${orgQuery(org.slug)}`} variant="secondary" plain iconStart={<Icon icon={Search} />}>
            Check a report with your code
          </ButtonLink>
        </div>
        <OtherWaysToReach org={orgContact(org)} />
      </div>
    </ReporterShell>
  );
}
