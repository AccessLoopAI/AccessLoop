// The evidence check /verify/[reportId] (docs/domain.md §8; handoff Phase 4 items 4-5; CLAUDE.md signature moment 3):
// h1 "Evidence check"; the status line ("All records match" or what failed, in plain words) shown visibly and
// announced through the ONE StatusRegion; a real <table> named "Records" with ONE row per cited case and a column per
// check, every mark with its words, the chain drawing hidden from screen readers. Who sees it: anyone for a published
// report; a draft only for the org's lead and auditor (everyone else 404). Tampering (handoff 4.5): through
// MIGRATION_DATABASE_URL, jsonb_set inflates the verified count of a report this spec created -> check 1 red with the
// explanation (restored in `finally`); UPDATE on case_events raises the append-only error. axe in light AND dark on
// the passing and the tampered check; no sideways scroll at 320 px. Specs share one database: never fixed counts.
import { randomBytes } from "node:crypto";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { expectNoAxeViolations, signInAs } from "./helpers";
import { anyEventId, ownerSql, withSql } from "./db";
import { inflateVerifiedCount, makeReport, storedSnapshot } from "./fixtures/reports";

const ORG = "maple-harbour";
const LOCAL = process.env.AUTH_MODE === "local";
type Role = "lead" | "owner" | "auditor" | "other-lead";

test.describe.configure({ mode: "serial" });

/** A made-up loopback client address (127.x.y.z) per anonymous context (its own rate-limit bucket, never 127.0.0.1's). */
const freshIp = () => ((b: Buffer) => `127.${1 + (b[0] % 255)}.${b[1]}.${b[2]}`)(randomBytes(3));

async function staffPage(browser: Browser, role: Role): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  if (role === "lead") await signInAs(page, "E2E_LEAD_EMAIL");
  else if (role === "owner") await signInAs(page, "E2E_OWNER_EMAIL");
  else if (role === "other-lead") await signInAs(page, "E2E_OTHER_LEAD_EMAIL");
  else {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: /^Sign in as Internal audit .*Maple Harbour/ }).click();
    await page.waitForURL(/\/app\//);
  }
  return page;
}

async function publicPage(browser: Browser): Promise<Page> {
  return (await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } })).newPage();
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
}

async function axeBothThemes(page: Page, label: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await settle(page);
    await expectNoAxeViolations(page, `${label} (${scheme})`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

async function noSideScrollAt320(page: Page, label: string) {
  const size = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 800 });
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, `${label}: page width at 320px`).toBeLessThanOrEqual(320);
  if (size) await page.setViewportSize(size);
}

/** One h1 ("Evidence check"), the one global StatusRegion, one "Get help", exactly one table named "Records". */
async function evidenceContract(page: Page, label: string) {
  await expect(page.getByRole("heading", { level: 1 }), label).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: "Evidence check" }), label).toBeVisible();
  await expect(page.getByRole("status"), label).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Get help" }), label).toHaveCount(1);
  await expect(page.getByRole("table", { name: /records/i }), label).toHaveCount(1);
  await expect(page.locator("output"), label).toHaveCount(0);
}

/** ONE row per cited case: as many body rows as the snapshot has cases, each ref in exactly one row. */
async function oneRowPerCase(page: Page, reportId: string) {
  const { snapshot } = await storedSnapshot(reportId);
  const table = page.getByRole("table", { name: "Records" });
  await expect(table.locator("tbody > tr")).toHaveCount(snapshot.cases.length);
  for (const c of [snapshot.cases[0], snapshot.cases[snapshot.cases.length - 1]]) {
    await expect(table.getByRole("row").filter({ hasText: c.ref })).toHaveCount(1);
  }
  return snapshot;
}

test("the lead's draft: Verify evidence chain -> 'All records match', one Records row per cited case, axe in both themes", async ({ browser }) => {
  const page = await staffPage(browser, "lead");
  await page.goto("/app/reports/new");
  await page.getByLabel("Period start").fill("2026-01-01");
  await page.getByLabel("Period end").fill("2026-12-31");
  await page.getByRole("button", { name: "Generate draft" }).click();
  await page.waitForURL(/\/app\/reports\/[0-9a-f-]{36}$/);
  const id = /\/app\/reports\/([0-9a-f-]{36})$/.exec(new URL(page.url()).pathname)![1];

  await page.getByRole("link", { name: "Verify evidence chain" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Evidence check" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/verify/${id}$`));
  await expect(page.getByRole("status")).toContainText("All records match");
  await expect(page.getByTestId("evidence-line")).toHaveText(/^All records match/); // shown, not only announced
  await evidenceContract(page, "verify (draft, lead)");
  // The stylesheet really reached the page: a stale build once shipped without it, and every check ring (the
  // verdict's is at most 56px) drew as a page-wide disc while axe still passed.
  const rings = await page.locator("svg.al-check-ring").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(rings.length, "check rings on /verify").toBeGreaterThan(0);
  for (const w of rings) expect(w, "a check ring's width on /verify").toBeLessThanOrEqual(64);
  await expect(page.locator("[data-report-state]").first()).toHaveText("Draft");
  await expect(page.getByRole("main")).toContainText("Draft: only your team can see this check.");

  const snapshot = await oneRowPerCase(page, id);
  const table = page.getByRole("table", { name: "Records" });
  for (const h of ["Case", "Report unchanged", "Records intact", "Report matches records", "Later updates"]) {
    await expect(table.getByRole("columnheader", { name: h, exact: true })).toHaveCount(1);
  }
  const first = table.getByRole("row").filter({ hasText: snapshot.cases[0].ref });
  await expect(first).toContainText("Unchanged");
  await expect(first).toContainText(/Intact \(\d+ records?\)/);
  await expect(first).toContainText("Matches");
  // Staff pages link each ref to its case; the drawing is hidden from screen readers.
  await expect(first.getByRole("link", { name: snapshot.cases[0].ref, exact: true })).toHaveAttribute("href", `/app/cases/${snapshot.cases[0].ref}`);
  await expect(page.locator("ol.al-chain").first()).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByRole("link", { name: "Back to the report" })).toHaveAttribute("href", `/app/reports/${id}`);

  await axeBothThemes(page, "verify (draft, all records match)");
  await noSideScrollAt320(page, "verify (draft)");
  await page.context().close();
});

test("who may see it: drafts only for the org's lead and auditor; published reports for anyone (refs as plain text)", async ({ browser }) => {
  const draft = await makeReport(ORG);
  const published = await makeReport(ORG, { publish: true });

  const anon = await publicPage(browser);
  for (const path of [`/verify/${draft.id}`, "/verify/not-a-report", `/verify/${"0".repeat(8)}-0000-4000-8000-000000000000`]) {
    expect((await anon.goto(path))?.status(), path).toBe(404);
  }
  expect((await anon.goto(`/verify/${published.id}`))?.status()).toBe(200);
  await expect(anon.getByRole("status")).toContainText("All records match");
  await evidenceContract(anon, "verify (published, public)");
  await expect(anon.getByRole("main")).not.toContainText("Draft: only your team");
  await oneRowPerCase(anon, published.id);
  await expect(anon.getByRole("table", { name: "Records" }).getByRole("link")).toHaveCount(0); // never links into staff pages
  await expect(anon.getByRole("link", { name: "Back to the report" })).toHaveAttribute("href", `/p/${ORG}/reports/${published.id}`);
  await axeBothThemes(anon, "verify (published, public)");
  await noSideScrollAt320(anon, "verify (published, public)");
  await anon.context().close();

  const other = await staffPage(browser, "other-lead");
  expect((await other.goto(`/verify/${draft.id}`))?.status(), "Lakeview lead, Maple draft").toBe(404);
  expect((await other.goto(`/verify/${published.id}`))?.status(), "Lakeview lead, Maple published").toBe(200);
  await expect(other.getByRole("table", { name: "Records" }).getByRole("link")).toHaveCount(0); // the public view
  await other.context().close();

  const owner = await staffPage(browser, "owner");
  expect((await owner.goto(`/verify/${draft.id}`))?.status(), "owner, draft").toBe(404);
  await owner.context().close();

  test.skip(!LOCAL, "the auditor signs in through the local 'Sign in as' page");
  const auditor = await staffPage(browser, "auditor");
  expect((await auditor.goto(`/verify/${draft.id}`))?.status(), "auditor, draft").toBe(200);
  await expect(auditor.getByRole("status")).toContainText("All records match");
  await auditor.context().close();
});

test("tampering: an inflated verified count turns check 1 red with the explanation; case_events refuses UPDATE", async ({ browser }) => {
  const report = await makeReport(ORG);
  const page = await staffPage(browser, "lead");
  const restore = await inflateVerifiedCount(report.id);
  try {
    await page.goto(`/verify/${report.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Evidence check" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("changed after it was generated");
    await expect(page.getByRole("status")).not.toContainText("All records match");
    await expect(page.getByTestId("evidence-line")).toHaveText(/^Problems found: the report was changed after it was generated/);
    await evidenceContract(page, "verify (tampered)");
    const checks = page.getByRole("region", { name: "The five checks" });
    await expect(checks).toContainText("Report unchanged: Failed");
    await expect(checks).toContainText("The two fingerprints are different.");
    await expect(checks).toContainText("Records intact: Passed"); // the case histories themselves are fine
    await expect(checks).toContainText("Signed by AccessLoop at sign-off: Not signed yet"); // a draft is not signed
    // Every row's "Report unchanged" cell says so in words.
    const unchangedCells = page.getByRole("table", { name: "Records" }).locator("tbody > tr > td:nth-of-type(1)");
    const texts = await unchangedCells.allTextContents();
    expect(texts.length).toBeGreaterThan(0);
    expect(new Set(texts.map((t) => t.trim()))).toEqual(new Set(["Changed"]));
    await axeBothThemes(page, "verify (tampered)");
    await noSideScrollAt320(page, "verify (tampered)");
  } finally {
    await restore();
  }
  await page.reload();
  await expect(page.getByRole("status")).toContainText("All records match");

  // The event log itself cannot be edited: the trigger refuses, even for the database owner.
  await withSql(ownerSql, async (sql) => {
    const ev = await anyEventId(sql, ORG);
    await expect(
      sql.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${ev.orgId}, true)`;
        await tx`update case_events set payload = payload where id = ${ev.id}::bigint`;
      }),
    ).rejects.toThrow(/append-only/);
  });
  await page.context().close();
});
