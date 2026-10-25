import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { CircleAlert, Clock, MailCheck, MailX } from "lucide-react";
import { withOrg } from "@/db/tenant";
import { caseEvents, cases, orgs, outboundMessages } from "@/db/schema";
import { Disclosure } from "@/components/ui/Disclosure";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import { absoluteUrl } from "@/lib/app-url";
import { requireStaff } from "@/lib/auth/staff";
import { caseUrlOf } from "@/lib/email/send";
import { EMAIL_AUDIENCE, EMAIL_TEMPLATE_LABELS, isEmailTemplate, renderForDisplay, type EmailTemplate } from "@/lib/email/templates";
import { formatDateTime } from "@/lib/format";

// The Outbox (lead only; CLAUDE.md "Routes"): every email AccessLoop sent, or would have sent (FAKE_EMAIL=1), newest
// first: to reporters, and to the staff member a case is assigned to (the assignment email and the daily job's
// alerts). outbound_messages has no body or recipient column (docs/decisions.md "Message model"): each email is
// rendered again from (template, case ref, org), and a receipt code or a re-test link is never shown, because it was
// never stored. Addresses are never decrypted here.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Outbox" };

const LIMIT = 100;

const STATUS: Record<string, { label: string; icon: typeof MailCheck; className: string }> = {
  skipped_fake: { label: "Not sent: simulated email", icon: MailX, className: "text-ink" },
  sent: { label: "Sent", icon: MailCheck, className: "text-success font-bold" },
  failed: { label: "Failed", icon: CircleAlert, className: "text-danger font-bold" },
  // lib/email/send.ts records the row before the send and its result after it: a row still "pending" is on its way,
  // or its send stopped before the result was recorded.
  pending: { label: "Not confirmed yet", icon: Clock, className: "text-ink" },
};

export default async function OutboxPage() {
  const staff = await requireStaff(["lead"]);

  const data = await withOrg({ orgId: staff.orgId, role: staff.role }, async (tx) => {
    const rows = await tx
      .select({
        id: outboundMessages.id,
        template: outboundMessages.template,
        status: outboundMessages.status,
        createdAt: outboundMessages.createdAt,
        caseId: outboundMessages.caseId,
        ref: cases.ref,
      })
      .from(outboundMessages)
      .leftJoin(cases, and(eq(cases.id, outboundMessages.caseId), eq(cases.orgId, outboundMessages.orgId)))
      .where(eq(outboundMessages.orgId, staff.orgId))
      .orderBy(desc(outboundMessages.createdAt), desc(outboundMessages.id))
      .limit(LIMIT);
    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(outboundMessages)
      .where(eq(outboundMessages.orgId, staff.orgId));
    // Whether a code was in each email: the message_sent event says so (codeIncluded), never the code itself.
    const caseIds = [...new Set(rows.map((r) => r.caseId).filter((id): id is string => id !== null))];
    const events = caseIds.length
      ? await tx
          .select({ payload: caseEvents.payload })
          .from(caseEvents)
          .where(and(eq(caseEvents.orgId, staff.orgId), eq(caseEvents.type, "message_sent"), inArray(caseEvents.caseId, caseIds)))
      : [];
    const [org] = await tx
      .select({ name: orgs.name, title: orgs.feedbackDesignateTitle })
      .from(orgs)
      .where(eq(orgs.id, staff.orgId))
      .limit(1);
    return { rows, total, events, org };
  });

  const codeIncluded = new Map<string, boolean>();
  const linkIncluded = new Map<string, boolean>();
  for (const e of data.events) {
    if (typeof e.payload.messageId !== "string") continue;
    codeIncluded.set(e.payload.messageId, e.payload.codeIncluded === true);
    linkIncluded.set(e.payload.messageId, e.payload.linkIncluded === true);
  }
  const simulated = process.env.FAKE_EMAIL === "1";
  const checkUrl = absoluteUrl("/check");
  const count = data.total === 1 ? "1 email" : `${data.total} emails`;

  return (
    <>
      <PageHeader
        title="Outbox"
        description={
          <>
            Every email AccessLoop sends to the people who give feedback: acknowledgements, receipt codes,{" "}
            {/* Never broken at its hyphen ("re-" at the end of one line, "test" on the next). */}
            <span className="whitespace-nowrap">re-test</span> requests and reminders. It also lists the emails to the team
            or person a case is assigned to: that it was assigned to them, and the daily check&rsquo;s alerts about cases
            with no fix logged or past their due date.
          </>
        }
      />

      <div className="grid gap-6">
        {simulated ? (
          <Notice tone="info" title="Email is simulated in this prototype">
            Nothing leaves this computer. Each row is an email that would have been sent, so you can see exactly what the
            person would get.
          </Notice>
        ) : (
          <Notice tone="info" title="Emails are sent through Resend">
            A failed email is marked &ldquo;Failed&rdquo;: nothing reached the person.
          </Notice>
        )}
        <p className="max-w-[var(--measure)] text-ink-muted">
          Addresses are never shown here. Receipt codes and the links in <span className="whitespace-nowrap">re-test</span>{" "}
          emails are never stored, so where an email had one, you see a note in its place.
        </p>

        {data.rows.length === 0 ? (
          <EmptyState
            title="No emails yet"
            action={
              <Link href="/app/cases/new" className="inline-flex min-h-11 items-center font-bold">
                Log feedback received another way
              </Link>
            }
          >
            When AccessLoop emails someone who gave feedback, it shows here: for example the receipt code for feedback
            you log with an email address, or a re-test request after a fix.
          </EmptyState>
        ) : (
          <Table
            id="outbox-emails"
            caption="Emails sent to reporters and owners"
            description={data.total > LIMIT ? `${count}, newest first. Showing the latest ${LIMIT}.` : `${count}, newest first`}
          >
            <THead>
              {/* The email itself comes right after the case, so on a phone "Show the email" and the opened email are
                  in view without scrolling the table sideways. No "To" column: it said "The reporter's email" on every
                  row; the note above says addresses are never shown, and each opened email says it again. */}
              <Tr>
                <Th>Case</Th>
                <Th>Email</Th>
                <Th>What</Th>
                <Th>When</Th>
                <Th>Status</Th>
              </Tr>
            </THead>
            <TBody>
              {data.rows.map((m) => {
                const template: EmailTemplate | null = isEmailTemplate(m.template) ? m.template : null;
                const what = template ? EMAIL_TEMPLATE_LABELS[template] : "Email";
                const status = STATUS[m.status] ?? { label: m.status, icon: MailCheck, className: "text-ink" };
                const email =
                  template && m.ref && data.org
                    ? renderForDisplay(
                        template,
                        { orgName: data.org.name, designateTitle: data.org.title, ref: m.ref, checkUrl, caseUrl: caseUrlOf(m.ref) },
                        codeIncluded.get(m.id) ?? false,
                        linkIncluded.get(m.id) ?? false,
                      )
                    : null;
                return (
                  <Tr key={m.id} className="align-top">
                    <Th scope="row">
                      {m.ref ? (
                        <Link href={`/app/cases/${m.ref}`} className="font-mono">
                          {m.ref}
                        </Link>
                      ) : (
                        <span className="inline-flex min-h-11 items-center">No case</span>
                      )}
                    </Th>
                    {/* sm:w-[45%]: the opened email gets a reading measure (the panel's own max width) instead of a narrow
                        40rem-capped column, so the row is about half as tall. Below sm the column takes what is left
                        beside the case reference (as the inbox's Summary does): wider at 390px (it read 2-3 words a
                        line), and at 320px still inside the visible part of the table. */}
                    <Td className="min-w-[min(15rem,calc(100vw_-_9.25rem))] sm:w-[45%] sm:min-w-[18rem]">
                      {email ? (
                        <Disclosure
                          summary={
                            <>
                              Show the email
                              <VisuallyHidden>{`: ${what.toLowerCase()}, ${m.ref}`}</VisuallyHidden>
                            </>
                          }
                        >
                          {/* wrap-anywhere: a link in the email (http://…/check) no longer sets the cell's minimum width,
                              so on a phone the card stays inside the visible part of the table. */}
                          <div className="grid gap-3 rounded-md border border-border bg-surface-sunken p-3 wrap-anywhere sm:p-4">
                            <p>
                              <span className="font-bold">Subject: </span>
                              {email.subject}
                            </p>
                            <p>
                              <span className="font-bold">To: </span>
                              {template && EMAIL_AUDIENCE[template] === "owner" ? (
                                <>The assigned owner&rsquo;s email (never shown)</>
                              ) : (
                                <>The reporter&rsquo;s email (never shown)</>
                              )}
                            </p>
                            <div className="grid gap-2 border-t border-border pt-3">
                              {email.text.split("\n\n").map((para, i) => (
                                <p key={i}>
                                  {para}
                                </p>
                              ))}
                            </div>
                          </div>
                        </Disclosure>
                      ) : (
                        <span className="inline-flex min-h-11 items-center text-ink-muted">Not available</span>
                      )}
                    </Td>
                    {/* The rows are top-aligned (an opened email makes its row tall), so each short cell sits on the
                        same 44px line as the case link and "Show the email" beside it. */}
                    <Td className="whitespace-nowrap">
                      <span className="inline-flex min-h-11 items-center">{what}</span>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <time dateTime={m.createdAt.toISOString()} className="inline-flex min-h-11 items-center">
                        {formatDateTime(m.createdAt)}
                      </time>
                    </Td>
                    <Td>
                      <span className={`inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap ${status.className}`}>
                        <Icon icon={status.icon} />
                        <span>{status.label}</span>
                      </span>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>
    </>
  );
}
