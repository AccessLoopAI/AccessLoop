import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BarChart } from "@/components/ui/charts/BarChart";
import { FunnelChart } from "@/components/ui/charts/FunnelChart";
import { MonthlyChart } from "@/components/ui/charts/MonthlyChart";
import type { ChartValue } from "@/components/ui/charts/CountLink";
import { DeadlineBanner } from "@/components/ui/DeadlineBanner";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stat } from "@/components/ui/Stat";
import { Announce } from "@/components/ui/StatusRegion";
import { redirect } from "next/navigation";
import { requireStaff, staffHome } from "@/lib/auth/staff";
import { STAFF_STATUS_LABELS } from "@/lib/status";
import { formatDateLong } from "@/lib/format";
import { zonedNoon } from "@/lib/dates";
import {
  CUSTOM_PERIOD_ERRORS,
  NO_DATA_YET,
  OPEN_STATUSES,
  countLabel,
  decimalLabel,
  hoursLabel,
  inboxHref,
  monthLabel,
  monthShortLabel,
  monthShortYearLabel,
  parseDashboardPeriod,
  percentLabel,
  type CaseSet,
  type EntityClass,
  type RoundSet,
} from "@/lib/metrics";
import { loadDashboard } from "@/lib/metrics/dashboard";
import { loadOrgCapToday } from "@/lib/rate-limit";
import { loadDashboardReports } from "@/lib/report/access";
import { Clause17Panel } from "./Clause17Panel";
import { HeadlineRate } from "./HeadlineRate";
import { IntakeCap } from "./IntakeCap";
import { NeedsAttention } from "./NeedsAttention";
import { PeriodForm } from "./PeriodForm";
import { EvidenceIntegrityCard, ReportReadinessCard } from "./ReportCards";

// The staff home for leads and auditors (owners are sent to /app/my-work): docs/domain.md §10, CLAUDE.md signature moment 4. It answers
// "Is our feedback loop actually closing, and are we ready to report?" Every number comes from lib/metrics (the same
// functions the report's facts use) and links to the inbox filtered to exactly its cases. Nothing auto-refreshes; the
// headline ring draws once (not under reduced motion). The period is a GET form; the org comes from the session.
// The report cards (./ReportCards.tsx) read the period's newest report and the org's latest one (lib/report/access.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Dashboard" };

/** Who the deadline is for (docs/domain.md §1.5), in the banner's words. */
const ENTITY_PHRASE: Record<EntityClass, string> = {
  federal_public: "the federal public sector",
  private_large: "a large private organization (100 or more employees)",
  private_small: "a small private organization (10 to 99 employees)",
};

const value = (set: CaseSet | RoundSet, sr: string): ChartValue => {
  const count = "rounds" in set ? set.rounds : set.count;
  return { count, href: count > 0 ? inboxHref(set.filter) : null, sr };
};

/** A breakdown line inside a tile: "1 New" linking to its cases, or plain text for a zero. */
function Line({ set, children }: { set: CaseSet; children: ReactNode }) {
  const content = (
    <>
      <span className="font-bold tabular-nums">{set.count}</span> {children}
    </>
  );
  return (
    <li>
      {set.count > 0 ? (
        <Link href={inboxHref(set.filter)} className="inline-flex min-h-11 items-center">
          <span>{content}</span>
        </Link>
      ) : (
        <span className="inline-flex min-h-11 items-center text-ink-muted">
          <span>{content}</span>
        </span>
      )}
    </li>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff();
  // CLAUDE.md "Routes": owners are sent to /app/my-work (their home), never shown the org's numbers.
  if (staff.role === "owner") redirect(staffHome("owner"));
  const now = new Date();
  const choice = parseDashboardPeriod(await searchParams, now);
  const role = staff.role;
  const [{ metrics: m, integrity, deadline, entityClass }, reports, cap] = await Promise.all([
    loadDashboard({ orgId: staff.orgId, role }, choice.period, now),
    loadDashboardReports({ orgId: staff.orgId, role }, choice.period),
    loadOrgCapToday(staff.orgId), // the web form's daily cap (lib/rate-limit.ts), whatever the period
  ]);

  const total = m.total.total;
  const ack = m.acknowledgement;
  const retest = m.retestResponse;
  const median = m.medianDaysToVerifiedFix;
  const correction = m.correctionRate;
  const problem = choice.problem ? CUSTOM_PERIOD_ERRORS[choice.problem] : null;

  return (
    <>
      <PageHeader
        eyebrow={staff.orgName}
        title="Dashboard"
        meta={
          <p data-testid="dashboard-period">
            Feedback received {choice.label}. Numbers as of {formatDateLong(zonedNoon(m.asOf))}.
          </p>
        }
        actions={<PeriodForm current={choice} />}
        className="xl:[&>div]:items-start"
      />

      {problem ? (
        <>
          <Notice tone="warning" title="Those dates don't make a period, so this shows this year" className="mb-5">
            {problem}
          </Notice>
          <Announce message={`${problem} Showing this year instead.`} />
        </>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-12">
        <DeadlineBanner
          testId="deadline"
          what={deadline.lead}
          when={deadline.countdown}
          urgency={deadline.daysLeft < 0 ? "past" : deadline.daysLeft <= 30 ? "soon" : "calm"}
          detail={
            <>
              The next Accessible Canada Act deliverable for {ENTITY_PHRASE[entityClass]}.
              {staff.role === "lead" ? (
                <>
                  {" "}
                  <Link href="/app/settings">Change the organization type in Settings</Link>
                </>
              ) : null}
            </>
          }
          className="lg:col-span-12"
        />
        <IntakeCap cap={cap} className="lg:col-span-12" />

        <div className="lg:col-span-7 xl:col-span-8">
          <HeadlineRate rate={m.verifiedFixRate} />
        </div>
        <div className="lg:col-span-5 xl:col-span-4">
          <NeedsAttention data={m.needsAttention} />
        </div>

        <ul className="m-0 grid list-none gap-5 p-0 sm:grid-cols-2 lg:col-span-12 lg:grid-cols-3 xl:grid-cols-5">
          <li className="grid">
            <Stat
              testId="tile-median-days"
              titleLevel={2}
              title="Median days to verified fix"
              value={median.days === null ? NO_DATA_YET : decimalLabel(median.days)}
              unit={median.days === null ? undefined : median.days === 1 ? "day" : "days"}
              detail={
                median.days === null
                  ? "No reporter has confirmed a fix for feedback received in this period yet."
                  : `Over ${countLabel(median.cases.count, "verified fix", "verified fixes")}, from the day the report arrived to the day its reporter confirmed the fix.`
              }
              definition="The middle value of the days each verified fix took, counted in calendar days. Half the fixes took less, half took longer. Fixes confirmed with a code staff passed on are included: the time does not depend on who held the code."
              href={median.cases.count > 0 ? inboxHref(median.cases.filter) : undefined}
            />
          </li>
          <li className="grid">
            <Stat
              testId="tile-open-barriers"
              titleLevel={2}
              title="Open barriers"
              value={String(m.openBarriers.total.count)}
              detail="Received in this period and not fixed or closed yet, by status:"
              definition="Cases that are new, triaged, assigned, or waiting for the reporter to check a fix. A case leaves this count when it is fixed or closed."
              href={m.openBarriers.total.count > 0 ? inboxHref(m.openBarriers.total.filter) : undefined}
            >
              <ul className="m-0 grid list-none grid-cols-2 gap-x-3 p-0 text-small [&>li:last-child]:col-span-2">
                {OPEN_STATUSES.map((s) => (
                  <Line key={s} set={m.openBarriers.byStatus[s]}>
                    {STAFF_STATUS_LABELS[s].toLowerCase()}
                  </Line>
                ))}
              </ul>
            </Stat>
          </li>
          <li className="grid">
            <Stat
              testId="tile-acknowledgement"
              titleLevel={2}
              title="Acknowledgement compliance"
              value={ack.required.count === 0 ? NO_DATA_YET : String(ack.acknowledged.count)}
              unit={ack.required.count === 0 ? undefined : `of ${ack.required.count}`}
              ring={ack.required.count > 0 ? { value: ack.acknowledged.count, max: ack.required.count } : undefined}
              detail={
                ack.required.count === 0
                  ? "All feedback received in this period was anonymous, so none needed an acknowledgement."
                  : `${percentLabel(ack.rate) ?? NO_DATA_YET} of non-anonymous feedback was acknowledged the same way it came in (ACR s.9(4)).${ack.medianHours === null ? "" : ` Median time: ${hoursLabel(ack.medianHours)}.`}`
              }
              definition="ACR s.9(4): feedback that is not anonymous gets an acknowledgement of receipt in the same way it was received: the on-screen receipt for the web form, an email for email, a recorded call or letter for phone and mail."
              href={ack.required.count > 0 ? inboxHref(ack.required.filter) : undefined}
            >
              {ack.missing.count > 0 || ack.recordedLate.count > 0 ? (
                <ul className="m-0 grid list-none p-0 text-small">
                  {ack.missing.count > 0 ? <Line set={ack.missing}>not acknowledged yet</Line> : null}
                  {/* Phase 7 acknowledgement honesty: a staff record written more than 7 days after the day it gives. */}
                  {ack.recordedLate.count > 0 ? <Line set={ack.recordedLate}>recorded more than 7 days after the date given</Line> : null}
                </ul>
              ) : null}
            </Stat>
          </li>
          <li className="grid">
            <Stat
              testId="tile-retest-response"
              titleLevel={2}
              title="Re-test response rate"
              value={retest.requested.rounds === 0 ? NO_DATA_YET : String(retest.answered.rounds)}
              unit={retest.requested.rounds === 0 ? undefined : `of ${retest.requested.rounds}`}
              ring={retest.requested.rounds > 0 ? { value: retest.answered.rounds, max: retest.requested.rounds } : undefined}
              detail={
                retest.requested.rounds === 0
                  ? "No re-test was requested for feedback received in this period yet."
                  : `Re-test requests the reporter answered${percentLabel(retest.rate) ? ` (${percentLabel(retest.rate)})` : ""}.`
              }
              definition="Each time a fix is logged and the reporter agreed to check it, they are asked once. Any answer counts, including “I can't check right now” and “Don't contact me about this again”. A request that is still open or expired does not."
              href={retest.requested.caseIds.length > 0 ? inboxHref(retest.requested.filter) : undefined}
            >
              {retest.requested.rounds > 0 ? (
                <ul className="m-0 grid list-none p-0 text-small">
                  <Line set={{ count: retest.sentBack.rounds, caseIds: retest.sentBack.caseIds, filter: retest.sentBack.filter }}>
                    sent back as “Partly” or “No”
                  </Line>
                  <Line set={{ count: retest.unanswered.rounds, caseIds: retest.unanswered.caseIds, filter: retest.unanswered.filter }}>
                    not answered yet
                  </Line>
                </ul>
              ) : null}
            </Stat>
          </li>
          <li className="grid">
            <Stat
              testId="tile-correction-rate"
              titleLevel={2}
              title="Reporter-correction rate"
              value={correction.kind === "no_real_ai_yet" ? correction.label : String(correction.corrected.count)}
              unit={correction.kind === "no_real_ai_yet" ? undefined : `of ${correction.reviewed.count}`}
              detail={
                correction.kind === "no_real_ai_yet"
                  ? `Summaries counted: ${correction.count}. Only summaries from a real AI model that the reporter checked count; simulated ones never do.`
                  : `AI summaries the reporter edited or replaced with their own words${percentLabel(correction.rate) ? ` (${percentLabel(correction.rate)})` : ""}.`
              }
              definition="A live check on the AI: of the AI summaries reporters reviewed before sending, how many they changed (“Change it”) or replaced (“Keep my words only”). Only summaries from a real model count, never simulated or staff-logged ones."
              href={correction.reviewed.count > 0 ? inboxHref(correction.reviewed.filter) : undefined}
            >
              {correction.kind === "measured" && correction.corrected.count > 0 ? (
                <ul className="m-0 grid list-none p-0 text-small">
                  <Line set={correction.corrected}>corrected by the reporter</Line>
                </ul>
              ) : null}
            </Stat>
          </li>
        </ul>

        {/* Phase 7 D6: spam is left out of every number above, never silently: say how many and link them. */}
        <p data-testid="not-feedback-note" className="max-w-[var(--measure)] text-small text-ink-muted lg:col-span-12">
          Not counted in these numbers:{" "}
          {m.notFeedback.count > 0 ? (
            <>
              <Link href={inboxHref(m.notFeedback.filter)} className="inline-flex min-h-11 items-center">
                <span>{countLabel(m.notFeedback.count, "submission", "submissions")} closed as not accessibility feedback</span>
              </Link>
              . The progress report says how many there were.
            </>
          ) : (
            "submissions closed as not accessibility feedback (none in this period)."
          )}
        </p>

        <FunnelChart
          id="chart-funnel"
          testId="chart-funnel"
          title="The loop funnel"
          tableCaption="The loop funnel: cases that reached each stage"
          description="Each column counts the barriers received in this period that got at least that far round the loop."
          aside={
            m.funnel.reported.count === 0 ? (
              <p className="text-lead text-ink">No barriers were received in this period yet.</p>
            ) : (
              <p data-testid="funnel-takeaway" className="grid max-w-[30ch] gap-2 text-lead text-ink">
                <span className="font-display text-stat font-semibold">
                  {m.funnel.verified.count} of {m.funnel.reported.count}
                </span>
                <span>
                  barriers made it all the way round: fixed, and confirmed by the person who reported them.
                </span>
              </p>
            )
          }
          stages={[
            { key: "reported", label: "Reported", value: value(m.funnel.reported, "cases reported") },
            { key: "triaged", label: "Triaged", value: value(m.funnel.triaged, "cases triaged") },
            { key: "assigned", label: "Assigned", value: value(m.funnel.assigned, "cases assigned") },
            { key: "fix_logged", label: "Fix logged", value: value(m.funnel.fixLogged, "cases with a fix logged") },
            {
              key: "verified",
              label: "Verified by reporter",
              value: value(m.funnel.verified, "cases verified by the reporter"),
              tone: "verified",
            },
          ]}
          className="lg:col-span-12"
        />

        <MonthlyChart
          id="chart-monthly"
          testId="chart-monthly"
          title="Received vs verified per month"
          tableCaption="Cases received and verified by the reporter, per month"
          description="Barriers received each month, next to the fixes their reporters confirmed that month (for feedback received in this period)."
          receivedLabel="Received"
          verifiedLabel="Verified by reporter"
          months={m.monthly.map((row) => ({
            month: row.month,
            short: monthShortLabel(row.month),
            shortLabel: monthShortYearLabel(row.month),
            label: monthLabel(row.month),
            received: value(row.received, `cases received in ${monthLabel(row.month)}`),
            verified: value(row.verified, `cases verified by the reporter in ${monthLabel(row.month)}`),
          }))}
          className="xl:col-span-6 lg:col-span-12"
        />

        <BarChart
          id="chart-areas"
          testId="chart-areas"
          title="Barriers by priority area"
          tableCaption="Barriers by priority area (Accessible Canada Act s. 5)"
          description="The area the lead confirmed at triage, named as in the Accessible Canada Act (s. 5). New cases are not classified yet."
          labelHeader="Priority area"
          countHeader="Barriers"
          rows={m.areas.rows.map((r) => ({
            key: r.area ?? "none",
            label: r.heading,
            value: value(r.cases, `barriers: ${r.heading}`),
            tone: r.area === null ? "muted" : "default",
          }))}
          className="xl:col-span-6 lg:col-span-12"
        />

        <BarChart
          id="chart-channels"
          testId="chart-channels"
          title="Intake channels"
          tableCaption="Cases received by intake channel (ACR s. 9(3))"
          description="ACR s.9(3): people must be able to give feedback by mail, telephone and email, and any other way you talk with the public. Staff log what doesn't arrive through the web form, so it joins the same loop."
          labelHeader="Channel"
          countHeader="Received"
          rows={m.channels.map((c) => ({
            key: c.channel,
            label: c.label,
            value: value(c.cases, `cases received by ${c.label.toLowerCase()}`),
          }))}
          className="xl:col-span-6 lg:col-span-12"
        />

        <div className="grid content-start gap-5 xl:col-span-6 lg:col-span-12 lg:grid-cols-2 xl:grid-cols-1">
          <ReportReadinessCard period={choice.period} total={total} report={reports.forPeriod} canGenerate={role === "lead"} />
          <EvidenceIntegrityCard integrity={integrity} total={total} latest={reports.latest} />
        </div>
        <Clause17Panel metrics={m} className="lg:col-span-12" />
      </div>
    </>
  );
}
