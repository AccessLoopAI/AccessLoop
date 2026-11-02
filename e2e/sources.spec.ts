// The scenario cases (docs/archive/phase7-prompt.md T6 item 1; data/scenarios.json through lib/scenarios.ts): the public
// /sources page (axe in light and dark, forced colours, reflow at 320 px, one h1, the one status region and the one
// "Get help", every scenario and its source), and the note on a scenario case's staff page, shown to the made-up
// Kestrel Bay Group's lead and to no Maple Harbour case. Read-only: nothing here writes to the database.
import { test, expect, type Page } from "@playwright/test";
import { expectReflow } from "./a11y-checks";
import { expectNoAxeViolations, signInAs } from "./helpers";
import { SCENARIO_ORG, SCENARIOS, scenarioNote, scenarioSource } from "@/lib/scenarios";

const LOCAL = process.env.AUTH_MODE === "local";
const H1 = "Where our scenario cases come from";

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`/sources: every scenario with its source, axe, ${scheme} theme`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: scheme });
    const page = await context.newPage();
    const res = await page.goto("/sources");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(H1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("status")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Get help" })).toHaveCount(1);
    for (const s of SCENARIOS) {
      const item = page.locator(`#scenario-${s.id}`);
      await expect(item.getByRole("heading", { level: 3, name: s.theme })).toBeVisible();
      await expect(item.getByText(scenarioNote(scenarioSource(s)), { exact: true })).toBeVisible();
      await expect(item.getByRole("link")).toHaveAttribute("href", scenarioSource(s).url);
    }
    await settle(page);
    await expectNoAxeViolations(page, `/sources (${scheme})`);
    await context.close();
  });
}

test("/sources: forced colours, and no sideways scroll at 320px (WCAG 1.4.10)", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const page = await context.newPage();
  await page.goto("/sources");
  await settle(page);
  await expectReflow(page, "/sources");
  await page.emulateMedia({ forcedColors: "active" });
  await settle(page);
  await expectNoAxeViolations(page, "/sources (forced colours, 320px)");
  await context.close();
});

test.describe("the note on a scenario case", () => {
  test.skip(!LOCAL, "signs in as the scenario org's lead through the local 'Sign in as' page");

  test("the scenario org's lead sees it on each scenario case, with the source link, and axe passes", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: new RegExp(`^Sign in as Riley Brennan .*${SCENARIO_ORG.name}`) }).click();
    await page.waitForURL(/\/app\/dashboard/);
    await expectNoAxeViolations(page, `${SCENARIO_ORG.name} dashboard`);

    for (const s of [SCENARIOS[0], SCENARIOS.at(-1)!]) {
      const src = scenarioSource(s);
      await page.goto(`/app/cases/${s.ref}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(s.ref);
      const note = page.getByTestId("scenario-note");
      await expect(note).toHaveText(`${scenarioNote(src)}.`);
      await expect(note.getByRole("link", { name: src.url })).toHaveAttribute("href", src.url);
      await settle(page);
      await expectNoAxeViolations(page, `scenario case ${s.ref}`);
    }

    await page.getByRole("link", { name: "Every scenario and the report it comes from" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(H1);
  });

  test("a Maple Harbour case with the same ref has no note (refs repeat across orgs)", async ({ page }) => {
    await signInAs(page, "E2E_LEAD_EMAIL");
    await page.goto(`/app/cases/${SCENARIOS[0].ref}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(SCENARIOS[0].ref);
    await expect(page.getByTestId("scenario-note")).toHaveCount(0);
  });
});
