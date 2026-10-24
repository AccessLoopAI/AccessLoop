// Progress reports (docs/domain.md §7; handoff Phase 4 items 2-3; CLAUDE.md signature moment 2): the list and its one
// "New report" link, "Generate draft" with field errors, the draft as a publication (exact h2 headings, each section
// a region, exactly one region whose name contains "Feedback", the "Report checks" region and "All required checks
// pass", footnote "Sources for this sentence (N records)" buttons opening a list named "Sources", one "Verify
// evidence chain" link), "Draft ready" announced with focus on the heading, the lead's text per area and
// Consultations (focus stays on its Save button), sign-off (immutable afterwards, even from a stale tab), publishing
// (the ACR s.16 48-hour reminder), the public org page and published report (same sources, refs as plain text), the
// plain-text export, privacy (drafts never public, other orgs 404, owners 404) and the auditor's read-only view;
// every report action (Generate draft, Save, Sign off, Publish) refused to an owner, an auditor and another org's
// lead pressing it on a lead's open page; the public pages' rate limit (counted once per request, title included);
// the publication stylesheet really applied; 44px links on the public org page.
// axe in light AND dark on the list, the new-report page, the draft and the published page; no sideways scroll at 320.
// Specs share one database: never assume fixed counts (every run adds reports).
import { randomBytes } from "node:crypto";
import { test, expect, type Browser, type Locator, type Page } from "@playwright/test";
import { expectNoAxeViolations, signInAs } from "./helpers";
import { orgId, ownerSql, withSql } from "./db";
import { makeReport, type MadeReport } from "./fixtures/reports";

const ORG = "maple-harbour";
const LOCAL = process.env.AUTH_MODE === "local";
const SOURCES_NAME = /^Sources for this sentence \(\d+ records?\)$/;
const TITLE = /^Accessibility progress report 2026, version \d+$/;
const UUID_PATH = /\/app\/reports\/([0-9a-f-]{36})$/;
type Role = "lead" | "owner" | "auditor" | "other-lead";

test.describe.configure({ mode: "serial" });

/** A made-up loopback client address (127.x.y.z) per anonymous context, so public pages count against their own rate-limit bucket. */
const freshIp = () => ((b: Buffer) => `127.${1 + (b[0] % 255)}.${b[1]}.${b[2]}`)(randomBytes(3));

async function signInAsRole(page: Page, role: Role) {
  if (role === "lead") return signInAs(page, "E2E_LEAD_EMAIL");
  if (role === "owner") return signInAs(page, "E2E_OWNER_EMAIL");
  if (role === "other-lead") return signInAs(page, "E2E_OTHER_LEAD_EMAIL");
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /^Sign in as Internal audit .*Maple Harbour/ }).click();
  await page.waitForURL(/\/app\//);
}

async function staffPage(browser: Browser, role: Role) {
  const page = await (await browser.newContext()).newPage();
  await signInAsRole(page, role);
  return page;
}

async function publicPage(browser: Browser) {
  return (await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } })).newPage();
}

/**
 * Wait for running CSS transitions and animations (the building moment, a theme switch) before axe, then back to the
 * top: the staff header is sticky from 64rem, and a button scrolled under it reads to axe as an "obscured" target
 * (content under a sticky header, not a real overlap; focus is kept clear by scroll-padding), as in dashboard.spec.
 * Scrolling never moves focus, so the focus checks after it still hold.
 */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
    window.scrollTo(0, 0);
  });
}

/** axe in the light theme, then the dark theme, on the same page and state; back to light afterwards. */
async function axeBothThemes(page: Page, label: string) {
  await page.emulateMedia({ colorScheme: "light" });
  await settle(page);
  await expectNoAxeViolations(page, `${label} (light)`);
  await page.emulateMedia({ colorScheme: "dark" });
  await settle(page);
  await expectNoAxeViolations(page, `${label} (dark)`);
  await page.emulateMedia({ colorScheme: "light" });
  await settle(page);
}

/** Reflow (WCAG 1.4.10): at 320 CSS px nothing scrolls the page sideways. */
async function noSideScrollAt320(page: Page, label: string) {
  const size = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 800 });
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, `${label}: page width at 320px`).toBeLessThanOrEqual(320);
  if (size) await page.setViewportSize(size);
}

/** One h1, the one global StatusRegion, one "Get help" (CLAUDE.md accessibility contract). */
async function pageContract(page: Page, label: string) {
  await expect(page.getByRole("heading", { level: 1 }), label).toHaveCount(1);
  await expect(page.getByRole("status"), label).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Get help" }), label).toHaveCount(1);
}

/**
 * The publication stylesheet really reached the page. A stale build once shipped without it: every sentence showed
 * its print-only "Sources: …" line, the sheet had no edge, the check rings drew as page-wide discs, and axe passed.
 */
async function publicationStyled(page: Page, label: string, { rings = true } = {}) {
  const s = await page.evaluate(() => {
    const style = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el) : null;
    };
    const rings = [...document.querySelectorAll("svg.al-check-ring")].map((r) => r.getBoundingClientRect().width);
    return { printSources: style(".al-print-sources")?.display ?? "missing", sheetEdge: style(".al-sheet")?.borderTopWidth ?? "missing", rings };
  });
  expect(s.printSources, `${label}: the print-only sources line is hidden on screen`).toBe("none");
  expect(s.sheetEdge, `${label}: the sheet has its edge`).toMatch(/^[1-9][\d.]*px$/);
  if (rings) expect(s.rings.length, `${label}: the check rings`).toBeGreaterThan(0);
  for (const w of s.rings) expect(w, `${label}: a check ring's width`).toBeLessThanOrEqual(64);
}

async function generate(page: Page): Promise<string> {
  await page.goto("/app/reports/new");
  await page.getByLabel("Period start").fill("2026-01-01");
  await page.getByLabel("Period end").fill("2026-12-31");
  await page.getByRole("button", { name: "Generate draft" }).click();
  await page.waitForURL(UUID_PATH);
  await expect(page.getByRole("region", { name: "Report checks" })).toBeVisible();
  return UUID_PATH.exec(new URL(page.url()).pathname)![1];
}

/** Every text box of a draft (plan areas, then Consultations), written and saved one by one. */
async function writeEveryPart(page: Page) {
  const boxes = page.getByRole("textbox");
  const n = await boxes.count();
  expect(n).toBeGreaterThan(1);
  for (let i = 0; i < n; i++) {
    const box = boxes.nth(i);
    const id = await box.getAttribute("id");
    await box.fill(`Progress written by the e2e test (${id}).`);
    // (A `has:` locator is evaluated inside each form, so pick the form by its text box's id.)
    const save = page.locator(`form:has(#${id})`).getByRole("button", { name: /^Save .+ text$/ });
    await save.click();
    await expect(page.getByTestId(`${id}-result`)).toContainText("Saved.");
    await expect(save).toBeFocused(); // focus stays where the person is (never thrown to the top of a long document)
  }
}

let draftId = ""; // generated in the UI; stays a draft (privacy checks)
let published: MadeReport;

test("the reports list: the lead's one 'New report' link, axe in both themes", async ({ browser }) => {
  const page = await staffPage(browser, "lead");
  await page.goto("/app/reports");
  await expect(page.getByRole("heading", { level: 1, name: "Progress reports" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New report" })).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page");
  await pageContract(page, "reports list");
  await axeBothThemes(page, "reports list");
  await noSideScrollAt320(page, "reports list");

  await page.getByRole("link", { name: "New report" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New progress report" })).toBeFocused();
  await expect(page.getByLabel("Period start")).toHaveValue(/^\d{4}-01-01$/);
  await expect(page.getByLabel("Period end")).toHaveValue(/^\d{4}-12-31$/);
  await pageContract(page, "new report");
  await axeBothThemes(page, "new report");
  await noSideScrollAt320(page, "new report");

  // A period that ends before it starts: the summary takes focus, the field says what to do, nothing is built.
  await page.getByLabel("Period start").fill("2026-12-31");
  await page.getByLabel("Period end").fill("2026-01-01");
  await page.getByRole("button", { name: "Generate draft" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "There is a problem" })).toBeVisible();
  await expect(page.locator(":focus")).toContainText("The last day must be on or after the first day.");
  await expect(page.getByLabel("Period end")).toHaveAttribute("aria-invalid", "true");
  expect(new URL(page.url()).pathname).toBe("/app/reports/new");
  await axeBothThemes(page, "new report: errors");
  await page.context().close();
});

test("Generate draft: the report builds itself, 'Draft ready', every heading, the checks and the sources", async ({ browser }) => {
  const page = await staffPage(browser, "lead");
  draftId = await generate(page);

  // Signature moment 2: the sections fill in while the checks tick (CSS), "Draft ready" is the one announcement and
  // focus is on the draft's heading.
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toHaveText(TITLE);
  await expect(h1).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("Draft ready");
  await expect(page.locator("[data-building]")).toHaveCount(1);

  const checks = page.getByRole("region", { name: "Report checks" });
  await expect(checks).toContainText("All required checks pass");
  await expect(checks).toContainText(/\d+ parts? still needs? your text/);
  await expect(page.getByRole("region", { name: /report checks/i })).toHaveCount(1);

  for (const h of ["General", "Consultations", "Feedback", "The built environment", "Information and communication technologies"]) {
    const heading = page.getByRole("heading", { level: 2, name: h, exact: true });
    await expect(heading).toHaveCount(1);
    await expect(page.getByRole("region", { name: h, exact: true })).toHaveCount(1);
  }
  await expect(page.getByRole("region", { name: /feedback/i })).toHaveCount(1); // demo.spec: exactly one
  await expect(page.getByRole("link", { name: "Verify evidence chain" })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Verify evidence chain" })).toHaveAttribute("href", `/verify/${draftId}`);
  await pageContract(page, "draft");
  await publicationStyled(page, "draft");

  const feedback = page.getByRole("region", { name: "Feedback" });
  await expect(feedback).toContainText("confirmed by the person who reported");
  await expect(feedback.getByRole("heading", { level: 3, name: "What happened to the feedback" })).toBeVisible();
  const sources = feedback.getByRole("button", { name: SOURCES_NAME });
  expect(await sources.count()).toBeGreaterThan(2);
  const first = sources.first();
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(feedback.getByRole("list", { name: "Sources" })).toHaveCount(0); // closed panels are hidden
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  const list = feedback.getByRole("list", { name: "Sources" });
  await expect(list).toHaveCount(1);
  await expect(list).toContainText(/BAR-\d{4}/);
  await expect(list.getByRole("link", { name: /^Open BAR-\d{4}$/ }).first()).toHaveAttribute("href", /^\/app\/cases\/BAR-\d{4}$/);
  // Every generated sentence in every section ends with its footnote button.
  for (const name of await page.getByRole("button", { name: /^Sources for this sentence/ }).allTextContents()) expect(name.trim()).toMatch(SOURCES_NAME);
  await axeBothThemes(page, "draft with sources open");
  await noSideScrollAt320(page, "draft with sources open");
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(feedback.getByRole("list", { name: "Sources" })).toHaveCount(0);

  // A reload neither replays the building moment nor announces it again.
  await page.reload();
  await expect(page.getByRole("region", { name: "Report checks" })).toBeVisible();
  await expect(page.locator("[data-building]")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("");

  // The list now has it, with its status.
  await page.goto("/app/reports");
  const row = page.getByRole("row").filter({ has: page.locator(`a[href="/app/reports/${draftId}"]`) });
  await expect(row).toContainText("Draft");
  await expect(row).toContainText("All pass");
  await page.context().close();
});

test("the lead writes every part, signs off (nothing can change after, even from a stale tab) and publishes", async ({ browser }) => {
  const page = await staffPage(browser, "lead");
  const id = await generate(page);

  // Sign-off waits for the text.
  await page.getByRole("button", { name: "Sign off" }).click();
  await expect(page.getByTestId("report-result")).toContainText(/Not signed off yet: \d+ parts? still needs? your text/);
  await expect(page.getByTestId("report-result")).toBeFocused();

  await writeEveryPart(page);
  const checks = page.getByRole("region", { name: "Report checks" });
  await expect(checks).toContainText("Every part has its text");
  await expect(checks).toContainText("All required checks pass");
  await axeBothThemes(page, "draft with every part written");

  // A second tab, still showing the draft's text boxes.
  const stale = await page.context().newPage();
  await stale.goto(`/app/reports/${id}`);
  await expect(stale.getByRole("textbox").first()).toBeVisible();

  await page.getByRole("button", { name: "Sign off" }).click();
  await expect(page.getByTestId("report-result")).toContainText("Signed off.");
  await expect(page.getByTestId("report-result")).toBeFocused();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign off" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Save / })).toHaveCount(0);
  await expect(page.locator("[data-report-state]").first()).toHaveText("Signed off");
  await expect(page.getByRole("region", { name: "Sign off and publish" })).toContainText(/Signed off by Alex Rivera/);

  // Immutable: the stale tab's save and sign-off are refused, and the text stays as signed off.
  const box = stale.getByRole("textbox").first();
  const boxId = await box.getAttribute("id");
  await box.fill("Changed after sign-off.");
  await stale.locator(`form:has(#${boxId})`).getByRole("button", { name: /^Save .+ text$/ }).click();
  await expect(stale.getByTestId(`${boxId}-result`)).toContainText("This report is signed off, so it can't change.");
  await stale.getByRole("button", { name: "Sign off" }).click();
  await expect(stale.getByTestId("report-result")).toContainText("This report is signed off, so it can't change.");
  await stale.close();
  await page.reload();
  await expect(page.getByRole("main")).not.toContainText("Changed after sign-off.");

  // Not public until published.
  const anon = await publicPage(browser);
  expect((await anon.goto(`/p/${ORG}/reports/${id}`))?.status()).toBe(404);

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByTestId("report-result")).toContainText("Published.");
  await expect(page.locator("[data-report-state]").first()).toHaveText("Published");
  await expect(page.getByText("Tell the Accessibility Commissioner within 48 hours")).toBeVisible();
  await expect(page.getByText("AccessLoop doesn’t send this notice.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View the published page" })).toHaveAttribute("href", `/p/${ORG}/reports/${id}`);
  await axeBothThemes(page, "published report (staff)");

  // The staff plain-text download.
  const staffText = await page.request.get(`/app/reports/${id}/text`);
  expect(staffText.status()).toBe(200);
  expect(await staffText.text()).toContain("Signed off on");

  // The public org page lists it; the published page has the same structure and sources, refs as plain text.
  expect((await anon.goto(`/p/${ORG}`))?.status()).toBe(200);
  await expect(anon.getByRole("heading", { level: 1, name: /: accessibility feedback$/ })).toBeVisible();
  await expect(anon.getByRole("link", { name: "Report a barrier online" })).toHaveAttribute("href", `/o/${ORG}/report`);
  const link = anon.locator(`a[href="/p/${ORG}/reports/${id}"]`);
  await expect(link).toHaveText(TITLE);
  await pageContract(anon, "public org page");
  // Links that stand alone (not inside a sentence) are 44px targets (CLAUDE.md; the /accessibility page says so).
  for (const [what, l] of [["report title", link], ["phone", anon.locator('a[href^="tel:"]').first()], ["email", anon.locator('a[href^="mailto:"]').first()]] as const) {
    expect((await l.boundingBox())!.height, `public org page: ${what} link height`).toBeGreaterThanOrEqual(44);
  }
  await axeBothThemes(anon, "public org page");
  await noSideScrollAt320(anon, "public org page");

  await link.click();
  await expect(anon.getByRole("heading", { level: 1 })).toHaveText(TITLE);
  for (const h of ["General", "Consultations", "Feedback", "The built environment"]) {
    await expect(anon.getByRole("heading", { level: 2, name: h, exact: true })).toHaveCount(1);
  }
  await expect(anon.getByRole("region", { name: /feedback/i })).toHaveCount(1);
  await expect(anon.getByRole("main")).toContainText("Progress written by the e2e test");
  await expect(anon.getByRole("main")).not.toContainText("Still to write");
  await expect(anon.getByRole("textbox")).toHaveCount(0);
  await expect(anon.getByRole("link", { name: "Verify evidence chain" })).toHaveAttribute("href", `/verify/${id}`);
  const pubFeedback = anon.getByRole("region", { name: "Feedback" });
  const pubFirst = pubFeedback.getByRole("button", { name: SOURCES_NAME }).first();
  await pubFirst.click();
  const pubList = pubFeedback.getByRole("list", { name: "Sources" });
  await expect(pubList).toContainText(/BAR-\d{4}/);
  await expect(pubList.getByRole("link")).toHaveCount(0); // never links into staff pages
  await pageContract(anon, "published report");
  await publicationStyled(anon, "published report", { rings: false });
  await axeBothThemes(anon, "published report with sources open");
  await noSideScrollAt320(anon, "published report");

  // The public plain-text export.
  const res = await anon.request.get(`/p/${ORG}/reports/${id}/text`, { headers: { "x-forwarded-for": freshIp() } });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/plain");
  expect(res.headers()["content-disposition"]).toMatch(/^attachment; filename="accessibility-progress-report-2026-version-\d+\.txt"$/);
  const text = await res.text();
  for (const h of ["GENERAL", "CONSULTATIONS", "FEEDBACK", "SOURCES", "RECORDS"]) expect(text.split("\n")).toContain(h);
  expect(text).toMatch(/\[1\]/);
  expect(text).toMatch(/Fingerprint of this report \(SHA-256\): [0-9a-f]{64}/);
  expect(text).not.toContain("Daniel Okafor");
  await anon.context().close();
  await page.context().close();
});

test("drafts stay private; other orgs and owners get 404; the auditor reads without changing anything", async ({ browser }) => {
  published = await makeReport(ORG, { publish: true });
  const draft = draftId || (await makeReport(ORG)).id;

  const anon = await publicPage(browser);
  for (const path of [`/p/${ORG}/reports/${draft}`, `/p/${ORG}/reports/${draft}/text`, `/p/lakeview-telecom/reports/${published.id}`, `/p/${ORG}/reports/not-a-report`, "/p/no-such-org"]) {
    expect((await anon.goto(path))?.status(), path).toBe(404);
  }
  expect((await anon.goto(`/p/${ORG}/reports/${published.id}`))?.status()).toBe(200);
  await anon.goto("/app/reports");
  await expect(anon).toHaveURL(/\/sign-in$/);
  await anon.context().close();

  const other = await staffPage(browser, "other-lead");
  for (const path of [`/app/reports/${draft}`, `/app/reports/${published.id}`, `/app/reports/${draft}/text`]) {
    expect((await other.goto(path))?.status(), `Lakeview lead ${path}`).toBe(404);
  }
  await other.goto("/app/reports");
  await expect(other.locator(`a[href="/app/reports/${draft}"]`)).toHaveCount(0);
  await other.context().close();

  const owner = await staffPage(browser, "owner");
  await expect(owner.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Reports" })).toHaveCount(0);
  for (const path of ["/app/reports", "/app/reports/new", `/app/reports/${draft}`]) {
    expect((await owner.goto(path))?.status(), `owner ${path}`).toBe(404);
  }
  await owner.context().close();

  test.skip(!LOCAL, "the auditor signs in through the local 'Sign in as' page");
  const auditor = await staffPage(browser, "auditor");
  await auditor.goto("/app/reports");
  await expect(auditor.getByRole("heading", { level: 1, name: "Progress reports" })).toBeVisible();
  await expect(auditor.getByRole("link", { name: "New report" })).toHaveCount(0);
  expect((await auditor.goto("/app/reports/new"))?.status()).toBe(404);
  await auditor.goto(`/app/reports/${draft}`);
  await expect(auditor.getByRole("region", { name: "Report checks" })).toContainText("All required checks pass");
  await expect(auditor.getByRole("textbox")).toHaveCount(0);
  for (const name of [/^Save /, /^Sign off$/, /^Publish$/, /Generate draft/]) await expect(auditor.getByRole("button", { name })).toHaveCount(0);
  await expect(auditor.getByText("Only the lead can sign off.")).toBeVisible();
  await expect(auditor.getByRole("main")).toContainText("Still to write.");
  const sources = auditor.getByRole("region", { name: "Feedback" }).getByRole("button", { name: SOURCES_NAME }).first();
  await sources.click();
  await expect(auditor.getByRole("region", { name: "Feedback" }).getByRole("list", { name: "Sources" })).toContainText(/BAR-\d{4}/);
  await axeBothThemes(auditor, "draft, auditor (read-only)");
  await auditor.goto(`/app/reports/${published.id}`);
  await expect(auditor.getByText(/Tell the Accessibility Commissioner within 48 hours/)).toBeVisible();
  await expect(auditor.getByRole("button", { name: /^Publish$/ })).toHaveCount(0);
  const text = await auditor.request.get(`/app/reports/${published.id}/text`);
  expect(text.status()).toBe(200);
  await auditor.context().close();
});

/* ------------------------------------------------------------------ every report action refuses the wrong caller */

const ROLE_REFUSED = "Your role can't do this. Nothing was saved.";
const NOT_FOUND = "We can't find this report. Nothing was saved.";

/** What a report action could change: each report's state and text, and how many reports the org has. */
async function reportsNow(ids: string[]): Promise<{ rows: Record<string, unknown>[]; count: number }> {
  return withSql(ownerSql, async (sql) => {
    const org = await orgId(sql, ORG);
    return (await sql.begin(async (tx) => {
      await tx`select set_config('app.org_id', ${org}, true)`;
      const rows = await tx`
        select id::text as id, status, signed_off_at::text as "signedOffAt", published_at::text as "publishedAt",
          area_text::text as "areaText", consultations_text as "consultationsText"
        from reports where id::text in ${tx(ids)} order by id`;
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from reports where org_id = ${org}`;
      return { rows: rows.map((r) => ({ ...r })), count: n };
    })) as { rows: Record<string, unknown>[]; count: number };
  });
}

/** Press a button and wait for its server action's answer (the result line may already hold the same words). */
async function press(page: Page, button: Locator) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), button.click()]);
}

test("every report action refuses an owner, an auditor or another org's lead, even from a lead's open page", async ({ browser }) => {
  test.skip(!LOCAL, "switches sessions through the local 'Sign in as' page");
  test.setTimeout(120_000);
  const draft = await makeReport(ORG);
  const signed = await makeReport(ORG, { signOff: true });

  // The lead's own pages, open in one browser context: a new report with its dates filled, a draft with text typed
  // in its first box, and a signed-off report with its Publish button. Then the session changes under them.
  const context = await browser.newContext();
  const pages = { generate: await context.newPage(), draft: await context.newPage(), signed: await context.newPage() };
  await signInAsRole(pages.generate, "lead");
  await pages.generate.goto("/app/reports/new");
  await pages.generate.getByLabel("Period start").fill("2026-01-01");
  await pages.generate.getByLabel("Period end").fill("2026-12-31");
  await pages.draft.goto(`/app/reports/${draft.id}`);
  const box = pages.draft.getByRole("textbox").first();
  const boxId = (await box.getAttribute("id"))!;
  await box.fill("Written after the session changed to someone who is not this report's lead.");
  await pages.signed.goto(`/app/reports/${signed.id}`);
  await expect(pages.signed.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
  const before = await reportsNow([draft.id, signed.id]);
  expect(before.rows.map((r) => r.status).sort()).toEqual(["draft", "signed_off"]);

  const switcher = await context.newPage();
  for (const role of ["owner", "auditor", "other-lead"] as const) {
    await signInAsRole(switcher, role);
    // Another org's lead may build drafts, but only of their own org (the org comes from the session): not tried
    // here, so no Lakeview report is made. For them this org's reports do not exist.
    const refused = role === "other-lead" ? NOT_FOUND : ROLE_REFUSED;
    if (role !== "other-lead") {
      await press(pages.generate, pages.generate.getByRole("button", { name: "Generate draft" }));
      await expect(pages.generate.getByTestId("new-report-result"), role).toContainText(ROLE_REFUSED);
      expect(new URL(pages.generate.url()).pathname, `${role}: no draft opened`).toBe("/app/reports/new");
    }
    await press(pages.draft, pages.draft.locator(`form:has(#${boxId})`).getByRole("button", { name: /^Save .+ text$/ }));
    await expect(pages.draft.getByTestId(`${boxId}-result`), role).toContainText(refused);
    await press(pages.draft, pages.draft.getByRole("button", { name: "Sign off" }));
    await expect(pages.draft.getByTestId("report-result"), role).toContainText(refused);
    await press(pages.signed, pages.signed.getByRole("button", { name: "Publish", exact: true }));
    await expect(pages.signed.getByTestId("report-result"), role).toContainText(refused);
    expect(await reportsNow([draft.id, signed.id]), `${role}: nothing changed`).toEqual(before);
  }
  await context.close();
  const anon = await publicPage(browser);
  expect((await anon.goto(`/p/${ORG}/reports/${signed.id}`))?.status(), "the signed-off report stays unpublished").toBe(404);
  await anon.context().close();
});

/* ------------------------------------------------------------------ the public pages' rate limit */

test("over the public limit: the page and its title say so, and every request counts once", async ({ request }) => {
  const report = published ?? (await makeReport(ORG, { publish: true }));
  // Fixed 10-minute windows (lib/rate-limit.ts): start well inside one, so the count can't reset halfway.
  const left = 10 * 60_000 - (Date.now() % (10 * 60_000));
  if (left < 30_000) await new Promise((resolve) => setTimeout(resolve, left + 1_000));
  const headers = { "x-forwarded-for": freshIp() };
  // public_report allows 240 requests a window. The metadata and the page both check the limit, and each request is
  // still counted once: all 240 are let through (an id that is not a report: a 404 without a query).
  for (let i = 0; i < 240; i += 24) {
    const statuses = await Promise.all(
      Array.from({ length: 24 }, () => request.get(`/p/${ORG}/reports/not-a-report`, { headers }).then((r) => r.status())),
    );
    expect(statuses.every((s) => s === 404), `requests ${i + 1}-${i + 24} are within the limit`).toBe(true);
  }
  const over = await (await request.get(`/p/${ORG}/reports/${report.id}`, { headers })).text();
  expect(over).toContain("<title>Please wait a few minutes | AccessLoop</title>"); // the title says what the page says
  expect(over).toContain("Too many tries from this connection. Please wait a few minutes and try again.");
  expect(over).not.toContain(report.title); // the report was never loaded
  const org = await (await request.get(`/p/${ORG}`, { headers })).text(); // the same bucket
  expect(org).toContain("<title>Please wait a few minutes | AccessLoop</title>");
  expect(org).not.toContain("How to give feedback");
  // Another address is not affected.
  const fresh = await (await request.get(`/p/${ORG}/reports/${report.id}`, { headers: { "x-forwarded-for": freshIp() } })).text();
  expect(fresh).toContain(report.title);
});
