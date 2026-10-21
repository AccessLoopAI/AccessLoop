import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { orgContact, OtherWaysToReach } from "@/components/layout/OrgContacts";
import { ReporterShell } from "@/components/layout/ReporterShell";
import { Notice } from "@/components/ui/Notice";
import { findReportLocation } from "@/lib/locations/store";
import { telHref } from "@/lib/org-settings";
import { getPublicOrg } from "@/lib/orgs";
import { aiWhereSentence } from "@/lib/public-info/ai-where";
import { describeThisCopy } from "@/lib/public-info/this-copy";
import { ReportFlow } from "./ReportFlow";

// Public reporter form (docs/domain.md §4). No account, no CAPTCHA, no time limit, anonymous by default.
// ?loc={locationId} (a location poster's QR code, Phase 7 T4.5): "Where did it happen?" starts filled in from that
// location, looked up ONLY inside the org of this slug (and only while it is in use); anything else is ignored and the
// form starts empty. The location never decides the org, and the person can change the answers.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ orgSlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const org = await getPublicOrg((await params).orgSlug);
  return { title: org ? `Report a barrier to ${org.name}` : "Page not found" };
}

export default async function ReportPage({ params, searchParams }: Props) {
  const org = await getPublicOrg((await params).orgSlug);
  if (!org) notFound();
  // A pre-fill is a convenience: if it can't be read, the form starts empty and still works.
  const poster = await findReportLocation(org.id, (await searchParams).loc).catch((err: unknown) => {
    console.error(`[report] could not read a poster location (${err instanceof Error ? err.name : "UnknownError"})`);
    return null;
  });

  return (
    <ReporterShell orgName={org.name} orgSlug={org.slug}>
      {/* ReportFlow renders the page header: a short h1 (the organization is in the header above it and in the page
          title) with the introduction on step 1 only, so on a phone each later step's question starts near the top
          of the screen. The noscript notice comes right after the header. */}
      <ReportFlow
        orgSlug={org.slug}
        orgName={org.name}
        poster={poster}
        // Wave 4 item 1: where the words go when AI is on, for this copy's AI setting at request time (in words only).
        aiWhere={aiWhereSentence(describeThisCopy())}
        // Phase 7 T4.1: "Other ways to reach {org}" under the form on every step (rendered here, passed as a slot).
        otherWays={<OtherWaysToReach org={orgContact(org)} />}
        noscript={
          // ACR s.9(3): the other ways to give feedback, with this organization's own details (never in a URL query).
          <noscript>
            <Notice tone="warning" title="This form needs JavaScript" className="mb-6">
              <p>
                If you can&rsquo;t turn JavaScript on, you can give feedback to {org.name} another way. Ask for the{" "}
                {org.feedbackDesignateTitle}.
              </p>
              <dl className="mt-3 grid items-baseline gap-x-4 gap-y-2 sm:grid-cols-[max-content_minmax(0,1fr)]">
                <dt className="font-bold">Phone</dt>
                <dd className="m-0">
                  <a href={telHref(org.contactPhone)} className="inline-flex min-h-11 items-center">
                    {org.contactPhone}
                  </a>
                </dd>
                <dt className="font-bold">Email</dt>
                <dd className="m-0 wrap-anywhere">
                  <a href={`mailto:${org.contactEmail}`} className="inline-flex min-h-11 max-w-full items-center">
                    {org.contactEmail}
                  </a>
                </dd>
                <dt className="font-bold">Mail</dt>
                <dd className="m-0 whitespace-pre-line">{org.contactMailingAddress}</dd>
              </dl>
            </Notice>
          </noscript>
        }
      />
    </ReporterShell>
  );
}
