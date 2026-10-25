// E2E-only (never imported by the app): walks the key screens of this build in one browser context and calls
// `check` on each, so e2e/reflow.spec.ts (320 px) and e2e/forced-colors.spec.ts (forced-colors mode) cover exactly
// the same pages and states. Cases come from e2e/fixtures/cases.ts (the app's own intake code and the frozen core),
// except the one report that is sent through the public form to reach its receipt. The published progress report
// comes from e2e/fixtures/reports.ts (the app's own report code); the lead's draft is built with "Generate draft",
// and its evidence check is shown tampered (the demo beat, jsonb_set through MIGRATION_DATABASE_URL) and put back
// right after. The list covers every screen e2e/screenshots.spec.ts shoots for humans (except the hidden /app/design
// page), plus the states only these checks need (errors, a footnote open, a filtered inbox). Specs share one
// database: nothing here assumes fixed counts, and no org setting is changed.
import { randomBytes } from "node:crypto";
import { expect, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { signInAs, signOut } from "./helpers";
import { fileReport, moveCase } from "./fixtures/cases";
import { ensureLocation } from "./fixtures/locations";
import { inflateVerifiedCount, makeReport } from "./fixtures/reports";

const ORG = "maple-harbour";
const SOURCES_NAME = /^Sources for this sentence \(\d+ records?\)$/;

/** The screens, in the order they are visited. */
export const KEY_SCREENS = [
  "landing",
  "help",
  "trust",
  "accessibility",
  "report step 1",
  "report step 2",
  "report step 3 with errors",
  "report step 3",
  "report review (Change it)",
  "report review",
  "receipt",
  "re-test open",
  "re-test verified",
  "check",
  "check with an error",
  "public org page",
  "published report (sources open)",
  "evidence check",
  "sign-in",
  "dashboard",
  "dashboard (charts as tables)",
  "inbox",
  "inbox (filtered)",
  "case page (lead, redaction review)",
  "case page (lead, triaged)",
  "case page (lead, assigned)",
  "case page (lead, verified)",
  "log feedback",
  "log feedback (code shown)",
  "reports",
  "new report",
  "report draft (sources open)",
  "evidence check (tampered)",
  "published report (staff)",
  "outbox",
  "eval",
  "settings",
  "locations",
  "location poster",
  "my work",
  "case page (owner, assigned)",
] as const;
export type KeyScreen = (typeof KEY_SCREENS)[number];

export type ScreenCheck = (page: Page, screen: KeyScreen) => Promise<void>;

/** A made-up client address in 127/8 (loopback: local sign-in refuses others): its own rate-limit bucket, never the suite's 127.0.0.1. */
const freshIp = () => ((b: Buffer) => `127.${1 + (b[0] % 255)}.${b[1]}.${b[2]}`)(randomBytes(3));

let counter = 0;
// Base 36, so the stamp is never a long digit run (layer 1 would hide it as an account number).
const stamp = () => `${Date.now().toString(36)}-${++counter}`;
const doorText = () =>
  `Hi, my name is Daniel Okafor. The automatic door button at the King Street branch has been broken for three weeks, ` +
  `so I can't get in with my wheelchair (key pages ${stamp()}). Call me at 416-555-0142.`;

/** Fonts loaded and every transition or animation finished, so checks read the final layout and colours. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
}

/** Open the first "Sources for this sentence" footnote of a report's Feedback section: its card and list show. */
async function openFirstSources(page: Page) {
  const feedback = page.getByRole("region", { name: "Feedback" });
  const sources = feedback.getByRole("button", { name: SOURCES_NAME }).first();
  await sources.click();
  await expect(sources).toHaveAttribute("aria-expanded", "true");
  await expect(feedback.getByRole("list", { name: "Sources" })).toContainText(/BAR-\d{4}/);
}

/** One published 2026 report for the public pages, made once per worker (every run adds reports to the shared DB). */
let published: Promise<{ id: string }> | undefined;

/**
 * Visit every key screen in a context made with `options` and run `check` on each. Returns the screens checked, in
 * order (specs compare it with KEY_SCREENS, so a screen can't be skipped silently).
 */
export async function visitKeyPages(browser: Browser, options: BrowserContextOptions, check: ScreenCheck): Promise<KeyScreen[]> {
  // Cases first (no browser): one waiting for the reporter, one new (redaction review), one triaged, and one assigned
  // (the lead's view of it, then the owner's).
  const retest = await fileReport(ORG, { text: doorText(), wantsRetest: true, detail: "King Street branch, main entrance" });
  await moveCase(ORG, retest.ref, "fixed");
  const fresh = await fileReport(ORG, { text: doorText(), wantsRetest: true, detail: "King Street branch, main entrance" });
  const triaged = await fileReport(ORG, { text: doorText(), wantsRetest: true });
  await moveCase(ORG, triaged.ref, "triaged");
  const assigned = await fileReport(ORG, { text: doorText(), wantsRetest: true });
  await moveCase(ORG, assigned.ref, "assigned");
  published ??= makeReport(ORG, { publish: true });
  // One poster location (Phase 7 T4.5), made once and reused by every walk (locations are never deleted).
  const location = await ensureLocation(ORG, { name: "King Street branch", kind: "place", detail: "main entrance" });
  const report = await published.catch((e: unknown) => {
    published = undefined; // a failed build is not reused by the next walk
    throw e;
  });

  const context = await browser.newContext({ reducedMotion: "reduce", ...options, extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  const page = await context.newPage();
  const visited: KeyScreen[] = [];
  const at = async (screen: KeyScreen) => {
    await settle(page);
    await check(page, screen);
    visited.push(screen);
  };

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await at("landing");
  await page.goto("/help");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await at("help");
  await page.goto("/trust");
  await expect(page.getByRole("heading", { level: 1, name: "How AccessLoop handles your report" })).toBeVisible();
  await at("trust");
  await page.goto("/accessibility");
  await expect(page.getByRole("heading", { level: 1, name: "Accessibility of AccessLoop" })).toBeVisible();
  await at("accessibility");

  // The report form: every step (step 3 also with its errors), the email field shown, the review with "Change it"
  // open and then with the AI summary answered.
  await page.goto(`/o/${ORG}/report`);
  await expect(page.getByRole("heading", { level: 1, name: /report a barrier/i })).toBeVisible();
  await at("report step 1");
  await page.getByLabel("What got in your way?").fill(doorText());
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Where did it happen?" })).toBeFocused();
  await page.getByRole("group", { name: "Where did it happen?" }).getByRole("radio", { name: "At a place" }).check();
  await page.getByLabel("Where exactly? (optional)").fill("King Street branch, main entrance");
  await at("report step 2");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "How can we follow up?" })).toBeFocused();
  // Next with nothing chosen (the question in error), then the email answer without an address (its field in error).
  const followUp = page.getByRole("group", { name: "How can we follow up?" });
  await page.getByRole("button", { name: "Next" }).click();
  await expect(followUp.getByRole("radio", { name: "Don't contact me" })).toBeFocused();
  await followUp.getByRole("radio", { name: "Email me, and let me check the fix" }).check();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByLabel("Email address")).toBeFocused();
  await expect(page.getByLabel("Email address")).toHaveAttribute("aria-invalid", "true");
  await at("report step 3 with errors");
  await page.getByLabel("Email address").fill("firstname.lastname@mapleharbour.ca");
  await at("report step 3");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Check your report" })).toBeFocused({ timeout: 15_000 });
  // "Change it" opens the summary box under it.
  await page.getByRole("radio", { name: "Change it" }).check();
  await expect(page.getByLabel("Your summary", { exact: true })).toBeVisible();
  await at("report review (Change it)");
  await page.getByRole("radio", { name: "Yes, that's right" }).check();
  await expect(page.getByRole("radio", { name: "Yes, that's right" })).toBeChecked();
  await at("report review");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "We got your report" })).toBeFocused({ timeout: 15_000 });
  await at("receipt");

  // The reporter's page: the question open, then the verified moment.
  await page.goto(`/r/${retest.code}`);
  const question = page.getByRole("group", { name: "Does it work for you now?" });
  await expect(question).toBeVisible();
  await at("re-test open");
  await question.getByRole("radio", { name: "Yes, it works now" }).check();
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Your answer is saved" })).toBeFocused();
  await expect(page.getByTestId("report-status")).toHaveText("Fixed and confirmed by you");
  await at("re-test verified");

  await page.goto("/check");
  await expect(page.getByRole("heading", { level: 1, name: "Check your report" })).toBeVisible();
  await at("check");
  await page.getByLabel("Your receipt code").fill("ABCD-1234");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "There is a problem" })).toBeVisible();
  await at("check with an error");

  // The org's public feedback page, a published progress report with one sentence's sources open (refs as plain
  // text), and that report's public evidence check.
  await page.goto(`/p/${ORG}`);
  await expect(page.getByRole("heading", { level: 1, name: /: accessibility feedback$/ })).toBeVisible();
  await expect(page.locator(`a[href="/p/${ORG}/reports/${report.id}"]`)).toBeVisible();
  await at("public org page");
  await page.goto(`/p/${ORG}/reports/${report.id}`);
  await expect(page.getByRole("heading", { level: 2, name: "Feedback", exact: true })).toBeVisible();
  await openFirstSources(page);
  await at("published report (sources open)");
  await page.goto(`/verify/${report.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Evidence check" })).toBeVisible();
  await expect(page.getByTestId("evidence-line")).toHaveText(/^All records match/);
  await at("evidence check");

  // Staff: the lead's pages.
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await at("sign-in");
  await signInAs(page, "E2E_LEAD_EMAIL");
  // The lead's home: the dashboard (domain §10), its charts drawn and their tables closed.
  await page.goto("/app/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page.getByTestId("integrity-line")).toBeVisible();
  await at("dashboard");
  // Every chart shown as its table ("Show as table" pressed). Below md the tables are shown already and the pictures
  // and toggles are not, so there is nothing to press.
  for (const toggle of await page.getByRole("button", { name: /^Show as table \(/ }).all()) {
    if (!(await toggle.isVisible())) continue;
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.getByRole("table", { name: /^The loop funnel/ })).toBeVisible();
  await at("dashboard (charts as tables)");
  await page.goto("/app/inbox");
  await expect(page.getByRole("table", { name: "Cases received" })).toBeVisible();
  await at("inbox");
  // The inbox as a dashboard number opens it: narrowed, its filters written out as chips, with "Clear filters".
  await page.goto("/app/dashboard");
  const numberLink = page.locator('main a[href^="/app/inbox?"]').first();
  await expect(numberLink).toBeAttached();
  await page.goto((await numberLink.getAttribute("href"))!);
  await expect(page.getByRole("region", { name: "Filters" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Clear filters" })).toBeVisible();
  await at("inbox (filtered)");
  await page.goto(`/app/cases/${fresh.ref}`);
  await expect(page.getByRole("region", { name: "Redaction review" })).toContainText("[PERSON]");
  await at("case page (lead, redaction review)");
  await page.goto(`/app/cases/${triaged.ref}`);
  await expect(page.getByTestId("case-status")).toHaveText("Triaged");
  await at("case page (lead, triaged)");
  await page.goto(`/app/cases/${assigned.ref}`);
  await expect(page.getByTestId("case-status")).toHaveText("Assigned");
  await at("case page (lead, assigned)");
  await page.goto(`/app/cases/${retest.ref}`);
  await expect(page.getByTestId("case-status")).toHaveText("Verified by reporter");
  await at("case page (lead, verified)");
  await page.goto("/app/cases/new");
  await expect(page.getByRole("heading", { level: 1, name: "Log feedback received another way" })).toBeVisible();
  await at("log feedback");
  // Logged: the one-time receipt code to read to the person (a new case every walk, as each run of the suite adds).
  await page.getByRole("group", { name: "How did it arrive?" }).getByRole("radio", { name: "Phone", exact: true }).check();
  await page.getByLabel("What they told us").fill(`Caller says the phone menu has no way to reach a person (key pages ${stamp()}).`);
  await page.getByRole("group", { name: "Where did it happen?" }).getByRole("radio", { name: "On the phone or at a service" }).check();
  await page.getByRole("group", { name: "Does the person want to stay anonymous?" }).getByRole("radio", { name: "Yes", exact: true }).check();
  await page.getByRole("group", { name: "Can we ask them to check the fix later?" }).getByRole("radio", { name: "Yes", exact: true }).check();
  await page.getByRole("button", { name: "Log feedback" }).click();
  await expect(page.getByTestId("receipt-code")).toBeVisible({ timeout: 15_000 });
  await at("log feedback (code shown)");
  // Progress reports (the Reports tab): the list, a new report, "Generate draft" and the draft with one sentence's
  // sources open, then that draft's evidence check after the demo beat (its verified count inflated), put back in
  // `finally` so no other page or spec ever shows a red report.
  await page.goto("/app/reports");
  await expect(page.getByRole("heading", { level: 1, name: "Progress reports" })).toBeVisible();
  await expect(page.getByRole("table", { name: /^Progress reports/ })).toBeVisible();
  await at("reports");
  await page.goto("/app/reports/new");
  await expect(page.getByRole("heading", { level: 1, name: "New progress report" })).toBeVisible();
  await at("new report");
  await page.getByLabel("Period start").fill("2026-01-01");
  await page.getByLabel("Period end").fill("2026-12-31");
  await page.getByRole("button", { name: "Generate draft" }).click();
  await page.waitForURL(/\/app\/reports\/[0-9a-f-]{36}$/);
  const draftId = /\/app\/reports\/([0-9a-f-]{36})$/.exec(new URL(page.url()).pathname)![1];
  await expect(page.getByRole("region", { name: "Report checks" })).toContainText("All required checks pass");
  await openFirstSources(page);
  await at("report draft (sources open)");
  const restore = await inflateVerifiedCount(draftId);
  try {
    await page.goto(`/verify/${draftId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Evidence check" })).toBeVisible();
    await expect(page.getByTestId("evidence-line")).toHaveText(/^Problems found: the report was changed after it was generated/);
    await at("evidence check (tampered)");
  } finally {
    await restore();
  }
  // The published report on the staff page: read-only, with the ACR s.16 reminder.
  await page.goto(`/app/reports/${report.id}`);
  await expect(page.getByText(/within 48 hours/).first()).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await at("published report (staff)");
  await page.goto("/app/outbox");
  await expect(page.getByRole("heading", { level: 1, name: "Outbox" })).toBeVisible();
  const email = page.getByRole("button", { name: /^Show the email/ }).first();
  if (await email.count()) {
    await email.click();
    await expect(email).toHaveAttribute("aria-expanded", "true");
  }
  await at("outbox");
  await page.goto("/app/eval");
  await expect(page.getByRole("heading", { level: 1, name: "AI evaluation" })).toBeVisible();
  await at("eval");
  await page.goto("/app/settings");
  await expect(page.getByRole("button", { name: "Save settings" })).toBeVisible();
  await at("settings");
  // Locations and QR posters (Phase 7 T4.5): the list with its add form, and one location's poster.
  await page.goto("/app/settings/locations");
  await expect(page.getByRole("heading", { level: 1, name: "Locations and posters" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Poster for King Street branch" })).toBeVisible();
  await at("locations");
  await page.goto(`/app/settings/locations/${location}/poster`);
  await expect(page.getByRole("img", { name: /^QR code: opens / })).toBeVisible();
  await at("location poster");
  await signOut(page);

  // Staff: the owner's pages.
  await signInAs(page, "E2E_OWNER_EMAIL");
  await page.goto("/app/my-work");
  await expect(page.getByRole("table", { name: "Cases assigned to you" })).toBeVisible();
  await at("my work");
  await page.goto(`/app/cases/${assigned.ref}`);
  await expect(page.getByLabel("What did you fix?")).toBeVisible();
  await at("case page (owner, assigned)");
  await context.close();
  return visited;
}
