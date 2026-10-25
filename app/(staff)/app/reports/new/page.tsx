import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireStaff } from "@/lib/auth/staff";
import { isIsoDate, zonedDate } from "@/lib/dates";
import { NewReportForm } from "./NewReportForm";

// A new draft progress report (lead only; docs/domain.md §7). `?start=&end=` may prefill the dates (only real
// YYYY-MM-DD dates are used; the dashboard's report-readiness card links here with its period). The default is this
// calendar year, Toronto time, so the title reads "Accessibility progress report 2026, version N".
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "New progress report" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (v: string | string[] | undefined) => (typeof v === "string" && isIsoDate(v) ? v : null);

export default async function NewReportPage({ searchParams }: Props) {
  await requireStaff(["lead"]);
  const q = await searchParams;
  const year = zonedDate(new Date()).slice(0, 4);
  const defaults = { start: one(q.start) ?? `${year}-01-01`, end: one(q.end) ?? `${year}-12-31` };

  const steps: [string, string][] = [
    ["Freeze the records", "Every case received in the period, rebuilt from its history, is copied into the draft with a fingerprint. Spam is left out."],
    ["Count from the records", "The numbers come from the same functions as your dashboard. AI never writes a number."],
    ["Word the sentences", "Each fact becomes a plain sentence. If AI rewords one, it must keep every number and cite its records, or the plain template is used."],
    ["Check the headings", "General, one heading per area of your plan, Consultations and Feedback (ACR s.14), checked as you write."],
  ];

  return (
    <>
      <p className="mb-4">
        <Link href="/app/reports" className="inline-flex min-h-11 items-center gap-1.5 font-bold">
          <Icon icon={ArrowLeft} size="1em" />
          <span>All progress reports</span>
        </Link>
      </p>
      <PageHeader
        title="New progress report"
        description="Choose the period. AccessLoop drafts the report from your records; you then write your progress for each area and how you consulted persons with disabilities, sign off and publish."
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,48rem)_minmax(16rem,22rem)] lg:items-start lg:gap-10">
        <div className="min-w-0">
          <NewReportForm defaults={defaults} />
        </div>
        <Card as="section" id="how-built" title="How the draft is built" tone="inset">
          <ol className="al-steps m-0 grid list-none gap-4 p-0">
            {steps.map(([title, text]) => (
              <li key={title} className="al-step">
                <span className="block font-bold">{title}</span>
                <span className="block text-small text-ink-muted">{text}</span>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-small text-ink-muted">Nothing is public until you sign off and publish. A new draft never changes an older one.</p>
        </Card>
      </div>
    </>
  );
}
