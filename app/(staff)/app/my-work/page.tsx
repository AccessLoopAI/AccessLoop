import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import { withOrg } from "@/db/tenant";
import { caseEvents, cases } from "@/db/schema";
import { DueDate } from "@/components/ui/DueDate";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { requireStaff } from "@/lib/auth/staff";
import { caseSummaryCell } from "@/lib/cases/summary";
import { AWAITING_REDACTION_REVIEW, caseTextVisible } from "@/lib/cases/visibility";
import { formatDate } from "@/lib/format";
import { dueState, pastDue } from "@/lib/metrics/queue";
import { AREA_HEADINGS } from "@/lib/report/headings";
import type { CaseStatus } from "@/lib/status";

// The cases assigned to the signed-in member (owners, and leads for their own): every open one, plus the ones
// fixed or verified in the last 30 days. A <table> with <th scope>, never a board (CLAUDE.md). Owners see only
// approved, redacted text (assignment needs triage, which needs the redaction review). Cases that need a fix come
// first, the soonest due (the overdue ones) at the top (decision D8: lib/metrics/queue.ts is the one "overdue").
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My work" };

const RECENT_DAYS = 30;

/** Cases that need this person first. */
const ORDER: Record<CaseStatus, number> = {
  assigned: 0,
  retest_open: 1,
  fixed_unverified: 2,
  verified: 3,
  triaged: 4,
  new: 5,
  closed: 6,
};

export default async function MyWorkPage() {
  const staff = await requireStaff(["owner", "lead"]);
  const rows = await withOrg({ orgId: staff.orgId, role: staff.role }, async (tx) => {
    const mine = await tx
      .select({
        id: cases.id,
        ref: cases.ref,
        status: cases.status,
        priorityArea: cases.priorityArea,
        summary: cases.summary,
        summarySource: cases.summarySource,
        aiSummary: cases.aiSummary,
        redactedText: cases.redactedText,
        redactionApprovedAt: cases.redactionApprovedAt,
        seq: cases.seq,
        dueAt: cases.dueAt,
      })
      .from(cases)
      .where(
        and(
          eq(cases.orgId, staff.orgId),
          eq(cases.assignedTo, staff.memberId),
          or(inArray(cases.status, ["assigned", "retest_open", "fixed_unverified"]), and(eq(cases.status, "verified"), gt(cases.verifiedAt, sql`now() - ${sql.raw(`interval '${RECENT_DAYS} days'`)}`))),
        ),
      );
    if (mine.length === 0) return [];
    // "Assigned on": the latest assignment of each case to this member (the evidence chain, not a projection).
    const assigned = await tx
      .select({ caseId: caseEvents.caseId, at: sql<Date>`max(${caseEvents.createdAt})`.mapWith((v) => new Date(v)) })
      .from(caseEvents)
      .where(
        and(
          eq(caseEvents.orgId, staff.orgId),
          eq(caseEvents.type, "assigned"),
          inArray(caseEvents.caseId, mine.map((c) => c.id)),
          sql`${caseEvents.payload}->>'memberId' = ${staff.memberId}`,
        ),
      )
      .groupBy(caseEvents.caseId);
    const at = new Map(assigned.map((a) => [a.caseId, a.at]));
    // Among the cases that need a fix, a due date comes first, the soonest at the top; only an assigned case's due
    // date counts (after a fix is logged it is history).
    const due = (c: { status: CaseStatus; dueAt: Date | null }) => (c.status === "assigned" && c.dueAt ? c.dueAt.getTime() : Infinity);
    return mine
      .map((c) => ({ ...c, assignedAt: at.get(c.id) ?? null }))
      .sort(
        (a, b) =>
          ORDER[a.status] - ORDER[b.status] ||
          due(a) - due(b) ||
          (b.assignedAt?.getTime() ?? 0) - (a.assignedAt?.getTime() ?? 0) ||
          b.seq - a.seq,
      );
  });

  const now = new Date();
  const open = rows.filter((r) => r.status === "assigned").length;
  const overdue = rows.filter((r) => pastDue(r.status, r.dueAt, now)).length;
  const overdueWords = overdue === 0 ? "" : overdue === 1 ? " 1 is overdue." : ` ${overdue} are overdue.`;

  return (
    <>
      <PageHeader
        title="My work"
        description="The cases you are asked to fix. You see them with names and contact details removed."
      />
      {rows.length === 0 ? (
        <EmptyState title="Nothing is assigned to you right now">
          When the feedback lead assigns a case to you, it appears here with what was reported and where. After you fix it,
          you log what you changed on the case page, and the person who reported it is asked to check.
        </EmptyState>
      ) : (
        <Table
          id="my-work-cases"
          caption="Cases assigned to you"
          description={`${rows.length === 1 ? "1 case" : `${rows.length} cases`}, ${open === 1 ? "1 needs" : `${open} need`} a fix.${overdueWords} Cases that need a fix come first, the soonest due at the top.`}
        >
          <THead>
            <Tr>
              <Th>Reference</Th>
              <Th className="sm:w-2/5">Summary</Th>
              <Th>Area</Th>
              <Th className="hidden sm:table-cell">Status</Th>
              <Th>Due</Th>
              <Th>Assigned on</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((c) => {
              const cell = caseSummaryCell(c);
              return (
                // Phones: a tall row reads from its top (the status heads the summary there), not from its middle.
                <Tr key={c.ref} className="max-sm:align-top">
                  <Th scope="row">
                    <Link href={`/app/cases/${c.ref}`} className="inline-flex min-h-11 items-center whitespace-nowrap font-mono">
                      {c.ref}
                    </Link>
                  </Th>
                  {/* The Summary header takes 40% of the width, so the sentences get the spare space (not the Area), and the
                      status and due date keep room to stay on one or two lines. */}
                  <Td className="min-w-[min(15rem,calc(100vw_-_9.25rem))] sm:min-w-[18rem]">
                    {/* Phones: the status heads the summary (the Status column is hidden below sm). */}
                    <span className="mb-1.5 flex sm:hidden">
                      <StatusBadge status={c.status} copy />
                    </span>
                    {caseTextVisible(staff.role, c) ? (
                      <>
                        <span className="block">{cell.text}</span>
                        {cell.source ? <span className="mt-0.5 block text-small text-ink-muted">{cell.source}</span> : null}
                      </>
                    ) : (
                      <span className="block text-ink-muted">{AWAITING_REDACTION_REVIEW}</span>
                    )}
                  </Td>
                  <Td className="min-w-[10rem]">{c.priorityArea ? AREA_HEADINGS[c.priorityArea].canonical : "Not set"}</Td>
                  <Td className="hidden sm:table-cell">
                    <StatusBadge status={c.status} />
                  </Td>
                  <Td className="min-w-[9rem]">
                    {c.status === "assigned" ? (
                      c.dueAt ? (
                        <DueDate state={dueState(c.status, c.dueAt, now)} />
                      ) : (
                        <span className="text-ink-muted">No due date</span>
                      )
                    ) : (
                      <span className="text-ink-muted">Fix logged</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {c.assignedAt ? <time dateTime={c.assignedAt.toISOString()}>{formatDate(c.assignedAt)}</time> : "Not known"}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </>
  );
}
