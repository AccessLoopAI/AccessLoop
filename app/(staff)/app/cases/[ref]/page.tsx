import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { and, asc, eq, sql } from "drizzle-orm";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { withOrg } from "@/db/tenant";
import { caseEvents, casePrivate, orgMembers } from "@/db/schema";
import { ScenarioSourceNote } from "@/components/scenarios/ScenarioSourceNote";
import { Card } from "@/components/ui/Card";
import { Disclosure } from "@/components/ui/Disclosure";
import { DueDate } from "@/components/ui/DueDate";
import { HashChip } from "@/components/ui/HashChip";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { RedactedText } from "@/components/ui/RedactedText";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { HistoryTimeline, LoopTimeline, loopState, type HistoryEvent } from "@/components/ui/Timeline";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import { requireStaff } from "@/lib/auth/staff";
import { canRun, type CaseCommand } from "@/lib/cases/access";
import { describeEvent } from "@/lib/cases/history";
import {
  CASE_REF,
  CLOSED_REASON_STAFF_LABELS,
  INTAKE_CHANNEL_LABELS,
  LOCATION_KIND_LABELS,
  SUMMARY_SOURCE_LABELS,
} from "@/lib/cases/labels";
import { buildReview, parseSpans } from "@/lib/cases/redaction-review";
import { SEEN_VERIFIED_COOKIE, playVerifiedMoment, seenKey } from "@/lib/cases/seen-verified";
import { findStaffCase } from "@/lib/cases/staff-case";
import { acknowledgementStep, reminderSentAt, reporterGaveEmail, retestAskOf, retestAskSentence } from "@/lib/cases/messages";
import { duplicateOriginalOf, duplicatesOf } from "@/lib/cases/duplicates";
import { ackRecordedAfterDays } from "@/lib/cases/history";
import { staffNotes } from "@/lib/cases/notes";
import { acknowledgementLine } from "@/lib/cases/summary";
import { ACK_RECORDED_LATE_DAYS } from "@/lib/metrics/predicates";
import { aiSuggestion } from "@/lib/cases/triage";
import { caseTextVisible } from "@/lib/cases/visibility";
import { decrypt } from "@/lib/crypto";
import { zonedDate } from "@/lib/dates";
import { formatDate, formatDateLong, formatDateTime } from "@/lib/format";
import { dueDateOf, dueState } from "@/lib/metrics/queue";
import { AREA_HEADINGS } from "@/lib/report/headings";
import { MAX_RETEST_ROUNDS, STOP_WAITING_DAYS, closeReasonsFor, reopenTarget, workStartedFrom } from "@/lib/state-machine";
import { CaseFeedbackProvider } from "./CaseFeedback";
import { CaseNotes } from "./CaseNotes";
import {
  AckEmailForm,
  AckRecordForm,
  AssignForm,
  CloseForm,
  LogFixForm,
  ReminderForm,
  ReopenForm,
  RetriageForm,
  StopWaitingForm,
  TriageForm,
  WaitingForReporter,
} from "./CaseForms";
import { OriginalReport } from "./OriginalReport";
import { RedactionReview } from "./RedactionReview";
import { RedactionRevision } from "./RedactionRevision";
import { RememberVerified } from "./RememberVerified";
import { SimilarBarriers } from "./SimilarBarriers";

// The staff case page (docs/domain.md §2, §3, §5; e2e/demo.spec.ts steps 2, 3, 5). Lead: everything. Owner: only
// a case assigned to them (else 404), redacted text only, never "Show original". Auditor: read-only, no forms.
// The case is looked up by ref INSIDE the signed-in org (refs repeat across orgs). Before the lead approves the
// redaction, only the lead reads the case's words (lib/cases/visibility.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ ref: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { ref } = await params;
  return { title: CASE_REF.test(ref) ? ref : "Case" };
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-small font-bold text-ink-muted">{term}</dt>
      <dd className="m-0 wrap-anywhere">{children}</dd>
    </div>
  );
}

const AI_BACKEND_WORDS: Record<string, string> = {
  fake: "simulated AI, for testing",
  "claude-cli": "the team's local Claude CLI",
  api: "Claude API",
  seed: "demo data",
};

export default async function CasePage({ params }: Params) {
  const staff = await requireStaff(["lead", "owner", "auditor"]);
  const { ref } = await params;
  if (!CASE_REF.test(ref)) notFound();
  const isLead = staff.role === "lead";

  const data = await withOrg({ orgId: staff.orgId, role: staff.role }, async (tx) => {
    const c = await findStaffCase(tx, staff, ref);
    if (!c) return null;
    const events = await tx
      .select()
      .from(caseEvents)
      .where(and(eq(caseEvents.orgId, staff.orgId), eq(caseEvents.caseId, c.id)))
      .orderBy(asc(caseEvents.seq));
    const members = await tx
      .select({ id: orgMembers.id, displayName: orgMembers.displayName, role: orgMembers.role })
      .from(orgMembers)
      .where(eq(orgMembers.orgId, staff.orgId));

    // The lead's review needs the original to show each hidden detail in its (redacted) surroundings. The
    // original itself never leaves the server here; "Show original" is the only (logged) way to read it.
    let review: { view: ReturnType<typeof buildReview>; proposalSeq: number } | null = null;
    if (isLead && c.redactionApprovedAt === null) {
      const [p] = await tx
        .select({ rawTextEnc: casePrivate.rawTextEnc })
        .from(casePrivate)
        .where(and(eq(casePrivate.orgId, staff.orgId), eq(casePrivate.caseId, c.id)))
        .limit(1);
      const proposal = [...events].reverse().find((e) => e.type === "redaction_proposed");
      let raw: string | null = null;
      try {
        raw = p ? decrypt(p.rawTextEnc) : null;
      } catch (err) {
        // A key problem must not hide the case: the stored redacted text still shows, and approval stays refused.
        console.error(`[case] could not read the original for the review (${err instanceof Error ? err.name : "UnknownError"})`);
      }
      if (raw !== null) {
        const view = buildReview(raw, parseSpans(proposal?.payload.spans, raw.length), [], {
          summary: c.summary,
          aiSummary: c.aiSummary,
          locationDetail: c.locationDetail,
        });
        review = { view, proposalSeq: proposal?.seq ?? 0 };
      }
    }
    // Whether any contact detail was recorded (staff intake allows "not anonymous" with neither): only the lead can
    // read case_private (RLS), and only the null-ness is read here. Nothing is decrypted.
    let contactKnown: boolean | null = null;
    if (isLead && !c.isAnonymous) {
      const [p] = await tx
        .select({
          hasEmail: sql<boolean>`${casePrivate.reporterEmailEnc} is not null`,
          hasContact: sql<boolean>`${casePrivate.reporterContactEnc} is not null`,
        })
        .from(casePrivate)
        .where(and(eq(casePrivate.orgId, staff.orgId), eq(casePrivate.caseId, c.id)))
        .limit(1);
      contactKnown = Boolean(p?.hasEmail || p?.hasContact);
    }
    // Phase 7 T2 item 8: the "duplicate of" link both ways, found inside this org only.
    const links = {
      original: c.status === "closed" && c.closedReason === "duplicate" ? await duplicateOriginalOf(tx, staff.orgId, c.id) : null,
      duplicates: await duplicatesOf(tx, staff.orgId, c.id),
    };
    return { c, events, members, review, contactKnown, links };
  });
  if (!data) notFound();
  const { c, events, members, review, contactKnown, links } = data;
  // Another case's ref is named (and linked) only for a viewer who opens every case: an owner opens only their own.
  const seesOtherCases = staff.role !== "owner";

  const names = new Map(members.map((m) => [m.id, m.displayName]));
  const memberName = (id: string | null | undefined) => (id ? (names.get(id) ?? null) : null);
  const facts = { status: c.status, assignedTo: c.assignedTo, redactionApproved: c.redactionApprovedAt !== null };
  const can = (cmd: CaseCommand) => canRun(cmd, staff, facts);
  const textVisible = caseTextVisible(staff.role, c);
  // The approval, and the lead's latest correction of it (Phase 7 T2: a later redaction_approved with revision: true).
  const approval = events.find((e) => e.type === "redaction_approved");
  const lastApproval = [...events].reverse().find((e) => e.type === "redaction_approved");
  const correction = lastApproval && lastApproval !== approval ? lastApproval : null;
  const correctedWords = correction
    ? ` Corrected by ${memberName(correction.actorId) ?? "a lead"} on ${formatDateLong(correction.createdAt)}.`
    : "";
  const aiEvent = events.find((e) => e.type === "ai_structured");
  const ack = acknowledgementLine(c, events.filter((e) => e.type === "ack_recorded"));
  const lastOf = (type: string) => [...events].reverse().find((e) => e.type === type);
  const assigneeName = memberName(c.assignedTo);

  // Signature moment 1: a just-verified case closes its loop once in this browser (CSS, never under reduced motion).
  const celebrate = playVerifiedMoment(c, (await cookies()).get(SEEN_VERIFIED_COOKIE)?.value, new Date());

  const loop = loopState(c.status);
  const doneUpTo = loop ? (loop.closed ? 4 : loop.unchecked ? 3 : loop.current) : -1;
  const stageDetail = (i: number, detail: ReactNode | undefined) => (i <= doneUpTo ? detail : undefined);
  // The first `triaged` event: a correction of the triage (D2) is a later `triaged` event with `retriage: true`.
  const triagedAt = events.find((e) => e.type === "triaged")?.createdAt;
  const fixedAt = lastOf("fix_logged")?.createdAt;
  const loopDetails = [
    stageDetail(0, formatDate(c.receivedAt)),
    stageDetail(1, triagedAt ? formatDate(triagedAt) : undefined),
    stageDetail(2, assigneeName ?? undefined),
    stageDetail(3, fixedAt ? formatDate(fixedAt) : undefined),
    stageDetail(4, c.verifiedAt ? formatDate(c.verifiedAt) : undefined),
  ];

  const ownWords = c.summarySource === "reporter_words";
  // The review shows every summary text staff will read after approval (ReportCard shows `summary`, else the AI
  // summary), so the lead checks each one for names before anyone else sees it.
  const reviewSummaryLabel = c.summary !== null ? (c.summarySource ? SUMMARY_SOURCE_LABELS[c.summarySource] : "Summary") : null;
  const reviewAiSummaryLabel =
    c.aiSummary === null
      ? null
      : ownWords
        ? "AI summary (not used: the reporter kept their own words)"
        : c.summary === null
          ? "AI summary"
          : null;
  const manualReason =
    c.needsManualRedaction && c.redactionApprovedAt === null
      ? c.aiOptOut
        ? "The reporter asked us not to use AI, so only the automatic patterns checked this report. Read it for names and other details that identify someone, and hide them before you approve."
        : c.summarySource === "ai_edited"
          ? "The reporter rewrote the summary. It was checked for contact details and for the names found in the report, but not for new names. Read it and the report before you approve."
          : "Some of this report was not checked for names automatically. Read it for names and other details that identify someone, and hide them before you approve."
      : null;

  const history: HistoryEvent[] = events.map((e) => {
    const line = describeEvent(e, { isLead, memberName, seesOtherCases });
    const hasBody = line.statusChange || line.body || line.link || line.note || line.caseLink;
    return {
      id: String(e.seq),
      title: line.title,
      at: e.createdAt.toISOString(),
      atLabel: formatDateTime(e.createdAt),
      actor: line.actor,
      tone: line.tone,
      aside: <HashChip hash={e.hash} label={`Record ${e.seq} hash`} />,
      body: hasBody ? (
        <div className="grid gap-1">
          {line.statusChange ? (
            <p className="text-small text-ink-muted">
              Status: {line.statusChange.from} <span aria-hidden="true">→</span>
              <VisuallyHidden> to </VisuallyHidden> {line.statusChange.to}
            </p>
          ) : null}
          {line.body ? (
            <p>
              {line.bodyLabel ? <span className="font-bold">{line.bodyLabel}: </span> : null}
              <RedactedText as="span" text={line.body} />
            </p>
          ) : null}
          {line.note ? (
            <p>
              <span className="font-bold">{line.note.label}: </span>
              <RedactedText as="span" text={line.note.text} />
            </p>
          ) : null}
          {line.link ? (
            <p>
              <a href={line.link} rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center gap-1 break-all">
                <span>Evidence: {line.link}</span>
                <Icon icon={ExternalLink} size="1em" />
              </a>
            </p>
          ) : null}
          {line.caseLink ? (
            <p>
              <span className="font-bold">{line.caseLink.label}: </span>
              <CaseRefLink caseRef={line.caseLink.ref} inline={false} />
            </p>
          ) : null}
        </div>
      ) : undefined,
    };
  });

  /* ---------------------------------------------------------------- the next step (forms by role and status) */
  const steps: ReactNode[] = [];
  // ACR s.9(4) comes first: acknowledge in the same way it arrived (email, or a record of a call, letter, visit).
  const hasEmail = reporterGaveEmail(events);
  const ackStep = can("acknowledge") ? acknowledgementStep(c, hasEmail) : null;
  if (ackStep?.kind === "email") steps.push(<AckEmailForm key="ack" caseRef={c.ref} />);
  if (ackStep?.kind === "manual") {
    steps.push(
      <AckRecordForm
        key="ack"
        caseRef={c.ref}
        channelWords={ackStep.words}
        today={zonedDate(new Date())}
        receivedOn={zonedDate(c.receivedAt)}
      />,
    );
  }
  if (isLead && c.status === "new" && c.redactionApprovedAt === null) {
    steps.push(
      <p key="approve-first" className="max-w-[var(--measure)]">
        Check the redaction above and approve it. Then you can triage this case: choose its area and write its public summary.
      </p>,
    );
  }
  // The AI's suggested area with its confidence word and "uncertain" list (domain §6); pre-selected only from 0.5 up.
  const suggestion = aiSuggestion(c.aiPriorityAreas, (aiEvent?.payload.aiValue as { uncertain?: unknown } | undefined)?.uncertain);
  if (can("triage")) steps.push(<TriageForm key="triage" caseRef={c.ref} suggestion={suggestion} />);
  if (can("log_fix")) steps.push(<LogFixForm key="fix" caseRef={c.ref} wantsRetest={c.wantsRetest && c.retestRound < MAX_RETEST_ROUNDS} />);
  if (can("assign")) {
    const assignable = members
      .filter((m) => m.role === "owner" || m.role === "lead")
      .sort((a, b) => (a.role === b.role ? a.displayName.localeCompare(b.displayName) : a.role === "owner" ? -1 : 1));
    steps.push(
      <AssignForm
        key="assign"
        caseRef={c.ref}
        members={assignable}
        current={c.status === "assigned" ? c.assignedTo : null}
        currentDue={c.status === "assigned" && c.dueAt ? dueDateOf(c.dueAt) : ""}
        today={zonedDate(new Date())}
      />,
    );
  }
  if (can("retriage") && c.priorityArea && c.publicSummary) {
    steps.push(<RetriageForm key="retriage" caseRef={c.ref} area={c.priorityArea} publicSummary={c.publicSummary} />);
  }
  const reopenTo = can("reopen") ? reopenTarget(c) : null;
  if (reopenTo && c.status === "fixed_unverified") steps.push(<ReopenForm key="reopen" caseRef={c.ref} />);
  if (reopenTo && c.status !== "fixed_unverified") {
    // D4: reopening a verified or closed case is rare, so it waits behind a quiet toggle (like "Close without a fix").
    steps.push(
      <Disclosure key="reopen" summary="Reopen this case" variant="inline" panelClassName="max-w-none">
        <ReopenForm caseRef={c.ref} from={c.status === "verified" ? "verified" : reopenTo === "triaged" ? "triaged" : "new"} />
      </Disclosure>,
    );
  }
  if (c.status === "retest_open" && staff.role !== "auditor") {
    // Say what really happened to this round's request (never "the reporter is asked" when nobody was).
    const noEmailContact = c.isAnonymous ? "none" : isLead ? (contactKnown ? "other" : "none") : "unknown";
    const asked = retestAskSentence(retestAskOf(events, c.retestRound, noEmailContact));
    steps.push(<WaitingForReporter key="waiting" asked={asked} />);
  }
  if (can("stop_waiting")) {
    const requested = lastOf("retest_requested");
    if (requested) {
      const from = new Date(requested.createdAt.getTime() + STOP_WAITING_DAYS * 86_400_000);
      steps.push(
        <StopWaitingForm
          key="stop-waiting"
          caseRef={c.ref}
          askedOn={formatDateLong(requested.createdAt)}
          allowedFrom={from > new Date() ? formatDateLong(from) : null}
        />,
      );
    }
  }
  if (can("remind") && hasEmail) {
    // Domain §3 re-test ethics: at most one reminder per round, and only to a reporter who gave an email.
    const remindedAt = reminderSentAt(events, c.retestRound);
    steps.push(
      remindedAt ? (
        <p key="reminded" className="max-w-[var(--measure)]">
          A reminder email went out on <time dateTime={remindedAt.toISOString()}>{formatDateLong(remindedAt)}</time>. That is
          the only reminder for round {c.retestRound}.
        </p>
      ) : (
        <ReminderForm key="remind" caseRef={c.ref} round={c.retestRound} />
      ),
    );
  }
  if (staff.role === "owner" && c.status === "fixed_unverified") {
    steps.push(
      <p key="owner-done" className="max-w-[var(--measure)]">
        Your fix is logged. The reporter did not check it, so it counts as fixed but not verified. The lead can reopen it if needed.
      </p>,
    );
  }
  if (can("close")) steps.push(<CloseForm key="close" caseRef={c.ref} reasons={closeReasonsFor(c.status, workStartedFrom(events))} />);

  const backHref = staff.role === "owner" ? "/app/my-work" : "/app/inbox";

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={backHref} className="inline-flex min-h-11 items-center gap-1.5">
            <Icon icon={ArrowLeft} size="1em" />
            <span>{staff.role === "owner" ? "Back to my work" : "Back to inbox"}</span>
          </Link>
        }
        title={<span className="font-mono tracking-[0.02em]">{c.ref}</span>}
        meta={
          <>
            <StatusBadge status={c.status} celebrate={celebrate} data-testid="case-status" />
            <span>
              Received <time dateTime={c.receivedAt.toISOString()}>{formatDateLong(c.receivedAt)}</time>
            </span>
            <span>{INTAKE_CHANNEL_LABELS[c.intakeChannel]}</span>
            <span>{LOCATION_KIND_LABELS[c.locationKind]}</span>
          </>
        }
      />
      <ScenarioSourceNote orgSlug={staff.orgSlug} caseRef={c.ref} />
      {celebrate ? <RememberVerified caseKey={seenKey(c.id)} /> : null}

      <CaseFeedbackProvider>
        {/* DOM order (the order on a phone): the loop, the report, the next step, the case details, then the long
            history. From lg the details sit in the right column beside both (they came after the history on a
            phone, about 4,500px down). */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-start">
          <div className="grid min-w-0 gap-6 lg:col-start-1 lg:row-start-1">
            {loop === null ? (
              <Notice tone="info" title="This case is closed">
                {links.original && seesOtherCases ? (
                  <>
                    Duplicate of <CaseRefLink caseRef={links.original.ref} />. The work on this barrier goes on in that case.
                  </>
                ) : c.closedReason ? (
                  CLOSED_REASON_STAFF_LABELS[c.closedReason]
                ) : (
                  "Closed without a fix."
                )}
              </Notice>
            ) : (
              <Card tone={c.status === "verified" ? "raised" : "default"}>
                <LoopTimeline {...loop} animateClose={celebrate} details={loopDetails} title="Where this case is in the loop" />
              </Card>
            )}

            {review ? (
              <RedactionReview
                caseRef={c.ref}
                proposalSeq={review.proposalSeq}
                initial={review.view}
                manualReason={manualReason}
                summaryLabel={reviewSummaryLabel}
                summaryNote={null}
                aiSummaryLabel={reviewAiSummaryLabel}
              />
            ) : textVisible ? (
              <ReportCard
                c={c}
                approvedLine={
                  approval
                    ? `Redaction approved by ${memberName(approval.actorId) ?? "a lead"} on ${formatDateLong(approval.createdAt)}.${correctedWords}`
                    : null
                }
                revise={
                  can("revise_redaction") && lastApproval ? <RedactionRevision caseRef={c.ref} approvalSeq={lastApproval.seq} /> : null
                }
              />
            ) : (
              <Notice tone="info" title="Waiting for redaction review">
                The lead checks this report for names before anyone else reads it. Its summary and its words show here after that.
              </Notice>
            )}

            {can("reveal") ? <OriginalReport key="original" caseRef={c.ref} /> : null}

            {steps.length ? (
              <Card as="section" id="next-step" title="Next step" tone={review ? "default" : "raised"}>
                <div className="grid gap-8 [&>*+*]:border-t [&>*+*]:border-border [&>*+*]:pt-6">{steps}</div>
              </Card>
            ) : null}

            {/* Phase 7 T2 item 4: internal notes and interim accommodations (lead, and the owner it is assigned to). */}
            <CaseNotes caseRef={c.ref} notes={staffNotes(events)} memberName={memberName} canAdd={can("note")} />

            <SimilarBarriers staff={staff} caseRow={c} />
          </div>

          <Card as="section" id="case-details" title="Case details" className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <dl className="m-0 grid gap-4">
              <Detail term="Acknowledgement">
                {ack.kind === "screen" ? (
                  <>
                    Acknowledged on screen on <time dateTime={ack.at.toISOString()}>{formatDateLong(ack.at)}</time>
                  </>
                ) : ack.kind === "manual" ? (
                  <>
                    Acknowledged{ack.channelWords ? ` ${ack.channelWords}` : ""} on{" "}
                    <time dateTime={ack.at.toISOString()}>{formatDateLong(ack.at)}</time>
                    {ack.givenOn ? <AckRecordedOn givenOn={ack.givenOn} recordedAt={ack.recordedAt} /> : null}
                  </>
                ) : ack.kind === "anonymous" ? (
                  "Anonymous: no acknowledgement needed"
                ) : (
                  "Not acknowledged yet"
                )}
              </Detail>
              <Detail term="Where">
                {LOCATION_KIND_LABELS[c.locationKind]}
                {textVisible && !review && c.locationDetail ? (
                  <>
                    {": "}
                    <RedactedText as="span" text={c.locationDetail} />
                  </>
                ) : null}
              </Detail>
              <Detail term="Channel">{INTAKE_CHANNEL_LABELS[c.intakeChannel]}</Detail>
              <Detail term="Received">
                <time dateTime={c.receivedAt.toISOString()}>{formatDateTime(c.receivedAt)}</time>
              </Detail>
              <Detail term="Reporter">
                {c.isAnonymous
                  ? "Anonymous"
                  : !isLead
                    ? "Not anonymous (only the lead can see any contact details)"
                    : contactKnown
                      ? "Gave contact details (shown with the original)"
                      : "Not anonymous, but no contact details were recorded"}
              </Detail>
              <Detail term="Checking the fix">
                {c.wantsRetest ? "The reporter agreed to check the fix" : "The reporter did not ask to check the fix"}
                {c.retestRound > 0 ? (
                  <span className="block text-small text-ink-muted">{`Re-test round ${c.retestRound} of ${MAX_RETEST_ROUNDS}`}</span>
                ) : null}
              </Detail>
              <Detail term="AI">
                {c.aiOptOut
                  ? "Not used: the reporter asked us not to use AI"
                  : aiEvent
                    ? `Suggested the summary and the area (${AI_BACKEND_WORDS[String(aiEvent.payload.backend)] ?? "AI"})`
                    : "No AI result for this case"}
              </Detail>
              <Detail term="Redaction">
                {approval
                  ? `Approved by ${memberName(approval.actorId) ?? "a lead"} on ${formatDate(approval.createdAt)}${correction ? `; corrected on ${formatDate(correction.createdAt)}` : ""}`
                  : c.needsManualRedaction
                    ? "Not approved yet. It needs a check by hand"
                    : "Not approved yet"}
              </Detail>
              <Detail term="Area">
                {c.priorityArea ? (
                  AREA_HEADINGS[c.priorityArea].canonical
                ) : (
                  <>
                    Not set yet
                    {suggestion ? (
                      <span className="block text-small text-ink-muted">
                        AI suggestion: {suggestion.label} ({suggestion.word} confidence)
                      </span>
                    ) : null}
                  </>
                )}
              </Detail>
              <Detail term="Public summary">{c.publicSummary ? c.publicSummary : "Not written yet"}</Detail>
              <Detail term="Assigned to">
                {assigneeName ?? "No one yet"}
                <DueDate state={dueState(c.status, c.dueAt, new Date())} className="mt-1" />
              </Detail>
              {c.verifiedAt ? (
                <Detail term="Confirmed by the reporter">
                  <time dateTime={c.verifiedAt.toISOString()}>{formatDateLong(c.verifiedAt)}</time>
                </Detail>
              ) : null}
              <DuplicateDetails original={links.original} duplicates={links.duplicates} seesOtherCases={seesOtherCases} />
              <Detail term="Kept until">
                <time dateTime={c.retentionUntil}>{formatDateLong(new Date(`${c.retentionUntil}T12:00:00Z`))}</time>
                <span className="block text-small text-ink-muted">Seven years from receipt (ACR s.19)</span>
              </Detail>
            </dl>
          </Card>

          <Card
            as="section"
            id="history"
            title="History"
            description="Every event on this case, oldest first. Each code is the record's fingerprint: it also covers the record before it, so a changed record shows."
            className="lg:col-start-1 lg:row-start-2"
          >
            <HistoryTimeline events={history} />
          </Card>
        </div>
      </CaseFeedbackProvider>
    </>
  );
}

/** Another case of the org, by its ref (only for a viewer who may open it). `inline`: inside a sentence. */
function CaseRefLink({ caseRef, inline = true }: { caseRef: string; inline?: boolean }) {
  return (
    <Link href={`/app/cases/${caseRef}`} className={inline ? "font-mono" : "inline-flex min-h-11 items-center font-mono"}>
      {caseRef}
    </Link>
  );
}

/**
 * Acknowledgement honesty (Phase 7): a staff record gives the day the person was acknowledged, which can be days
 * before it was written down. Say when it was recorded, next to the day it claims.
 */
function AckRecordedOn({ givenOn, recordedAt }: { givenOn: string; recordedAt: Date }) {
  const days = ackRecordedAfterDays(givenOn, recordedAt);
  const late = days > ACK_RECORDED_LATE_DAYS;
  return (
    <span className="block text-small text-ink-muted" data-testid="ack-recorded-on">
      Recorded on <time dateTime={recordedAt.toISOString()}>{formatDateLong(recordedAt)}</time>
      {days > 0 ? `, ${days === 1 ? "1 day" : `${days} days`} later` : ", the same day"}
      {late ? `: more than ${ACK_RECORDED_LATE_DAYS} days after the day it gives.` : "."}
    </span>
  );
}

/** Phase 7 T2 item 8: the "duplicate of" link, both ways (refs only for a viewer who opens every case). */
function DuplicateDetails({
  original,
  duplicates,
  seesOtherCases,
}: {
  original: { ref: string } | null;
  duplicates: { ref: string; closedAt: Date }[];
  seesOtherCases: boolean;
}) {
  return (
    <>
      {original && seesOtherCases ? (
        <Detail term="Duplicate of">
          <CaseRefLink caseRef={original.ref} inline={false} />
        </Detail>
      ) : null}
      {duplicates.length ? (
        <Detail term="Reported again">
          {seesOtherCases ? (
            <>
              <span className="block">
                {duplicates.length === 1 ? "1 other report was" : `${duplicates.length} other reports were`} closed as a
                duplicate of this case:
              </span>
              <ul className="m-0 flex list-none flex-wrap gap-x-4 p-0">
                {duplicates.map((d) => (
                  <li key={d.ref}>
                    <CaseRefLink caseRef={d.ref} inline={false} />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            `${duplicates.length === 1 ? "1 other report was" : `${duplicates.length} other reports were`} closed as a duplicate of this case.`
          )}
        </Detail>
      ) : null}
    </>
  );
}

/** The case's words after the redaction review (or the lead's own view): summary, then the report itself. */
function ReportCard({
  c,
  approvedLine,
  revise,
}: {
  c: {
    summary: string | null;
    summarySource: keyof typeof SUMMARY_SOURCE_LABELS | null;
    aiSummary: string | null;
    aiOptOut: boolean;
    redactedText: string;
  };
  approvedLine: string | null;
  /** The lead's "Hide a detail that was missed" (Phase 7 T2), under the words. */
  revise?: ReactNode;
}) {
  const ownWords = c.summarySource === "reporter_words";
  const summary = ownWords ? null : (c.summary ?? c.aiSummary);
  const H3 = "al-subhead"; // the design system's sub-heading (app/globals.css)
  return (
    <Card
      as="section"
      id="redacted-report"
      title="The report, with personal details removed"
      description={approvedLine ?? "Names, phone numbers, emails and other personal details are replaced with labels like [PERSON]."}
    >
      <div className="grid gap-5">
        <div className="grid gap-2">
          <h3 className={H3}>Summary</h3>
          {summary ? (
            <>
              <RedactedText text={summary} className="text-lead" />
              <p className="text-small text-ink-muted">
                {c.summary ? (c.summarySource ? SUMMARY_SOURCE_LABELS[c.summarySource] : "Summary") : "AI summary"}
              </p>
            </>
          ) : ownWords && c.aiSummary ? (
            <>
              <RedactedText text={c.aiSummary} />
              <p className="text-small text-ink-muted">
                AI summary, not confirmed: the reporter chose to keep their own words. Read the report below.
              </p>
            </>
          ) : (
            <p className="text-ink-muted">
              {c.aiOptOut
                ? "The reporter chose not to use AI on this report, so there is no AI summary. Read the report below."
                : "There is no AI summary for this case. Read the report below."}
            </p>
          )}
        </div>
        <div className="grid gap-2">
          <h3 className={H3}>In the reporter&rsquo;s words</h3>
          <RedactedText text={c.redactedText} />
        </div>
        {revise ? <div className="border-t border-border pt-4">{revise}</div> : null}
      </div>
    </Card>
  );
}
