import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { withOrg } from "@/db/tenant";
import { cases, orgMembers } from "@/db/schema";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { DueDate } from "@/components/ui/DueDate";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterSummary } from "@/components/ui/FilterSummary";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import { requireStaff } from "@/lib/auth/staff";
import {
  INBOX_PAGE_SIZE,
  INBOX_SORT_WORDS,
  inboxPage,
  inboxQueryHref,
  matchesSearch,
  pageRows,
  parseInboxQuery,
  sortInboxRows,
} from "@/lib/cases/inbox-query";
import { INTAKE_CHANNEL_LABELS, LOCATION_KIND_LABELS } from "@/lib/cases/labels";
import { caseSummaryCell } from "@/lib/cases/summary";
import { AWAITING_REDACTION_REVIEW, caseTextVisible } from "@/lib/cases/visibility";
import { formatDate } from "@/lib/format";
import {
  ageInDays,
  ageLabel,
  applyInboxFilter,
  describeInboxFilter,
  dueState,
  isFilterActive,
  parseInboxFilter,
} from "@/lib/metrics";
import { loadMetricCasesTx } from "@/lib/metrics/load";
import { AREA_HEADINGS } from "@/lib/report/headings";
import { InboxForm } from "./InboxForm";

// Lead and auditor only (owners get 404). Every case of the signed-in org, 50 to a page; each ref opens the case
// page, where the actions live. The GET form (./InboxForm.tsx) searches (reference, public summary, the summary
// shown) and filters by status, area, assignee, channel and age, and sorts by received date, age or due date. The
// filter query params (status, area, channel, month, attention, and the rest of lib/metrics/filters.ts) select
// exactly the cases behind a dashboard number: the same predicates lib/metrics counts with, over the same replayed
// events. Invalid values are ignored; the org always comes from the session.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Inbox" };

const plural = (n: number) => (n === 1 ? "1 case" : `${n} cases`);

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff(["lead", "auditor"]);
  const params = await searchParams;
  const filter = parseInboxFilter(params);
  const query = parseInboxQuery(params);
  const filtered = isFilterActive(filter);
  const now = new Date();

  const { rows, matching, members } = await withOrg({ orgId: staff.orgId, role: staff.role }, async (tx) => {
    const rows = await tx
      .select({
        id: cases.id,
        ref: cases.ref,
        seq: cases.seq,
        status: cases.status,
        intakeChannel: cases.intakeChannel,
        locationKind: cases.locationKind,
        summary: cases.summary,
        summarySource: cases.summarySource,
        aiSummary: cases.aiSummary,
        redactedText: cases.redactedText,
        redactionApprovedAt: cases.redactionApprovedAt,
        receivedAt: cases.receivedAt,
        priorityArea: cases.priorityArea,
        publicSummary: cases.publicSummary,
        assignedTo: cases.assignedTo,
        dueAt: cases.dueAt,
      })
      .from(cases)
      .where(eq(cases.orgId, staff.orgId))
      .orderBy(desc(cases.receivedAt), desc(cases.seq));
    const members = await tx
      .select({ id: orgMembers.id, displayName: orgMembers.displayName, role: orgMembers.role })
      .from(orgMembers)
      .where(eq(orgMembers.orgId, staff.orgId));
    if (!filtered) return { rows, matching: null, members };
    const ids = applyInboxFilter(await loadMetricCasesTx(tx, staff.orgId), filter, now);
    return { rows, matching: new Set(ids), members };
  });

  const names = new Map(members.map((m) => [m.id, m.displayName]));
  // The people a case can be assigned to (owners, then leads), as the case page lists them.
  const assignable = members
    .filter((m) => m.role === "owner" || m.role === "lead")
    .sort((a, b) => (a.role === b.role ? a.displayName.localeCompare(b.displayName) : a.role === "owner" ? -1 : 1));

  const searched = query.q !== "";
  const narrowed = filtered || searched;
  const shown = sortInboxRows(
    rows.filter((r) => {
      if (matching && !matching.has(r.id)) return false;
      if (!searched) return true;
      // Only words this viewer can see are searched (an auditor never sees an unreviewed report's words).
      const shownText = caseTextVisible(staff.role, r) ? caseSummaryCell(r).text : null;
      return matchesSearch({ ref: r.ref, publicSummary: r.publicSummary, shownText }, query.q);
    }),
    query.sort,
  );
  const page = inboxPage(shown.length, query.page);
  const onPage = pageRows(shown, page);

  const matchLine = `${shown.length} of ${plural(rows.length)}`;
  const pageWords = page.pages > 1 ? `, ${page.first} to ${page.last} on this page` : "";
  const count = narrowed
    ? `${matchLine} match${pageWords}, ${INBOX_SORT_WORDS[query.sort]}`
    : `${plural(rows.length)}${pageWords}, ${INBOX_SORT_WORDS[query.sort]}`;
  const filterLines = [
    ...(searched ? [`Search: “${query.q}”`] : []),
    ...describeInboxFilter(filter, { memberName: (id) => names.get(id) ?? null }),
  ];
  const pageHref = (n: number) => inboxQueryHref(filter, { ...query, page: n });

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Every piece of feedback your organization has received. Names and contact details are removed."
      />

      {/* Keyed by the search and filters: after "Clear filters" or a dashboard link (a client-side navigation that
          keeps this component), the fields show the new URL, not what was typed before. */}
      {rows.length > 0 ? (
        <InboxForm key={inboxQueryHref(filter, { q: query.q, sort: query.sort })} filter={filter} query={query} members={assignable} />
      ) : null}

      {narrowed && rows.length > 0 ? (
        <FilterSummary
          id="inbox-filters"
          className="mb-6"
          summary={`${matchLine} match all of these:`}
          items={filterLines}
          clearHref="/app/inbox"
        />
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No cases yet"
          action={
            <ButtonLink href={`/o/${staff.orgSlug}/report`} variant="secondary" plain>
              Open your public form
            </ButtonLink>
          }
        >
          When someone reports a barrier on your public form, or staff log one from a phone call, a letter or an
          email, it shows up here.
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState title="No cases match these filters">
          {searched
            ? "Nothing in your inbox matches the search and every filter above. Check the spelling, try a reference such as BAR-0012, or clear the filters to see every case."
            : "Nothing in your inbox matches every filter above. Clear the filters to see every case."}
        </EmptyState>
      ) : (
        <>
          <Table id="inbox-cases" caption="Cases received" description={count}>
            <THead>
              <Tr>
                <Th>Reference</Th>
                <Th>Summary</Th>
                <Th>Area</Th>
                <Th>Assigned to</Th>
                <Th>Age</Th>
                <Th>Where</Th>
                <Th>Channel</Th>
                <Th className="hidden sm:table-cell">Status</Th>
              </Tr>
            </THead>
            <TBody>
              {onPage.map((c) => {
                // "Keep my words only": the reporter rejected the AI summary, so their (redacted) words are shown.
                const cell = caseSummaryCell(c);
                const assignee = c.assignedTo ? (names.get(c.assignedTo) ?? "A former team member") : null;
                return (
                  // Phones: a tall row reads from its top (the status heads the summary there), not from its middle.
                  <Tr key={c.ref} className="max-sm:align-top">
                    <Th scope="row">
                      <Link href={`/app/cases/${c.ref}`} className="inline-flex min-h-11 items-center whitespace-nowrap font-mono">
                        {c.ref}
                      </Link>
                    </Th>
                    <Td className="min-w-[min(15rem,calc(100vw_-_9.25rem))] max-w-[34rem] sm:min-w-[18rem]">
                      {/* Phones: the status heads the summary (the Status column is hidden below sm, so exactly one copy
                          is shown and exposed at any width). Here it has the summary's width, so a long status wraps
                          once instead of stacking word by word under the reference. */}
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
                    <Td className="min-w-[10rem]">
                      {c.priorityArea ? AREA_HEADINGS[c.priorityArea].canonical : <span className="text-ink-muted">Not classified yet</span>}
                    </Td>
                    <Td className="min-w-[9rem]">
                      {assignee ? <span className="block">{assignee}</span> : <span className="block text-ink-muted">No one yet</span>}
                      <DueDate state={dueState(c.status, c.dueAt, now)} className="mt-1" />
                    </Td>
                    {/* The age, and under it the day it was received: one column for both keeps the table to eight. */}
                    <Td className="whitespace-nowrap">
                      <span className="block">{ageLabel(ageInDays(c.receivedAt, now))}</span>
                      <span className="block text-small text-ink-muted">
                        <VisuallyHidden>received </VisuallyHidden>
                        <time dateTime={c.receivedAt.toISOString()}>{formatDate(c.receivedAt)}</time>
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap">{LOCATION_KIND_LABELS[c.locationKind]}</Td>
                    <Td className="whitespace-nowrap">{INTAKE_CHANNEL_LABELS[c.intakeChannel]}</Td>
                    <Td className="hidden sm:table-cell">
                      <StatusBadge status={c.status} />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
          {page.pages > 1 ? (
            <nav aria-labelledby="inbox-pages-title" className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p id="inbox-pages-title" className="text-ink">
                {`Page ${page.page} of ${page.pages}`}
                <span className="text-ink-muted">{` (${INBOX_PAGE_SIZE} cases to a page)`}</span>
              </p>
              <div className="flex flex-wrap gap-3">
                {page.page > 1 ? (
                  <ButtonLink href={pageHref(page.page - 1)} variant="secondary" iconStart={<Icon icon={ChevronLeft} />}>
                    Previous page
                  </ButtonLink>
                ) : null}
                {page.page < page.pages ? (
                  <ButtonLink href={pageHref(page.page + 1)} variant="secondary" iconEnd={<Icon icon={ChevronRight} />}>
                    Next page
                  </ButtonLink>
                ) : null}
              </div>
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
