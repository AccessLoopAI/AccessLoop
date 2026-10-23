// The dashboard (docs/domain.md §10, CLAUDE.md signature moment 4). Every tile, chart value and card number is
// compared with lib/metrics computed on the SAME database at test time (never hard-coded: demo.spec and the other
// specs add cases on every run); every number's link opens the inbox filtered to exactly its cases (the refs are
// compared); "Show as table" toggles each chart; keyboard focus reveals a hidden table; axe is clean at 1440 px and
// 390 px in both themes; who lands where; the period selector (a GET form) changes every number; the report cards
// (handoff Phase 5 item 3) show the period's newest report with lib/report's checks, or plainly none, "Generate report"
// with the period filled in (leads only; never "New report"), and the latest report's evidence check (/verify).
import { test, expect, type Locator, type Page } from "@playwright/test";
import { expectNoAxeViolations, signInAs } from "./helpers";
import { ownerSql, orgId, withSql } from "./db";
import { allInboxRefs } from "./inbox-pages";
import { makeReport } from "./fixtures/reports";
import {
  NO_DATA_YET,
  NO_REAL_AI_YET,
  OPEN_STATUSES,
  addDays,
  computeDashboardMetrics,
  countLabel,
  customPeriod,
  dashboardHref,
  decimalLabel,
  inboxHref,
  last90Days,
  monthLabel,
  nextDeadline,
  percentLabel,
  periodLabel,
  thisYear,
  type CaseSet,
  type DashboardMetrics,
  type EntityClass,
  type MetricCase,
  type Period,
  type RoundSet,
} from "@/lib/metrics";
import { reportReadiness } from "@/lib/report/readiness";
import type { ReportContent } from "@/lib/report/types";
import { REPORT_STATE_LABELS } from "@/lib/report/view";
import { STAFF_STATUS_LABELS } from "@/lib/status";

const ORG = "maple-harbour";
const LAKEVIEW = "lakeview-telecom";
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** Every Maple Harbour case with its events, read inside the org's RLS context (as lib/metrics/load.ts does). */
async function metricCases(): Promise<{ cases: MetricCase[]; entityClass: EntityClass }> {
  return withSql(ownerSql, async (sql) => {
    const id = await orgId(sql, ORG);
    const [org] = await sql<{ entity_class: EntityClass }[]>`select entity_class from orgs where id = ${id}`;
    const cases = (await sql.begin(async (tx) => {
      await tx`select set_config('app.org_id', ${id}, true), set_config('app.role', 'system', true)`;
      const rows = await tx<{ id: string; ref: string }[]>`select id, ref from cases where org_id = ${id} order by seq`;
      const events = await tx<{ case_id: string; seq: number; type: string; payload: Record<string, unknown>; created_at: Date }[]>`
        select case_id, seq, type, payload, created_at from case_events where org_id = ${id} order by case_id, seq`;
      return rows.map((r) => ({
        id: r.id,
        ref: r.ref,
        events: events.filter((e) => e.case_id === r.id)
          .map((e) => ({ seq: e.seq, type: e.type, payload: e.payload, createdAt: new Date(e.created_at) })),
      }));
    })) as MetricCase[];
    return { cases, entityClass: org.entity_class };
  });
}

async function metricsNow(period?: (now: Date) => Period) {
  const { cases, entityClass } = await metricCases();
  const now = new Date();
  const m: DashboardMetrics = computeDashboardMetrics({ cases, period: (period ?? thisYear)(now), now });
  return { cases, m, entityClass, now };
}

/** The references the inbox lists, on every page (50 to a page), sorted ([] when the table is not shown). */
async function shownRefs(page: Page): Promise<string[]> {
  return (await allInboxRefs(page)).sort();
}

const refsOf = (cases: MetricCase[], s: CaseSet | RoundSet) => s.caseIds.map((id) => cases.find((c) => c.id === id)!.ref).sort();
const tile = (page: Page, id: string) => page.getByTestId(`tile-${id}`);
const statValue = (t: Locator) => t.locator("[data-stat-value]");
const days = (n: number) => `${decimalLabel(n)} ${n === 1 ? "day" : "days"}`;

async function dashboard(page: Page, path = "/app/dashboard") {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
}

/** The rows of a chart's data table (always in the DOM): [row header, ...cells] in rendered words. */
async function tableRows(page: Page, caption: RegExp): Promise<string[][]> {
  const table = page.getByRole("table", { name: caption });
  await expect(table).toBeAttached();
  const rows = table.locator("tbody tr");
  const out: string[][] = [];
  for (let i = 0; i < (await rows.count()); i++) {
    out.push((await rows.nth(i).locator("th, td").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()));
  }
  return out;
}

/** The number a table cell shows first ("138 cases reported" -> "138"). */
const lead = (cell: string) => cell.split(" ")[0];

interface StoredReport {
  id: string;
  title: string;
  status: "draft" | "signed_off";
  publishedAt: Date | null;
  content: ReportContent;
  areaText: Record<string, string> | null;
  consultationsText: string | null;
}

interface ReportsNow {
  forPeriod: StoredReport | null;
  latest: { id: string; title: string } | null;
  /** "start|end" of every period that has a report. */
  taken: Set<string>;
}

/**
 * What the two report cards must show, from the database at test time (newest first, as lib/report/access.ts orders
 * them): the newest report for exactly this period, the org's newest report, and every period that has a report.
 */
async function reportsNow(slug: string, period: Period): Promise<ReportsNow> {
  return withSql(ownerSql, async (sql) => {
    const id = await orgId(sql, slug);
    return (await sql.begin(async (tx) => {
      await tx`select set_config('app.org_id', ${id}, true), set_config('app.role', 'system', true)`;
      const [forPeriod] = await tx<StoredReport[]>`
        select id::text as id, title, status, published_at as "publishedAt", content, area_text as "areaText",
          consultations_text as "consultationsText"
        from reports where org_id = ${id} and period_start = ${period.start}::date and period_end = ${period.end}::date
        order by created_at desc, id desc limit 1`;
      const [latest] = await tx<{ id: string; title: string }[]>`
        select id::text as id, title from reports where org_id = ${id} order by created_at desc, id desc limit 1`;
      const taken = await tx<{ p: string }[]>`
        select distinct period_start::text || '|' || period_end::text as p from reports where org_id = ${id}`;
      return { forPeriod: forPeriod ?? null, latest: latest ?? null, taken: new Set(taken.map((t) => t.p)) };
    })) as ReportsNow;
  });
}

/**
 * A period of this year that no report of the org has yet (Jan 1 to Dec 30, then to Dec 29, ...), so it holds this
 * year's cases. The report-cards test builds a draft for it, so every run takes the next one.
 */
async function freePeriod(slug: string): Promise<Period> {
  const year = thisYear(new Date());
  const { taken } = await reportsNow(slug, year);
  for (let end = addDays(year.end, -1); end > year.start; end = addDays(end, -1)) {
    if (!taken.has(`${year.start}|${end}`)) return { start: year.start, end };
  }
  throw new Error(`every period starting ${year.start} has a report: run npm run local:reset`);
}

/**
 * The report-readiness and evidence-integrity cards against the database: the period's newest report (its state,
 * title link and the checks lib/report re-runs) or plainly none; "Generate report" (leads only) to the new-report form
 * with the period filled in, and no "New report" link (that name is /app/reports' own); the latest report's /verify,
 * or plainly that no report exists yet. `total` = the period's cases (the "none" state links them).
 */
async function expectReportCards(page: Page, period: Period, opts: { slug?: string; isLead?: boolean; total?: CaseSet } = {}) {
  const now = await reportsNow(opts.slug ?? ORG, period);
  const readiness = page.getByTestId("report-readiness");
  await expect(page.getByRole("link", { name: "New report" })).toHaveCount(0);
  const generate = page.getByRole("link", { name: "Generate report" });
  if (opts.isLead ?? true) {
    await expect(generate).toHaveCount(1);
    await expect(readiness.getByRole("link", { name: "Generate report", exact: true })).toHaveAttribute(
      "href",
      `/app/reports/new?start=${period.start}&end=${period.end}`,
    );
  } else {
    await expect(generate).toHaveCount(0);
    await expect(readiness).toContainText("Only the lead can generate a report.");
  }
  if (now.forPeriod) {
    const r = reportReadiness(now.forPeriod);
    const title = readiness.getByTestId("readiness-report");
    await expect(title).toHaveText(now.forPeriod.title);
    await expect(title).toHaveAttribute("href", `/app/reports/${now.forPeriod.id}`);
    await expect(readiness.locator("[data-report-state]")).toHaveText(REPORT_STATE_LABELS[r.state]);
    await expect(readiness.getByTestId("readiness-checks")).toHaveText(r.summary);
    await expect(readiness.getByTestId("readiness-next")).toHaveText(r.state === "draft" ? `${r.toWriteLine}. ${r.next}` : r.next);
    await expect(readiness.getByTestId("readiness-none")).toHaveCount(0);
  } else {
    await expect(readiness.getByTestId("readiness-none")).toHaveText("No report for this period yet");
    await expect(readiness.getByTestId("readiness-report")).toHaveCount(0);
    if (opts.total && opts.total.count > 0) {
      await expect(readiness.getByRole("link", { name: `${countLabel(opts.total.count)} received in this period` })).toHaveAttribute(
        "href",
        inboxHref(opts.total.filter),
      );
    }
  }
  const integrity = page.getByTestId("evidence-integrity");
  const verify = integrity.getByRole("link", { name: /^Open the evidence check/ });
  if (now.latest) {
    await expect(verify).toHaveAttribute("href", `/verify/${now.latest.id}`);
    await expect(verify).toHaveAccessibleName(`Open the evidence check for ${now.latest.title}`);
    await expect(integrity.getByTestId("integrity-latest")).toContainText(now.latest.title);
    await expect(integrity.getByTestId("integrity-no-report")).toHaveCount(0);
  } else {
    await expect(integrity.locator('a[href^="/verify/"]')).toHaveCount(0);
    await expect(integrity.getByTestId("integrity-no-report")).toContainText("No progress report exists yet, so there is no evidence check to open.");
  }
  return now;
}

/** axe in light and dark, from the top of the page (the axe test below says why). */
async function axeBothThemes(page: Page, label: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
      window.scrollTo(0, 0);
    });
    await expectNoAxeViolations(page, `${label} (${colorScheme})`);
  }
}

test("a lead lands on the dashboard, and every tile and card equals lib/metrics on the same database", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: DESKTOP })).newPage();
  await signInAs(page, "E2E_LEAD_EMAIL");
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  const { m, entityClass, now } = await metricsNow();

  // Header: the period in words, the deadline banner for the org's entity class (domain §1.5).
  await expect(page.getByTestId("dashboard-period")).toContainText("Feedback received Jan 1,");
  await expect(page.getByTestId("deadline")).toHaveText(nextDeadline(entityClass, now).sentence);

  // The headline ring (D6: over every case with a logged fix): the percent, "N of M", and the parts of the denominator.
  const r = m.verifiedFixRate;
  const hero = tile(page, "verified-fix-rate");
  await expect(hero.getByTestId("verified-fix-percent")).toHaveText(percentLabel(r.rate) ?? "–");
  if (r.fixLogged.count > 0) await expect(hero.getByTestId("verified-fix-value")).toHaveText(`${r.verified.count} of ${r.fixLogged.count}`);
  await expect(hero).toContainText(`${r.verified.count} verified by the reporter`);
  await expect(hero).toContainText(`${r.notVerified.count} not verified by the reporter`);
  await expect(hero).toContainText(`${r.waiting.count} waiting for the reporter to check`);
  await expect(hero).toContainText(`${r.fixedUnverified.count} fixed, not confirmed by the reporter`);
  if (r.backInProgress.count > 0) await expect(hero).toContainText(`${r.backInProgress.count} sent back or reopened after a fix`);
  if (r.closedAfterFix.count > 0) await expect(hero).toContainText(`${r.closedAfterFix.count} closed after a fix`);
  await expect(hero).toContainText(`${r.verifiedStaffRelayed.count} confirmed with a code staff passed on`);
  expect(r.verified.count + r.verifiedStaffRelayed.count + r.notVerified.count).toBe(r.fixLogged.count);

  // D6: what is left out of every number, said and linked (never silently).
  await expect(page.getByTestId("not-feedback-note")).toHaveText(
    m.notFeedback.count > 0
      ? `Not counted in these numbers: ${countLabel(m.notFeedback.count, "submission", "submissions")} closed as not accessibility feedback. The progress report says how many there were.`
      : "Not counted in these numbers: submissions closed as not accessibility feedback (none in this period).",
  );

  const md = m.medianDaysToVerifiedFix;
  await expect(statValue(tile(page, "median-days"))).toHaveText(md.days === null ? NO_DATA_YET : days(md.days));

  const open = tile(page, "open-barriers");
  await expect(statValue(open)).toHaveText(String(m.openBarriers.total.count));
  for (const s of OPEN_STATUSES) await expect(open).toContainText(`${m.openBarriers.byStatus[s].count} ${STAFF_STATUS_LABELS[s].toLowerCase()}`);

  const ack = m.acknowledgement;
  await expect(statValue(tile(page, "acknowledgement"))).toHaveText(
    ack.required.count === 0 ? NO_DATA_YET : `${ack.acknowledged.count} of ${ack.required.count}`,
  );

  const rt = m.retestResponse;
  await expect(statValue(tile(page, "retest-response"))).toHaveText(
    rt.requested.rounds === 0 ? NO_DATA_YET : `${rt.answered.rounds} of ${rt.requested.rounds}`,
  );

  const cr = m.correctionRate;
  if (cr.kind === "no_real_ai_yet") {
    await expect(statValue(tile(page, "correction-rate"))).toHaveText(NO_REAL_AI_YET);
    await expect(tile(page, "correction-rate")).toContainText("Summaries counted: 0.");
  } else {
    await expect(statValue(tile(page, "correction-rate"))).toHaveText(`${cr.corrected.count} of ${cr.reviewed.count}`);
  }

  // The four charts' tables (always in the DOM, even while visually hidden).
  const f = m.funnel;
  expect((await tableRows(page, /^The loop funnel/)).map((row) => [row[0], lead(row[1])])).toEqual([
    ["Reported", String(f.reported.count)],
    ["Triaged", String(f.triaged.count)],
    ["Assigned", String(f.assigned.count)],
    ["Fix logged", String(f.fixLogged.count)],
    ["Verified by reporter", String(f.verified.count)],
  ]);
  await expect(page.getByTestId("funnel-takeaway")).toContainText(`${f.verified.count} of ${f.reported.count}`);
  expect((await tableRows(page, /^Cases received and verified by the reporter, per month/)).map((row) => [row[0], lead(row[1]), lead(row[2])])).toEqual(
    m.monthly.map((row) => [monthLabel(row.month), String(row.received.count), String(row.verified.count)]),
  );
  expect((await tableRows(page, /^Barriers by priority area/)).map((row) => [row[0], lead(row[1])])).toEqual(
    m.areas.rows.map((row) => [row.heading, String(row.cases.count)]),
  );
  expect((await tableRows(page, /^Cases received by intake channel/)).map((row) => [row[0], lead(row[1])])).toEqual(
    m.channels.map((row) => [row.label, String(row.cases.count)]),
  );

  // Needs attention (every case, whatever the period), the report-readiness and evidence-integrity cards.
  const attention = page.getByTestId("needs-attention");
  if (m.needsAttention.all.count > 0) {
    await expect(attention).toContainText(`${m.needsAttention.all.count} case`);
    for (const [reason, set] of Object.entries(m.needsAttention.byReason)) {
      if (set.count > 0) await expect(attention.locator(`[data-reason="${reason}"] h3`)).toContainText(`(${set.count})`);
      else await expect(attention.locator(`[data-reason="${reason}"]`)).toHaveCount(0);
    }
    const oldest = m.needsAttention.items[0];
    await expect(attention.locator(`[data-reason="${oldest.reason}"]`).getByRole("link", { name: oldest.ref })).toHaveAttribute(
      "href",
      `/app/cases/${oldest.ref}`,
    );
  } else {
    await expect(attention).toContainText("Nothing is waiting on your team right now.");
  }
  await expectReportCards(page, thisYear(now), { total: m.total.total });
  await expect(page.getByTestId("integrity-line")).toHaveText(`All ${m.total.total.count} records verify`);
  await page.context().close();
});

test("clicking any number opens the inbox filtered to exactly the cases behind it", async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await (await browser.newContext({ viewport: DESKTOP })).newPage();
  await signInAs(page, "E2E_LEAD_EMAIL");
  const { cases, m } = await metricsNow();
  const r = m.verifiedFixRate;

  // [what, how to find the link on the dashboard, the cases it must open]
  const checks: [string, (p: Page) => Locator, CaseSet | RoundSet][] = [
    ["headline: verified", (p) => tile(p, "verified-fix-rate").getByRole("link", { name: `${r.verified.count} verified by the reporter` }), r.verified],
    ["headline: all logged fixes", (p) => tile(p, "verified-fix-rate").getByRole("link", { name: /^See all \d+ logged fixes/ }), r.fixLogged],
    ["median days", (p) => p.getByRole("link", { name: "See the cases for Median days to verified fix" }), m.medianDaysToVerifiedFix.cases],
    ["open barriers", (p) => p.getByRole("link", { name: "See the cases for Open barriers" }), m.openBarriers.total],
    ["acknowledgement", (p) => p.getByRole("link", { name: "See the cases for Acknowledgement compliance" }), m.acknowledgement.required],
    ["re-tests", (p) => p.getByRole("link", { name: "See the cases for Re-test response rate" }), m.retestResponse.requested],
    ["needs attention", (p) => p.getByTestId("needs-attention").getByRole("link", { name: /^Open \d+ cases? in the inbox/ }), m.needsAttention.all],
    ["evidence integrity", (p) => p.getByRole("link", { name: "See the cases for Evidence integrity" }), m.total.total],
  ];
  if (r.fixedUnverified.count > 0) {
    checks.push(["headline: fixed, not confirmed", (p) => tile(p, "verified-fix-rate").getByRole("link", { name: /fixed, not confirmed by the reporter$/ }), r.fixedUnverified]);
  }
  if (r.notVerified.count > 0) {
    checks.push(["headline: not verified", (p) => tile(p, "verified-fix-rate").getByRole("link", { name: `${r.notVerified.count} not verified by the reporter`, exact: true }), r.notVerified]);
  }
  if (r.waiting.count > 0) {
    checks.push(["headline: waiting", (p) => tile(p, "verified-fix-rate").getByRole("link", { name: /waiting for the reporter to check$/ }), r.waiting]);
  }
  if (m.notFeedback.count > 0) {
    checks.push(["not accessibility feedback", (p) => p.getByTestId("not-feedback-note").getByRole("link", { name: /closed as not accessibility feedback$/ }), m.notFeedback]);
  }
  for (const s of OPEN_STATUSES) {
    const set = m.openBarriers.byStatus[s];
    if (set.count > 0) checks.push([`open: ${s}`, (p) => tile(p, "open-barriers").getByRole("link", { name: `${set.count} ${STAFF_STATUS_LABELS[s].toLowerCase()}` }), set]);
  }
  if (m.acknowledgement.missing.count > 0) {
    checks.push(["not acknowledged", (p) => tile(p, "acknowledgement").getByRole("link", { name: /not acknowledged yet$/ }), m.acknowledgement.missing]);
  }
  if (m.acknowledgement.recordedLate.count > 0) {
    // Phase 7 T2 item 9: staff records written more than 7 days after the day they give.
    checks.push(["recorded late", (p) => tile(p, "acknowledgement").getByRole("link", { name: /recorded more than 7 days after the date given$/ }), m.acknowledgement.recordedLate]);
  }
  if (m.retestResponse.sentBack.rounds > 0) {
    checks.push(["sent back", (p) => tile(p, "retest-response").getByRole("link", { name: /sent back as/ }), m.retestResponse.sentBack]);
  }

  // Chart values: the links live in the tables (every stage, every month, area and channel with cases).
  const chartLinks: [string, string, CaseSet][] = [
    ...(
      [
        ["cases reported", m.funnel.reported],
        ["cases triaged", m.funnel.triaged],
        ["cases assigned", m.funnel.assigned],
        ["cases with a fix logged", m.funnel.fixLogged],
        ["cases verified by the reporter", m.funnel.verified],
      ] as [string, CaseSet][]
    ).map(([words, set]) => ["The loop funnel", `${set.count} ${words}`, set] as [string, string, CaseSet]),
    ...m.monthly.flatMap((row) => [
      ["Received vs verified per month", `${row.received.count} cases received in ${monthLabel(row.month)}`, row.received] as [string, string, CaseSet],
      ["Received vs verified per month", `${row.verified.count} cases verified by the reporter in ${monthLabel(row.month)}`, row.verified] as [string, string, CaseSet],
    ]),
    ...m.areas.rows.map((row) => ["Barriers by priority area", `${row.cases.count} barriers: ${row.heading}`, row.cases] as [string, string, CaseSet]),
    ...m.channels.map((c) => ["Intake channels", `${c.cases.count} cases received by ${c.label.toLowerCase()}`, c.cases] as [string, string, CaseSet]),
  ];

  // 1) Every link on the page points at exactly its set's filter (a zero is plain text: nothing to open).
  await dashboard(page);
  for (const [label, find, set] of checks) {
    if (set.caseIds.length === 0) continue;
    await expect(find(page), label).toHaveAttribute("href", inboxHref(set.filter));
  }
  for (const [chart, name, set] of chartLinks) {
    const link = page.getByRole("link", { name, exact: true });
    if (set.count === 0) await expect(link, `${chart}: ${name}`).toHaveCount(0);
    else await expect(link, `${chart}: ${name}`).toHaveAttribute("href", inboxHref(set.filter));
  }

  // 2) Clicking them lands on the inbox listing exactly those cases (the refs are compared): every tile's link...
  for (const [label, find, set] of checks.slice(0, 8)) {
    if (set.caseIds.length === 0) continue;
    await dashboard(page);
    await find(page).click();
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" }), label).toBeFocused();
    expect(await shownRefs(page), `${label}: ${inboxHref(set.filter)}`).toEqual(refsOf(cases, set));
  }

  // ...a funnel stage by keyboard (focus reveals the visually hidden table; Enter follows the link)...
  const stage = m.funnel.fixLogged.count > 0 ? m.funnel.fixLogged : m.funnel.reported;
  if (stage.count > 0) {
    await dashboard(page);
    const words = stage === m.funnel.fixLogged ? "cases with a fix logged" : "cases reported";
    await page.getByRole("link", { name: `${stage.count} ${words}`, exact: true }).focus();
    await expect(page.getByRole("table", { name: /^The loop funnel/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeFocused();
    expect(await shownRefs(page), "funnel stage").toEqual(refsOf(cases, stage));
  }

  // ...the busiest month and the first channel with cases through "Show as table"...
  const busiest = [...m.monthly].sort((a, b) => b.received.count - a.received.count)[0];
  const channel = m.channels.find((c) => c.cases.count > 0);
  const viaTable: [string, string, CaseSet][] = [
    ...(busiest && busiest.received.count > 0
      ? [["Received vs verified per month", `${busiest.received.count} cases received in ${monthLabel(busiest.month)}`, busiest.received] as [string, string, CaseSet]]
      : []),
    ...(channel ? [["Intake channels", `${channel.cases.count} cases received by ${channel.label.toLowerCase()}`, channel.cases] as [string, string, CaseSet]] : []),
  ];
  for (const [chart, name, set] of viaTable) {
    await dashboard(page);
    await page.getByRole("button", { name: `Show as table (${chart})` }).click();
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" }), name).toBeFocused();
    expect(await shownRefs(page), `${chart}: ${name}`).toEqual(refsOf(cases, set));
  }

  // ...and a mouse click on a bar, which repeats its table link (a plain onClick on a shape that is not focusable).
  if (m.areas.rows.length > 0) {
    await dashboard(page);
    const first = m.areas.rows[0];
    await page.locator("#chart-areas svg .al-mark[data-clickable]").first().click();
    await expect(page).toHaveURL(new RegExp(`${inboxHref(first.cases.filter).replace(/[?.]/g, "\\$&")}$`));
    expect(await shownRefs(page)).toEqual(refsOf(cases, first.cases));
  }
  await page.context().close();
});

const CHARTS = [
  { title: "The loop funnel", caption: /^The loop funnel/ },
  { title: "Received vs verified per month", caption: /^Cases received and verified by the reporter, per month/ },
  { title: "Barriers by priority area", caption: /^Barriers by priority area/ },
  { title: "Intake channels", caption: /^Cases received by intake channel/ },
];

test("'Show as table' swaps each chart for its table on desktop; phones get the tables", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: DESKTOP })).newPage();
  await signInAs(page, "E2E_LEAD_EMAIL");
  for (const chart of CHARTS) {
    const figure = page.locator(".al-chart").filter({ has: page.getByRole("heading", { level: 2, name: chart.title, exact: true }) });
    const toggle = page.getByRole("button", { name: `Show as table (${chart.title})` });
    const table = page.getByRole("table", { name: chart.caption });
    // Before: the picture, and the table only for screen readers (in the accessibility tree, visually 1 px).
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(figure.locator("svg.al-chart-svg")).toBeVisible();
    await expect(figure.locator("svg.al-chart-svg")).toHaveAttribute("aria-hidden", "true");
    await expect(table).toBeAttached();
    expect((await figure.locator(".al-chart-data").boundingBox())?.width ?? 0, `${chart.title}: table visually hidden`).toBeLessThanOrEqual(1);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(table).toBeVisible();
    expect((await table.boundingBox())?.width ?? 0).toBeGreaterThan(200);
    await expect(figure.locator("svg.al-chart-svg")).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(figure.locator("svg.al-chart-svg")).toBeVisible();
  }
  // No link, tabindex, title or desc inside any chart picture (domain §10).
  expect(await page.locator(".al-chart-svg :is(a, [tabindex], title, desc)").count()).toBe(0);
  await page.context().close();

  const phone = await (await browser.newContext({ viewport: PHONE })).newPage();
  await signInAs(phone, "E2E_LEAD_EMAIL");
  for (const chart of CHARTS) {
    await expect(phone.getByRole("table", { name: chart.caption })).toBeVisible();
    await expect(phone.getByRole("button", { name: `Show as table (${chart.title})` })).toBeHidden();
  }
  await expect(phone.locator("svg.al-chart-svg").first()).toBeHidden();
  await phone.context().close();
});

for (const viewport of [DESKTOP, PHONE]) {
  test(`axe is clean at ${viewport.width} px in both themes, with one h1, one status region and no sideways scroll`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport })).newPage();
    await signInAs(page, "E2E_LEAD_EMAIL");
    await dashboard(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("status")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Get help" })).toHaveCount(1);
    const states = viewport === DESKTOP ? ["charts", "tables"] : ["tables"];
    for (const state of states) {
      if (state === "tables" && viewport === DESKTOP) {
        for (const chart of CHARTS) await page.getByRole("button", { name: `Show as table (${chart.title})` }).click();
      }
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        // Back to the top: the staff header is sticky from 64rem, and a row scrolled under it reads to axe as an
        // "obscured" target (content under a sticky header, not a real overlap; focus is kept clear by scroll-padding).
        await page.evaluate(async () => {
          await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
          window.scrollTo(0, 0);
        });
        await expectNoAxeViolations(page, `dashboard ${viewport.width}px ${state} (${colorScheme})`);
      }
    }
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways, "no sideways page scroll").toBeLessThanOrEqual(0);
    if (viewport === PHONE) {
      await page.setViewportSize({ width: 320, height: 700 });
      const at320 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(at320, "reflow at 320 px").toBeLessThanOrEqual(0);
    }
    await page.context().close();
  });
}

test("auditors land on the dashboard too; owners land on My work and are sent there from the dashboard; /app goes home", async ({ browser }) => {
  const auditor = await (await browser.newContext()).newPage();
  await auditor.goto("/sign-in");
  await auditor.getByRole("button", { name: /^Sign in as Internal audit .*Maple Harbour/ }).click();
  await expect(auditor).toHaveURL(/\/app\/dashboard$/);
  await expect(auditor.getByRole("heading", { level: 1, name: "Dashboard" })).toBeFocused();
  await expect(auditor.getByRole("navigation", { name: "Staff" }).getByRole("link")).toHaveText(["Dashboard", "Inbox", "Reports"]);
  await expect(auditor.getByRole("link", { name: "Change the organization type in Settings" })).toHaveCount(0); // lead only
  await expectReportCards(auditor, thisYear(new Date()), { isLead: false }); // /app/reports/new is the lead's
  await auditor.context().close();

  const owner = await (await browser.newContext()).newPage();
  await signInAs(owner, "E2E_OWNER_EMAIL");
  await expect(owner).toHaveURL(/\/app\/my-work$/);
  // CLAUDE.md "Routes": owners are sent to /app/my-work; none of the org's numbers is rendered for them.
  const res = await owner.goto("/app/dashboard");
  expect(res?.status()).toBe(200);
  await expect(owner).toHaveURL(/\/app\/my-work$/);
  await expect(owner.getByRole("heading", { level: 1, name: "My work" })).toBeVisible();
  await expect(owner.getByRole("heading", { level: 1, name: "Dashboard" })).toHaveCount(0);
  await expect(owner.getByTestId("tile-verified-fix-rate")).toHaveCount(0);
  await owner.context().close();

  const lead = await (await browser.newContext()).newPage();
  await signInAs(lead, "E2E_LEAD_EMAIL");
  await expect(lead.getByRole("navigation", { name: "Staff" }).getByRole("link").first()).toHaveText("Dashboard");
  await lead.goto("/app");
  await expect(lead).toHaveURL(/\/app\/dashboard$/);
  await lead.context().close();
});

test("the period selector changes every number; custom dates that don't make a period say why", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: DESKTOP })).newPage();
  await signInAs(page, "E2E_LEAD_EMAIL");
  const period = page.getByRole("group", { name: "Period" });

  // Last 90 days: the form is a GET (no JavaScript needed); focus goes to the h1.
  await period.getByRole("radio", { name: "Last 90 days" }).check();
  await page.getByRole("button", { name: "Show this period" }).click();
  await expect(page).toHaveURL(/[?&]period=90d/);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeFocused();
  await expect(period.getByRole("radio", { name: "Last 90 days" })).toBeChecked();
  const q = await metricsNow(last90Days);
  await expect(statValue(tile(page, "open-barriers"))).toHaveText(String(q.m.openBarriers.total.count));
  await expect(page.getByTestId("integrity-line")).toHaveText(`All ${q.m.total.total.count} records verify`);
  expect((await tableRows(page, /^The loop funnel/)).map((row) => lead(row[1]))[0]).toBe(String(q.m.funnel.reported.count));

  // Custom dates.
  await period.getByRole("radio", { name: "Custom dates" }).check();
  await page.getByLabel("Start date").fill("2026-01-01");
  await page.getByLabel("End date").fill("2026-06-30");
  await page.getByRole("button", { name: "Show this period" }).click();
  await expect(page).toHaveURL(/period=custom&start=2026-01-01&end=2026-06-30/);
  const c = await metricsNow(() => customPeriod("2026-01-01", "2026-06-30")!);
  await expect(page.getByTestId("dashboard-period")).toContainText("Feedback received Jan 1, 2026 to Jun 30, 2026.");
  expect((await tableRows(page, /^The loop funnel/)).map((row) => lead(row[1]))[0]).toBe(String(c.m.funnel.reported.count));
  expect((await tableRows(page, /^Cases received and verified by the reporter, per month/)).map((row) => row[0])).toEqual(
    c.m.monthly.map((row) => monthLabel(row.month)),
  );

  // The start after the end: what was typed stays, the fields say why, the page says it shows this year instead.
  await page.getByLabel("Start date").fill("2026-06-30");
  await page.getByLabel("End date").fill("2026-01-01");
  await page.getByRole("button", { name: "Show this period" }).click();
  await expect(page.getByText("Those dates don't make a period, so this shows this year")).toBeVisible();
  await expect(page.getByLabel("Start date")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Start date")).toHaveValue("2026-06-30");
  await expect(page.getByRole("status")).toContainText("The start date must be on or before the end date.");
  await expect(page.getByTestId("dashboard-period")).toContainText("Feedback received Jan 1,");
  await expectNoAxeViolations(page, "dashboard with a custom period error");
  await page.context().close();
});

test("the report cards: no report for the period, then a draft for it; each link opens its page; axe in both themes", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await (await browser.newContext({ viewport: DESKTOP })).newPage();
  await signInAs(page, "E2E_LEAD_EMAIL");
  const period = await freePeriod(ORG);
  const path = dashboardHref("custom", period);
  const { m } = await metricsNow(() => period);

  // 1) No report for this period yet: said plainly, with the period's cases and "Generate report".
  await dashboard(page, path);
  await expect(page.getByTestId("dashboard-period")).toContainText(`Feedback received ${periodLabel(period)}.`);
  const before = await expectReportCards(page, period, { total: m.total.total });
  expect(before.forPeriod).toBeNull();
  await axeBothThemes(page, "dashboard: no report for the period");

  // "Generate report" opens the new-report form with the period filled in; nothing is built until "Generate draft".
  await page.getByRole("link", { name: "Generate report" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New progress report" })).toBeFocused();
  const opened = new URL(page.url());
  expect(opened.pathname + opened.search).toBe(`/app/reports/new?start=${period.start}&end=${period.end}`);
  await expect(page.getByLabel("Period start")).toHaveValue(period.start);
  await expect(page.getByLabel("Period end")).toHaveValue(period.end);
  expect((await reportsNow(ORG, period)).forPeriod).toBeNull();

  // 2) A draft for exactly this period: its state, title, checks (lib/report) and next step; it is the latest report.
  const made = await makeReport(ORG, { period });
  await dashboard(page, path);
  const after = await expectReportCards(page, period);
  expect(after.forPeriod?.id).toBe(made.id);
  expect(after.latest?.id).toBe(made.id);
  const readiness = page.getByTestId("report-readiness");
  await expect(readiness.locator("[data-report-state]")).toHaveText("Draft");
  await expect(readiness.getByRole("link", { name: "Generate report", exact: true })).toHaveAttribute("data-variant", "secondary");
  await axeBothThemes(page, "dashboard: a draft for the period");

  // The title opens the draft; the evidence check opens its /verify (a draft: staff only), which checks out.
  await readiness.getByTestId("readiness-report").click();
  await expect(page.getByRole("heading", { level: 1, name: made.title })).toBeFocused();
  expect(new URL(page.url()).pathname).toBe(`/app/reports/${made.id}`);
  await dashboard(page, path);
  await page.getByTestId("evidence-integrity").getByRole("link", { name: /^Open the evidence check/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Evidence check" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/verify/${made.id}`);
  await expect(page.getByRole("status")).toContainText("All records match");

  // On a phone the cards stack and nothing scrolls sideways.
  await page.setViewportSize(PHONE);
  await dashboard(page, path);
  await expectReportCards(page, period);
  await axeBothThemes(page, "dashboard at 390 px: a draft for the period");
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways, "no sideways page scroll").toBeLessThanOrEqual(0);
  await page.context().close();
});

test("an org with no report yet: both cards say so plainly, and there is no /verify link", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: DESKTOP })).newPage();
  await signInAs(page, "E2E_OTHER_LEAD_EMAIL");
  await dashboard(page);
  // No spec builds a Lakeview report, so on the e2e database it has none.
  const { latest } = await expectReportCards(page, thisYear(new Date()), { slug: LAKEVIEW });
  expect(latest, "Lakeview has no progress report in the e2e database").toBeNull();
  await expect(page.getByTestId("readiness-none")).toBeVisible();
  await expect(page.getByTestId("integrity-no-report")).toBeVisible();
  await axeBothThemes(page, "dashboard: an org with no report yet");
  await page.context().close();
});
