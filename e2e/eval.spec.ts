// /app/eval (lead only; CLAUDE.md "Routes"): the latest saved eval result (eval/results, written by `npm run eval`) as
// accessible tables, with axe in the light AND dark theme and reflow at 320 px; owners and auditors get 404 and no
// "Eval" tab. What the page should say is read from the same files with the same code (lib/eval/results.ts), never
// hard-coded: a new eval run changes the numbers. The empty state ("No eval run yet") is unit-tested in
// tests/eval-page.test.ts (the results folder can't be emptied under a running server), and so are the views of an
// earlier run and the holdout hint, which need more saved runs than the folder may hold.
// A MEASURED run's view (the default once a claude-cli or api run is saved: repeats, cost per report, other sets'
// tables) can't come from eval/results either: only fake runs are saved there, and a sample "real" run must never be.
// Its axe check renders the page's own component from sample files in a temp folder (tests/support/eval-sample.ts)
// and puts that markup into the live page, so it is checked with the real styles in both themes and at 320 px.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { expectNoAxeViolations, signInAs } from "./helpers";
import { EvalReport } from "@/app/(staff)/app/eval/EvalReport";
import { piiHeadline } from "@/lib/eval/present";
import { allRepeats, listEvalResults, pickLatest } from "@/lib/eval/results";
import { asSet, measuredSample, SAMPLE_PRICES, writeSampleFolder } from "@/tests/support/eval-sample";

const SIMULATED = "Simulated: fake AI, not a measurement";
const MEASURED_API = "Measured with the Anthropic API";
const CLAUDE_CLI = "claude-cli results are for the team's own development and are never published";
const NOT_FOUND = "That saved run was not found";
const EARLIER = "An earlier saved run";

async function settle(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
}

async function asAuditor(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /^Sign in as Internal audit .*Maple Harbour/ }).click();
  await page.waitForURL(/\/app\//);
  return page;
}

test("the lead sees the latest saved eval result as tables, axe-clean in both themes and at 320 px", async ({ browser }) => {
  const { main } = pickLatest(await listEvalResults());
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, "E2E_LEAD_EMAIL");

  const tab = page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Eval", exact: true });
  await tab.click();
  await expect(page).toHaveURL(/\/app\/eval$/);
  await expect(page.getByRole("heading", { level: 1, name: "AI evaluation" })).toBeVisible();
  await expect(tab).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("status")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Get help" })).toHaveCount(1);

  if (!main) {
    await expect(page.getByRole("heading", { level: 2, name: "No eval run yet" })).toBeVisible();
  } else {
    const r = main.result;
    await expect(page.getByText(piiHeadline(allRepeats(r).map((x) => x.metrics)))).toBeVisible();
    // The run shown says what kind it is; every simulated run in "Saved runs" carries the same label.
    const kind = page.getByTestId("eval-run-kind");
    await expect(kind.getByText(SIMULATED, { exact: true })).toHaveCount(r.simulated ? 1 : 0);
    await expect(kind.getByText(CLAUDE_CLI)).toHaveCount(r.backend === "claude-cli" ? 1 : 0);
    const saved = page.getByRole("table", { name: /^Every saved eval run/ });
    await expect(saved.getByRole("cell", { name: SIMULATED, exact: true })).toHaveCount((await listEvalResults()).results.filter((s) => s.result.simulated).length);
    for (const caption of [
      /^Removed before human review, by type/,
      /^Classification/,
      /^Injection, abstention and errors/,
      /^Time, tokens and cost per test report/,
      /^Time and tokens per AI call/,
      /^Run details/,
    ]) {
      const table = page.getByRole("table", { name: caption });
      await expect(table).toHaveCount(1);
      await expect(table.locator("th[scope=row]").first()).toBeVisible();
    }
    if (Object.keys(r.metrics.classification.confusion).length) {
      await expect(page.getByRole("table", { name: /^Confusion matrix/ }).locator("th[scope=col]").first()).toBeVisible();
    }
    if (!r.textOmitted) {
      await expect(page.getByRole("table", { name: /^Results per test report/ }).getByRole("rowheader")).toHaveCount(r.predictions.length);
    }
    await expect(page.getByRole("table", { name: /^Every saved eval run/ }).getByRole("rowheader", { name: new RegExp(main.file.replace(/\./g, "\\.")) })).toHaveCount(1);
  }

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await settle(page);
    await expectNoAxeViolations(page, `/app/eval (${colorScheme})`);
  }
  await page.emulateMedia({ colorScheme: "light" });

  await page.setViewportSize({ width: 320, height: 800 });
  await settle(page);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, "/app/eval page width at 320 px").toBeLessThanOrEqual(320);
  await expectNoAxeViolations(page, "/app/eval (320 px)");
  await page.context().close();
});

test("?run= opens a saved run by its file name; a name that isn't saved says so and shows the latest", async ({ browser }) => {
  const listing = await listEvalResults();
  const { main } = pickLatest(listing);
  test.skip(!main, "no eval result is saved in eval/results");
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, "E2E_LEAD_EMAIL");

  const headline = piiHeadline(allRepeats(main!.result).map((x) => x.metrics));
  await page.goto(`/app/eval?run=${encodeURIComponent(main!.file)}`);
  await expect(page.getByRole("heading", { level: 1, name: "AI evaluation" })).toBeVisible();
  await expect(page.getByText(headline)).toBeVisible();
  await expect(page.getByText(NOT_FOUND)).toHaveCount(0);
  await expect(page.getByText(EARLIER)).toHaveCount(0);

  await page.goto("/app/eval?run=not-a-saved-run.json");
  await expect(page.getByText(NOT_FOUND)).toBeVisible();
  await expect(page.getByText("not-a-saved-run")).toHaveCount(0); // the name from the link is never echoed
  await expect(page.getByText(headline)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("status")).toHaveCount(1);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await settle(page);
    await expectNoAxeViolations(page, `/app/eval?run= not saved (${colorScheme})`);
  }
  await page.emulateMedia({ colorScheme: "light" });

  // Every other saved run is a link in "Saved runs" (only when this folder holds more than one).
  const other = listing.results.find((s) => s.file !== main!.file);
  if (other) {
    await page.goto("/app/eval");
    await page.getByRole("table", { name: /^Every saved eval run/ }).getByRole("link", { name: other.file, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]run=${encodeURIComponent(other.file).replace(/\./g, "\\.")}$`));
    await expect(page.getByText(EARLIER)).toBeVisible();
    await expectNoAxeViolations(page, "/app/eval?run= an earlier run");
  }
  await page.context().close();
});

test("a measured run's view (sample files in a temp folder, never eval/results) is axe-clean in both themes and at 320 px", async ({ browser }) => {
  const listing = await listEvalResults();
  const fake = listing.results.find((s) => s.result.simulated && !s.result.baseline && !s.result.layer1Only && s.result.set === "visible" && !s.result.textOmitted);
  test.skip(!fake, "no fake visible-set run is saved in eval/results to build the sample from");
  // The page pairs a layer-1-only run only with the same fixtures and layer-1 patterns (lib/eval/results.ts layer1For).
  const layer1 = listing.results.find(
    (s) =>
      s.result.layer1Only &&
      s.result.set === "visible" &&
      s.result.fixturesSha === fake!.result.fixturesSha &&
      (s.result.layer1Sha ?? null) === (fake!.result.layer1Sha ?? null),
  );
  const measured = measuredSample(fake!.result);
  const { listing: written } = await writeSampleFolder({
    "2026-10-20-api-sample.json": measured,
    [fake!.file]: fake!.result,
    ...(layer1 ? { [layer1.file]: layer1.result } : {}),
  });
  expect(written.unreadable, "sample files the schema refused").toEqual([]);
  const measuredSaved = written.results.find((s) => s.result.backend === "api")!;
  // Other sets' small tables: a measured and a simulated run of each. Their sets arrive from other branches, so this
  // branch's schema can't read them from a file yet; they join the listing as objects.
  const sample = {
    results: [...written.results, asSet(measuredSaved, "injection"), asSet(fake!, "injection"), asSet(fake!, "silver")],
    unreadable: [],
  };
  expect(pickLatest(sample).main?.result.backend).toBe("api");
  const markup = renderToStaticMarkup(createElement(EvalReport, { listing: sample, prices: SAMPLE_PRICES }));

  const page = await (await browser.newContext()).newPage();
  await signInAs(page, "E2E_LEAD_EMAIL");
  await page.goto("/app/eval");
  await expect(page.getByRole("heading", { level: 1, name: "AI evaluation" })).toBeVisible();
  // Replace what the page shows with the measured view, inside the same staff shell and stylesheet.
  await page.locator("main .al-page-header").locator("..").evaluate((el, html) => {
    el.innerHTML = html;
  }, markup);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByTestId("eval-run-kind").getByText(MEASURED_API)).toBeVisible();
  await expect(page.getByRole("table", { name: /^Each repeat/ }).getByRole("rowheader")).toHaveCount(3);
  await expect(page.getByRole("table", { name: /^Time, tokens and cost per test report/ }).getByText(/^US\$0\.0033 at prices set on 2026-10-20/)).toBeVisible();
  await expect(page.getByRole("table", { name: /^Injection set: latest measured run/ })).toBeVisible();
  await expect(page.getByRole("table", { name: /^Silver set \(published reports\): latest simulated run/ })).toBeVisible();
  if (layer1) await expect(page.getByRole("table", { name: /^Layer 1 alone, and with the AI pass/ })).toBeVisible();
  const saved = page.getByRole("table", { name: /^Every saved eval run/ });
  await expect(saved.getByRole("rowheader").first()).toContainText("2026-10-20-api-sample.json"); // measured first
  // For a human look at the measured view (test output only, never committed).
  await page.screenshot({ path: test.info().outputPath("eval-measured-sample.png"), fullPage: true });

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await settle(page);
    await expectNoAxeViolations(page, `/app/eval, measured run (${colorScheme})`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 320, height: 800 });
  await settle(page);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, "/app/eval measured run, page width at 320 px").toBeLessThanOrEqual(320);
  await expectNoAxeViolations(page, "/app/eval, measured run (320 px)");
  await page.context().close();
});

test("owners and auditors get 404 on /app/eval and have no Eval tab", async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  await signInAs(owner, "E2E_OWNER_EMAIL");
  const auditor = process.env.AUTH_MODE === "local" ? await asAuditor(browser) : null;
  for (const [who, page] of [["owner", owner], ["auditor", auditor]] as const) {
    if (!page) continue;
    await expect(page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Eval", exact: true })).toHaveCount(0);
    const res = await page.goto("/app/eval");
    expect(res?.status(), who).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("AI evaluation");
    await page.context().close();
  }
});
