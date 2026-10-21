import type { Metadata } from "next";
import { orgContact, OtherWaysToReach } from "@/components/layout/OrgContacts";
import { ReporterShell } from "@/components/layout/ReporterShell";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { getPublicOrg } from "@/lib/orgs";
import { CheckForm } from "./CheckForm";

// Public: a reporter types their receipt code and lands on /r/{code} (docs/domain.md §4). The lookup is a POST
// (server action), rate-limited, and never logs the code. The form needs no account and no CAPTCHA.
// `?org={slug}` (the footer's "Check your report" on an organization's pages, the receipt, the calendar reminder)
// only names the organization the person came from, so the page can show its other ways to give feedback
// (Phase 7 T4.1). It is a public slug: it never decides which report a code opens.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Check your report",
  description: "Type your receipt code to see where your report is, or to tell the team if a fix works for you.",
};

type Props = { searchParams: Promise<{ org?: string | string[] }> };

export default async function CheckPage({ searchParams }: Props) {
  const slug = (await searchParams).org;
  const org = typeof slug === "string" ? await getPublicOrg(slug) : null;
  return (
    <ReporterShell orgName={org?.name} orgSlug={org?.slug}>
      <PageHeader
        title="Check your report"
        description="Type the receipt code you got when you sent your report. We will show you where your report is."
      />
      <div className="grid gap-[var(--stack-lg)]">
        <Card tone="raised" padding="lg" className="max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:p-0 max-sm:shadow-none">
          <CheckForm />
        </Card>
        <section aria-labelledby="lost-code" className="grid gap-4">
          <h2 id="lost-code">If you lost your code</h2>
          <p className="max-w-[var(--measure)]">
            We can&rsquo;t show your report without the code. That keeps it private. You can still call or write to
            {org ? ` ${org.name}` : " the organization you reported to"}, and give them your reference, like BAR-0017.
          </p>
          {org ? <OtherWaysToReach org={orgContact(org)} /> : null}
        </section>
      </div>
    </ReporterShell>
  );
}
