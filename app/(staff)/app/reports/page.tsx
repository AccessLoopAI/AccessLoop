import type { Metadata } from "next";
import Link from "next/link";
import { Globe, Plus } from "lucide-react";
import { ReportStateBadge } from "@/components/report/ReportStateBadge";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { CheckRing } from "@/components/ui/CheckRing";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { requireStaff } from "@/lib/auth/staff";
import { formatDate } from "@/lib/format";
import { listStaffReports } from "@/lib/report/access";
import { reportPeriodLabel } from "@/lib/report/period";
import { checksView, reportState } from "@/lib/report/view";

// Progress reports (docs/domain.md §7; CLAUDE.md "Routes": lead, auditor read-only; owners 404). The lead's header
// action is THE link named "New report" (demo.spec clicks it; no other link on the page may contain that name, so
// the empty state has no link of its own).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Progress reports" };

export default async function ReportsPage() {
  const staff = await requireStaff(["lead", "auditor"]);
  const rows = await listStaffReports(staff);
  const isLead = staff.role === "lead";

  return (
    <>
      <PageHeader
        title="Progress reports"
        description={
          <>
            Each draft is built from your case records for the period you choose. The Feedback section is counted from the
            records, every sentence links to the cases behind it, and the headings are checked against ACR s.14.{" "}
            {isLead ? "Nothing is public until you sign off and publish." : "Your role can read reports but not change them."}
          </>
        }
        actions={
          isLead ? (
            <ButtonLink href="/app/reports/new" iconStart={<Icon icon={Plus} />}>
              New report
            </ButtonLink>
          ) : null
        }
      />

      {rows.length === 0 ? (
        <EmptyState title="No reports yet">
          {isLead
            ? "When you build your first draft, it appears here. Drafts stay private until you sign off and publish."
            : "When the lead builds a draft, it appears here."}
        </EmptyState>
      ) : (
        <Table id="reports" caption="Progress reports" description={rows.length === 1 ? "1 report, newest first" : `${rows.length} reports, newest first`}>
          <THead>
            <Tr>
              <Th>Report</Th>
              <Th>Period</Th>
              <Th>Status</Th>
              <Th>Required checks</Th>
              <Th>Built</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => {
              const checks = checksView(r.headingCheck, []);
              const ok = checks.passes;
              return (
                <Tr key={r.id}>
                  <Th scope="row" className="min-w-[14rem]">
                    <Link href={`/app/reports/${r.id}`}>{r.title}</Link>
                  </Th>
                  <Td className="whitespace-nowrap">{reportPeriodLabel({ start: r.periodStart, end: r.periodEnd })}</Td>
                  <Td>
                    <ReportStateBadge state={reportState(r)} className="whitespace-nowrap" />
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <CheckRing state={ok ? "passed" : "missing"} className="al-check-ring-inline" />
                      {ok ? "All pass" : `${checks.failing} to fix`}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap text-small">
                    <time dateTime={r.createdAt.toISOString()}>{formatDate(r.createdAt)}</time>
                    {r.createdByName ? <span className="block text-ink-muted">by {r.createdByName}</span> : null}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}

      <p className="mt-8 max-w-[var(--measure)] text-small text-ink-muted">
        Published reports are on your{" "}
        <Link href={`/p/${staff.orgSlug}`} className="inline-flex items-center gap-1 font-bold">
          <Icon icon={Globe} size="1em" />
          <span>public accessibility feedback page</span>
        </Link>
        , with how to give feedback (ACR s.9).
      </p>
    </>
  );
}
