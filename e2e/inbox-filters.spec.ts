// Inbox filters (CLAUDE.md "Routes"; docs/domain.md §10 "Every tile and every chart value links to the inbox,
// filtered to exactly the cases behind that number"). The expected cases come from lib/metrics computed on the
// SAME database at test time (never hard-coded: demo.spec and the other specs add cases on every run).
// Axe in both themes at 1440 px and 390 px on a filtered inbox; "Clear filters"; invalid values are ignored.
import { test, expect, type Page } from "@playwright/test";
import { expectNoAxeViolations, signInAs } from "./helpers";
import { ownerSql, orgId, withSql } from "./db";
import { allInboxRefs } from "./inbox-pages";
import {
  computeDashboardMetrics,
  inboxHref,
  thisYear,
  type CaseSet,
  type DashboardMetrics,
  type MetricCase,
  type RoundSet,
} from "@/lib/metrics";

const ORG = "maple-harbour";

/** Every Maple Harbour case with its events, read inside the org's RLS context (as lib/metrics/load.ts does). */
async function metricCases(): Promise<MetricCase[]> {
  return withSql(ownerSql, async (sql) => {
    const id = await orgId(sql, ORG);
    return (await sql.begin(async (tx) => {
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
  });
}

async function metricsNow(): Promise<{ cases: MetricCase[]; m: DashboardMetrics }> {
  const cases = await metricCases();
  const now = new Date();
  return { cases, m: computeDashboardMetrics({ cases, period: thisYear(now), now }) };
}

/** The references the inbox lists, on every page (50 to a page), sorted ([] when the table is not shown). */
async function shownRefs(page: Page): Promise<string[]> {
  return (await allInboxRefs(page)).sort();
}

const refsOf = (cases: MetricCase[], s: CaseSet | RoundSet) =>
  s.caseIds.map((id) => cases.find((c) => c.id === id)!.ref).sort();

test.describe.configure({ mode: "serial" });

test("each dashboard number's inbox link lists exactly the cases lib/metrics counts", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, "E2E_LEAD_EMAIL");
  const { cases, m } = await metricsNow();
  const checks: [string, CaseSet | RoundSet][] = [
    ["total received", m.total.total],
    ["verified (headline)", m.verifiedFixRate.verified],
    ["verified-fix rate denominator (D6: every logged fix)", m.verifiedFixRate.fixLogged],
    ["verified-fix rate: not verified", m.verifiedFixRate.notVerified],
    ["closed as not accessibility feedback (D6)", m.notFeedback],
    ["open barriers", m.openBarriers.total],
    ["not classified yet", m.areas.notClassified],
    ["the built environment", m.areas.byArea.built_environment],
    ["email", m.total.byChannel.email],
    ["received in September", m.monthly.find((r) => r.month.endsWith("-09"))?.received ?? m.total.total],
    ["funnel: fix logged", m.funnel.fixLogged],
    ["re-tests answered", m.retestResponse.answered],
    ["acknowledgement required", m.acknowledgement.required],
    ["needs attention", m.needsAttention.all],
  ];
  for (const [label, set] of checks) {
    await page.goto(inboxHref(set.filter));
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" }), label).toBeVisible();
    await expect(page.getByRole("region", { name: "Filters" }), label).toBeVisible();
    expect(await shownRefs(page), `${label}: ${inboxHref(set.filter)}`).toEqual(refsOf(cases, set));
  }
  await page.context().close();
});

test("a filtered inbox shows its filters as text and clears them; invalid values are ignored", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, "E2E_LEAD_EMAIL");
  const { cases, m } = await metricsNow();

  await page.goto(inboxHref(m.statuses.verified.filter));
  const filters = page.getByRole("region", { name: "Filters" });
  await expect(filters).toContainText("Status: Verified by reporter");
  await expect(filters).toContainText("(spam not counted)");
  await expect(filters).toContainText(`${m.statuses.verified.count} of ${cases.length} cases match`);
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/app\/inbox$/);
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeFocused();
  await expect(page.getByRole("region", { name: "Filters" })).toHaveCount(0);
  expect(await shownRefs(page)).toEqual(cases.map((c) => c.ref).sort());

  await page.goto("/app/inbox?status=bogus&area=mars&month=2026-13&attention=soon&org=lakeview-telecom");
  await expect(page.getByRole("region", { name: "Filters" })).toHaveCount(0);
  expect(await shownRefs(page)).toEqual(cases.map((c) => c.ref).sort());

  // Nothing can be received in 1990 (feedback is kept 7 years): the empty state, with the filters still shown.
  await page.goto("/app/inbox?from=1990-01-01&to=1990-12-31");
  await expect(page.getByRole("heading", { level: 2, name: "No cases match these filters" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Filters" })).toContainText(`0 of ${cases.length} cases match`);
  await page.context().close();
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`a filtered inbox passes axe in both themes at ${viewport.width} px, without sideways scrolling`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport })).newPage();
    await signInAs(page, "E2E_LEAD_EMAIL");
    const { m } = await metricsNow();
    await page.goto(inboxHref({ ...m.openBarriers.total.filter, area: ["ict", "none"] }));
    await expect(page.getByRole("region", { name: "Filters" })).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(1);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
      });
      await expectNoAxeViolations(page, `filtered inbox ${viewport.width}px (${colorScheme})`);
    }
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways, "no sideways page scroll").toBeLessThanOrEqual(0);
    await page.context().close();
  });
}
