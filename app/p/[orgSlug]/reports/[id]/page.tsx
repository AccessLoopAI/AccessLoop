import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft, Download, FileBraces, ShieldCheck } from "lucide-react";
import { ReporterShell } from "@/components/layout/ReporterShell";
import { LeadText, ReportBody } from "@/components/report/ReportBody";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { HashChip } from "@/components/ui/HashChip";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { absoluteUrl } from "@/lib/app-url";
import { formatDateLong } from "@/lib/format";
import { limitRequest } from "@/lib/rate-limit";
import { RATE_LIMITED_MESSAGE } from "@/lib/rate-limit-message";
import { loadPublishedReport } from "@/lib/report/access";
import { leadPrompt, leadTextFor } from "@/lib/report/compose";
import { evidenceBundlePath, SIGNING_KEYS_PATH } from "@/lib/report/labels";
import { readSigning } from "@/lib/report/signing";
import { exportBlockers } from "@/lib/report/validate";
import { receivedPhrase, reportView } from "@/lib/report/view";

// A published progress report (docs/domain.md §7 step 9; ACR s.15(1)(a): the page itself must meet WCAG AA).
// Signed off AND published only, otherwise 404 (an unknown slug, another org's id, a draft, a signed-off report not
// yet published). Semantic HTML, the same footnote source buttons as the draft (refs as plain text, never links into
// staff pages), print CSS, the fingerprint and a link to the public evidence check. Never staff names: the report
// says who receives feedback by position title (ACR s.9(1)). The footer also shows the signed fingerprint (the root
// signed at sign-off, docs/domain.md §8) and "Download evidence bundle" (lib/report/bundle.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ orgSlug: string; id: string }> };

/**
 * The rate limit, counted once per request and shared by the metadata and the page (React's request-scoped cache,
 * as loadPublishedReport uses). Next always runs generateMetadata, so it checks first too: a client over the limit
 * never makes the request load the report.
 */
const allowed = cache(async () => (await limitRequest("public_report")).ok);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!(await allowed())) return { title: "Please wait a few minutes" };
  const { orgSlug, id } = await params;
  const found = await loadPublishedReport(orgSlug, id);
  return { title: found ? `${found.report.title}: ${found.org.name}` : "Page not found" };
}

export default async function PublishedReportPage({ params }: Props) {
  if (!(await allowed())) return <TooManyTries />;
  const { orgSlug, id } = await params;
  const found = await loadPublishedReport(orgSlug, id);
  if (!found) notFound();
  const { org, report } = found;
  const view = reportView(report.content, report.snapshot);
  const canDownload = exportBlockers(report.content).length === 0;
  const signing = readSigning(report.content);

  return (
    <ReporterShell orgName={org.name} orgSlug={org.slug} width="wide">
      <p className="mb-4" data-print-hide>
        <Link href={`/p/${org.slug}`} className="inline-flex min-h-11 items-center gap-1.5 font-bold">
          <Icon icon={ArrowLeft} size="1em" />
          <span>{org.name}: accessibility feedback</span>
        </Link>
      </p>
      <article className="al-sheet al-sheet-public">
        <PageHeader
          className="al-report-cover"
          eyebrow={report.content.settings.orgName}
          title={report.title}
          meta={
            <>
              <span>Feedback received {receivedPhrase(report.snapshot.period)}</span>
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
        />
        <ReportBody view={view} lead={(s) => <LeadText text={leadTextFor(s.key, report.areaText, report.consultationsText)} hint={leadPrompt(s.key)} draft={false} />} />

        <footer className="al-report-footer">
          <p className="font-bold">Check the evidence</p>
          <p className="max-w-[var(--report-measure)]">
            Every number in this report was counted from {org.name}&rsquo;s case records, and each record&rsquo;s history is
            sealed with a chain of fingerprints. The evidence check recomputes them, so anyone can see that nothing changed.
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>Fingerprint of this report (SHA-256)</span>
            <HashChip hash={report.manifestHash} label="Fingerprint of this report (SHA-256)" length={16} />
          </p>
          {signing ? (
            <>
              <p className="max-w-[var(--report-measure)]">
                When {org.name} signed this report off, AccessLoop sealed it together with every case history of{" "}
                {org.name} at that moment and signed the seal. The organization gives this signed fingerprint to the
                regulator, so anyone can check later that no record was rewritten. The signature can be checked with{" "}
                <a href={SIGNING_KEYS_PATH}>AccessLoop&rsquo;s published signing keys</a>.
              </p>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="signed-fingerprint">
                <span>Signed fingerprint (Ed25519, key {signing.keyId})</span>
                <HashChip hash={signing.root} label="Signed fingerprint" length={16} />
              </p>
            </>
          ) : null}
          <div className="flex flex-wrap gap-3" data-print-hide>
            <ButtonLink href={`/verify/${report.id}`} variant="secondary" iconStart={<Icon icon={ShieldCheck} />}>
              Verify evidence chain
            </ButtonLink>
            {canDownload ? (
              <ButtonLink href={`/p/${org.slug}/reports/${report.id}/text`} download variant="quiet" iconStart={<Icon icon={Download} />}>
                Download as plain text
              </ButtonLink>
            ) : null}
            <ButtonLink href={evidenceBundlePath(org.slug, report.id)} download variant="quiet" iconStart={<Icon icon={FileBraces} />}>
              Download evidence bundle
            </ButtonLink>
          </div>
          <p className="al-print-only">
            Evidence check: {absoluteUrl(`/verify/${report.id}`)}. Fingerprint (SHA-256): {report.manifestHash}
            {signing ? `. Signed fingerprint (Ed25519, key ${signing.keyId}): ${signing.root}` : ""}
          </p>
        </footer>
      </article>
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
