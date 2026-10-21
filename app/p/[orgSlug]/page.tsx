import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ReporterShell } from "@/components/layout/ReporterShell";
import { FeedbackProcessDescription } from "@/components/feedback-process/FeedbackProcessDescription";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatDateLong } from "@/lib/format";
import { getPublicOrg } from "@/lib/orgs";
import { limitRequest } from "@/lib/rate-limit";
import { RATE_LIMITED_MESSAGE } from "@/lib/rate-limit-message";
import { listPublishedReports } from "@/lib/report/access";
import { receivedPhrase } from "@/lib/report/view";

// An organization's public accessibility feedback page (CLAUDE.md "Routes"): the description of its feedback process
// from its settings (ACA s.70(1), ACR s.9: who receives feedback, every way to give it, anonymous allowed,
// acknowledgement) and its published progress reports. Public, rate-limited, org resolved by slug on the server.
// The description is components/feedback-process/FeedbackProcessDescription.tsx, which /app/settings previews.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ orgSlug: string }> };

/**
 * The rate limit, counted once per request and shared by the metadata and the page (React's request-scoped cache,
 * as getPublicOrg uses). Next always runs generateMetadata, so it checks first too: a client over the limit never
 * makes the request look the organization up.
 */
const allowed = cache(async () => (await limitRequest("public_report")).ok);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!(await allowed())) return { title: "Please wait a few minutes" };
  const org = await getPublicOrg((await params).orgSlug);
  return { title: org ? `${org.name}: accessibility feedback` : "Page not found" };
}

export default async function OrgFeedbackPage({ params }: Props) {
  if (!(await allowed())) return <TooManyTries />;
  const org = await getPublicOrg((await params).orgSlug);
  if (!org) notFound();
  const reports = await listPublishedReports(org.id);

  return (
    <ReporterShell orgName={org.name} orgSlug={org.slug} width="wide">
      <PageHeader
        title={`${org.name}: accessibility feedback`}
        description="How to tell us about a barrier, and what we did with the feedback we received."
      />
      <div className="grid gap-[var(--stack-lg)] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
        <FeedbackProcessDescription org={org} />

        <section aria-labelledby="progress-reports-title" className="grid gap-5">
          <h2 id="progress-reports-title">Progress reports</h2>
          {reports.length === 0 ? (
            <p className="text-ink-muted">No progress report has been published here yet.</p>
          ) : (
            <ul className="m-0 grid list-none gap-3 p-0">
              {reports.map((r) => (
                <li key={r.id} className="al-card rounded-lg border border-border bg-surface p-[var(--card-pad)]">
                  <Link href={`/p/${org.slug}/reports/${r.id}`} className="inline-flex min-h-11 items-center font-bold">
                    {r.title}
                  </Link>
                  <span className="mt-1 block text-small text-ink-muted">
                    Feedback received {receivedPhrase({ start: r.periodStart, end: r.periodEnd })}.
                    Published <time dateTime={r.publishedAt.toISOString()}>{formatDateLong(r.publishedAt)}</time>.
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-small text-ink-muted">
            Each report says how many pieces of feedback we received and what happened to them. Every sentence links to the
            records behind it, and anyone can check those records.
          </p>
        </section>
      </div>
    </ReporterShell>
  );
}

function TooManyTries() {
  return (
    <ReporterShell>
      <PageHeader title="Please wait a few minutes" description={RATE_LIMITED_MESSAGE} />
    </ReporterShell>
  );
}
