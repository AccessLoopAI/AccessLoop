// The Phase 7 T6 helpers (docs/phase7-prompt.md T6 items 3-5), on the live database and compared with the same pure
// functions the pages use: the ACR s.9 checklist and the preview of the public description on /app/settings (the
// preview says exactly what /p/{org} says), the CAN-ASC-5.2.1 clause 17 panel on the dashboard (each step's number is
// lib/metrics' and its link opens exactly those cases), and the "How your Feedback section compares" card, which stays
// hidden on a report page while no row of data/benchmark/feedback-sections.csv is verified by a person. axe in light
// and dark on the settings page and the dashboard with the panel. Read-only, except one fake-AI draft report.
import { test, expect, type Page } from "@playwright/test";
import { expectNoAxeViolations, signInAs } from "./helpers";
import { ownerSql, orgId, withSql } from "./db";
import { makeReport } from "./fixtures/reports";
import { feedbackProcessChecks, processCheckSummary, processIntro, type FeedbackProcessSettings } from "@/lib/feedback-process";
import { acknowledgementCompliance, computeDashboardMetrics, inboxHref, thisYear, type CaseSet, type MetricCase, type RoundSet } from "@/lib/metrics";
import { clause17Steps } from "@/lib/standards/clause17";
import { benchmarkSummary, parseBenchmarkCsv } from "@/lib/benchmark/feedback-sections";
import { readFileSync } from "node:fs";
import path from "node:path";

const ORG = "maple-harbour";
const LOCAL = process.env.AUTH_MODE === "local";

/** The org's settings and every case with its events, read inside the org's RLS context (as lib/metrics/load.ts). */
async function orgState(): Promise<{ org: FeedbackProcessSettings; cases: MetricCase[] }> {
  return withSql(ownerSql, async (sql) => {
    const id = await orgId(sql, ORG);
    const [o] = await sql<FeedbackProcessSettings[]>`
      select name, slug, feedback_designate_title as "feedbackDesignateTitle", contact_mailing_address as "contactMailingAddress",
        contact_phone as "contactPhone", contact_email as "contactEmail" from orgs where id = ${id}`;
    const cases = (await sql.begin(async (tx) => {
      await tx`select set_config('app.org_id', ${id}, true), set_config('app.role', 'system', true)`;
      const rows = await tx<{ id: string; ref: string }[]>`select id, ref from cases where org_id = ${id} order by seq`;
      const events = await tx<{ case_id: string; seq: number; type: string; payload: Record<string, unknown>; created_at: Date }[]>`
        select case_id, seq, type, payload, created_at from case_events where org_id = ${id} order by case_id, seq`;
      return rows.map((r) => ({
        id: r.id,
        ref: r.ref,
        events: events.filter((e) => e.case_id === r.id).map((e) => ({ seq: e.seq, type: e.type, payload: e.payload, createdAt: new Date(e.created_at) })),
      }));
    })) as MetricCase[];
    return { org: o, cases };
  });
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
}

/** The references in the inbox table, sorted. */
async function shownRefs(page: Page): Promise<string[]> {
  const table = page.getByRole("table", { name: /^Cases received/ });
  if ((await table.count()) === 0) return [];
  return (await table.locator("tbody tr th a").allInnerTexts()).map((t) => t.trim()).sort();
}
const refsOf = (cases: MetricCase[], set: CaseSet | RoundSet) => cases.filter((c) => set.caseIds.includes(c.id)).map((c) => c.ref).sort();

test.describe("feedback helpers (Phase 7 T6)", () => {
  test.skip(!LOCAL, "signs in through the local 'Sign in as' page");

  test("settings: the ACR s.9 checklist flags what is missing, and the preview is the public description", async ({ browser }) => {
    for (const scheme of ["light", "dark"] as const) {
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      await signInAs(page, "E2E_LEAD_EMAIL");
      const { org, cases } = await orgState();
      const now = new Date();
      const ack = acknowledgementCompliance({ cases, period: thisYear(now), now });
      const expected = feedbackProcessChecks(org, {
        required: ack.required.count,
        missing: ack.missing.count,
        missingHref: ack.missing.count > 0 ? inboxHref(ack.missing.filter) : null,
        periodLabel: thisYear(now).start.slice(0, 4),
      });

      await page.goto("/app/settings");
      await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
      const checklist = page.getByRole("region", { name: "Your feedback process (ACR s.9)" });
      await expect(checklist.getByTestId("process-check-summary")).toHaveText(processCheckSummary(expected));
      for (const c of expected) {
        const row = checklist.locator(`[data-check="${c.id}"]`);
        await expect(row, c.id).toContainText(c.label);
        await expect(row, c.id).toContainText(c.rule);
        await expect(row, c.id).toContainText(c.detail);
        if (c.action) await expect(row.getByRole("link"), c.id).toHaveAttribute("href", c.action.href);
      }
      await expect(checklist).not.toContainText(/complian|certified|guarantee/i);

      const preview = page.getByRole("region", { name: "Preview of your public description" });
      const described = preview.getByRole("region", { name: "How to give feedback" });
      await expect(described).toContainText(processIntro(org));
      await expect(described.getByRole("heading", { level: 3, name: "How to give feedback" })).toBeVisible();
      await expect(preview.getByRole("link", { name: "Open your public feedback page" })).toHaveAttribute("href", `/p/${ORG}`);
      const previewText = (await described.innerText()).replace(/\s+/g, " ").trim();

      await settle(page);
      await expectNoAxeViolations(page, `settings with the s.9 checklist (${scheme})`);

      // The public page says the same words (one component for both).
      await page.goto(`/p/${ORG}`);
      const pub = page.getByRole("region", { name: "How to give feedback" });
      await expect(pub.getByRole("heading", { level: 2, name: "How to give feedback" })).toBeVisible();
      expect((await pub.innerText()).replace(/\s+/g, " ").trim()).toBe(previewText);
      await context.close();
    }
  });

  test("dashboard: the clause 17 panel shows lib/metrics' numbers and opens exactly their cases", async ({ browser }) => {
    for (const scheme of ["light", "dark"] as const) {
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await signInAs(page, "E2E_LEAD_EMAIL");
      await page.goto("/app/dashboard");
      const { cases } = await orgState();
      const now = new Date();
      const m = computeDashboardMetrics({ cases, period: thisYear(now), now });
      const panel = page.getByRole("region", { name: "CAN-ASC-5.2.1, clause 17: what your records show" });
      await expect(panel.getByRole("heading", { level: 3 })).toHaveText(["Step 1: Receive", "Step 2: Acknowledge", "Step 3: Address", "Step 4: Respond"]);
      await expect(panel.locator("blockquote")).toHaveAttribute("cite", /\/17-feedback$/);
      for (const s of clause17Steps(m)) {
        const step = panel.locator(`[data-step="${s.key}"]`);
        await expect(step.locator("[data-step-value]"), s.key).toHaveText(s.of === null ? `${s.count}` : `${s.count} of ${s.of}`);
        const link = page.getByRole("link", { name: `See the cases for clause 17: ${s.name}`, exact: true });
        if (s.href) await expect(link, s.key).toHaveAttribute("href", s.href);
        else await expect(link, s.key).toHaveCount(0);
      }
      await expect(panel).not.toContainText(/complian|certified|guarantee/i);
      await settle(page);
      await expectNoAxeViolations(page, `dashboard with the clause 17 panel (${scheme})`);

      if (scheme === "light") {
        const address = clause17Steps(m).find((s) => s.key === "address")!;
        if (address.href) {
          await page.getByRole("link", { name: "See the cases for clause 17: Address", exact: true }).click();
          await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeFocused();
          expect(await shownRefs(page)).toEqual(refsOf(cases, m.funnel.fixLogged));
        }
      }
      await context.close();
    }
  });

  test("report page: 'How your Feedback section compares' stays hidden while no benchmark row is verified", async ({ page }) => {
    const csv = readFileSync(path.join(process.cwd(), "data", "benchmark", "feedback-sections.csv"), "utf8");
    const parsed = parseBenchmarkCsv(csv);
    expect(parsed.ok).toBe(true);
    const summary = parsed.ok ? benchmarkSummary(parsed.rows) : null;
    const report = await makeReport(ORG);
    await signInAs(page, "E2E_LEAD_EMAIL");
    await page.goto(`/app/reports/${report.id}`);
    await expect(page.getByRole("region", { name: "Report checks" })).toBeVisible();
    if (summary === null) {
      await expect(page.getByTestId("feedback-benchmark")).toHaveCount(0);
      await expect(page.getByText("How your Feedback section compares")).toHaveCount(0);
    } else {
      // Once a person verifies rows, the card shows (never as a second region named "Feedback").
      await expect(page.getByTestId("benchmark-headline")).toHaveText(/^Your draft covers \d of 7 elements; published median is \d+(\.\d)?\.$/);
      await expectNoAxeViolations(page, "report page with the benchmark card");
    }
    // While no row is verified the card can't render here, so axe sees it on /app/design (e2e/pages.spec.ts), with
    // made-up numbers (review finding, docs/decisions.md 2026-10-21).
    await expect(page.getByRole("region", { name: /feedback/i })).toHaveCount(1);
  });
});
