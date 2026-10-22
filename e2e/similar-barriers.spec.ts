// Phase 7 T2 item 10 (docs/domain.md §6.2): "Similar past barriers" on the staff case page. Lead only, once the case
// has an area and a public summary. The candidates are the org's cases with the same area and place from the last
// 24 months (public summaries only); the AI (the fake backend here: Playwright forces FAKE_LLM=1) points out the ones
// that may be the same barrier only when the lead presses the button, and nothing about the case changes. Specs
// share one database and earlier runs leave cases behind: never assume fixed counts.
import { test, expect, type Browser, type Page } from "@playwright/test";
import { expectNoAxeViolations, signInAs } from "./helpers";
import { caseFacts, fileReport, moveCase } from "./fixtures/cases";
import { triageWithSummary } from "./fixtures/similar";

const ORG = "maple-harbour";
const stamp = () => Date.now().toString(36);

async function leadPage(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, "E2E_LEAD_EMAIL");
  return page;
}

async function openCase(page: Page, ref: string) {
  const res = await page.goto(`/app/cases/${ref}`);
  expect(res?.status(), ref).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${ref}`) })).toBeVisible();
}

const panel = (page: Page) => page.getByRole("region", { name: "Similar past barriers" });

/**
 * axe from the top of the page, once animations are done: the staff header is sticky from 64rem, and a button that
 * axe meets scrolled under it reads as an "obscured" target (not a real overlap; focus is kept clear by
 * scroll-padding), as in e2e/reports.spec.ts and e2e/dashboard.spec.ts. Scrolling never moves focus.
 */
async function axe(page: Page, label: string) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
    window.scrollTo(0, 0);
  });
  await expectNoAxeViolations(page, label);
}

async function axeBothThemes(page: Page, label: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await axe(page, `${label} (${colorScheme})`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test("the lead asks for similar past barriers: the AI's picks are candidates, and nothing changes", async ({ browser }) => {
  // Two reports of the same hearing loop (the fake's "hearing loop" topic), the older one triaged first.
  const older = await fileReport(ORG, { text: `The hearing loop at the branch counter was switched off again (${stamp()}).` });
  await triageWithSummary(ORG, older.ref, "The hearing loop at a branch counter was switched off.");
  const newer = await fileReport(ORG, { text: `The hearing loop at the counter does not work, I can't hear the teller (${stamp()}).` });
  await triageWithSummary(ORG, newer.ref, "The hearing loop at a branch counter did not work.");
  const before = await caseFacts(ORG, newer.ref);

  const page = await leadPage(browser);
  await openCase(page, newer.ref);
  const similar = panel(page);
  await expect(similar).toBeVisible();
  await expect(similar).toContainText("same area (The built environment) and place (At a place)");
  await axeBothThemes(page, "case: similar past barriers");

  await similar.getByRole("button", { name: "Find similar past barriers" }).click();
  const heading = similar.getByRole("heading", { level: 3, name: /^AI suggestion: \d+ past cases? may be the same barrier$/ });
  await expect(heading).toBeFocused();
  await expect(page.getByRole("status")).toContainText(/The AI suggests \d+ past cases? that may be the same barrier/);
  // Newest first: the older report of this run is the closest hearing-loop case before any earlier run's.
  const first = similar.getByRole("listitem").first();
  await expect(first.getByRole("link", { name: older.ref, exact: true })).toHaveAttribute("href", `/app/cases/${older.ref}`);
  await expect(first).toContainText("The hearing loop at a branch counter was switched off.");
  await expect(first).toContainText("Why it may be the same: Both are about a hearing loop that did not work.");
  await expect(first).toContainText("Triaged");
  await expect(similar).toContainText("Suggested by simulated AI, for testing");
  await expect(similar.getByRole("link", { name: newer.ref, exact: true })).toHaveCount(0); // never the case itself
  await axeBothThemes(page, "case: similar past barriers, AI suggestion");

  // The plain list of candidates (no AI) is behind a disclosure, as a real table.
  await similar.getByRole("button", { name: /^All \d+ cases? with the same area and place$/ }).click();
  const table = similar.getByRole("table", { name: /^Cases with the same area and place/ });
  await expect(table.getByRole("row").filter({ hasText: older.ref })).toHaveCount(1);
  await expect(table.getByRole("row").filter({ hasText: newer.ref })).toHaveCount(0);
  await axe(page, "case: similar past barriers, all candidates");

  // Nothing was merged, closed or recorded: same status, same events.
  await expect(page.getByTestId("case-status")).toHaveText("Triaged");
  const after = await caseFacts(ORG, newer.ref);
  expect(after.status).toBe(before.status);
  expect(after.events).toHaveLength(before.events.length);
  expect((await caseFacts(ORG, older.ref)).status).toBe("triaged");
  await page.context().close();
});

test("no look-alike: the AI says so; before triage, and for an auditor or an owner, there is no panel", async ({ browser }) => {
  const lone = await fileReport(ORG, { text: `The water fountain in the branch lobby is too high to reach (${stamp()}).` });
  const page = await leadPage(browser);

  // New (not triaged yet): nothing to compare, so no panel.
  await openCase(page, lone.ref);
  await expect(panel(page)).toHaveCount(0);

  await triageWithSummary(ORG, lone.ref, "The water fountain in a branch lobby was too high to reach from a wheelchair.");
  await openCase(page, lone.ref);
  const similar = panel(page);
  await similar.getByRole("button", { name: "Find similar past barriers" }).click();
  await expect(similar.getByRole("heading", { level: 3, name: "AI suggestion: no past case looks like the same barrier" })).toBeFocused();
  await expect(similar).toContainText("The AI found no past case that looks like the same barrier");
  await expect(similar.getByRole("listitem")).toHaveCount(0);
  await axe(page, "case: similar past barriers, none");
  await page.context().close();

  // The auditor (read-only) opens the same triaged case, which has candidates: the panel is the lead's only.
  const auditor = await (await browser.newContext()).newPage();
  await auditor.goto("/sign-in");
  await auditor.getByRole("button", { name: /^Sign in as Internal audit .*Maple Harbour/ }).click();
  await auditor.waitForURL(/\/app\//);
  await openCase(auditor, lone.ref);
  await expect(panel(auditor)).toHaveCount(0);
  await expect(auditor.getByRole("button", { name: "Find similar past barriers" })).toHaveCount(0);
  await auditor.context().close();

  // The assigned owner opens the case: the panel is the lead's only.
  const owned = await fileReport(ORG, { text: `The side door does not open with the button (${stamp()}).` });
  await moveCase(ORG, owned.ref, "assigned");
  const owner = await (await browser.newContext()).newPage();
  await signInAs(owner, "E2E_OWNER_EMAIL");
  await openCase(owner, owned.ref);
  await expect(owner.getByRole("button", { name: "Log fix" })).toBeVisible();
  await expect(panel(owner)).toHaveCount(0);
  await expect(owner.getByRole("button", { name: "Find similar past barriers" })).toHaveCount(0);
  await owner.context().close();
});
