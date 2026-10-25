// Visual QA (CLAUDE.md "UI quality bar"): full-page screenshots of the key screens at desktop 1440 px and mobile
// 390 px, light and dark, saved to e2e/screenshots/<screen>-<desktop|mobile>-<light|dark>.png (overwritten on every
// run) for humans to review after each phase. These are NOT pixel assertions. Every screen is also checked with
// expectNoAxeViolations in each size and theme, and at 390 px nothing may scroll the page sideways (WCAG 1.4.10), so
// this file doubles as the mobile-reflow and dark-mode accessibility sweep. Motion is reduced and fonts are loaded
// before each shot, so every shot is stable. The lists that grow on every run in the shared database (the inbox, My
// work, the Outbox) are cut at LIST_SHOT_PX, so the picture shows the top of the list at a readable size.
//
// Phase 2: the landing page, the report form's four steps (the review with the AI summary), the receipt, /r/ open
// (with the offer line) and just verified, /check empty and with an error, sign-in, the inbox, the lead's case page
// (redaction review, triaged, assigned, verified), the owner's case page (log fix) and My work, Log feedback (empty
// and with the one-time code), the Outbox with an email open, Settings and the design system. Later phases add theirs.
// Phase 3: the dashboard (and, on desktop, the dashboard with every chart shown as its table) and the AI evaluation
// page (/app/eval).
// Phase 4: the reports list, a new report, a draft (top, and with a sentence's sources open), a published report on
// the staff page, the public org page and the published report; the evidence check (/verify) of the published report,
// and of a draft whose snapshot was tampered with (check 1 red; restored right after the shot). These reports cover
// SEED_PERIOD, which holds only the seeded cases (domain §10), because every e2e case is received on the day the suite
// runs: a 2026 report would cite every case the suite ever filed (hundreds, past the shot's height cap).
//
// For a human review of the screenshots, start from the seed alone: run `npm run local:reset`, then
// `npx playwright test e2e/screenshots.spec.ts` on its own. Then the dashboard, the inbox, My work, the Outbox and the
// reports lists show the domain §10 seed and this file's few cases, not the data the whole suite has piled up in the
// shared database (hundreds of near-identical cases and dozens of report versions).
import { randomBytes } from "node:crypto";
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { expectNoAxeViolations, signInAs } from "./helpers";
import { fileReport, moveCase, type Filed } from "./fixtures/cases";
import { ensureLocation } from "./fixtures/locations";
import { inflateVerifiedCount, makeReport, type MadeReport } from "./fixtures/reports";

const ORG = "maple-harbour";
const DIR = "e2e/screenshots";
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } } as const;
const SCHEMES = ["light", "dark"] as const;
const LIST_SHOT_PX = 3000;
const MAX_SHOT_PX = 16_000; // a safety cap for any other page
/** Seeded cases only (db/seed.ts: Jan 14 to Sep 30, 2026); never a day the suite runs on (October 2026 or later). */
const SEED_PERIOD = { start: "2026-01-01", end: "2026-09-30" };
type Device = keyof typeof VIEWPORTS;
type Scheme = (typeof SCHEMES)[number];
const VARIANTS = (Object.keys(VIEWPORTS) as Device[]).flatMap((device) => SCHEMES.map((scheme) => ({ device, scheme })));
const key = (device: Device, scheme: Scheme) => `${device}-${scheme}`;

let counter = 0;
// Base 36, so the stamp is never a long digit run (layer 1 would hide it as an account number).
const stamp = () => `${Date.now().toString(36)}-${++counter}`;

/** The demo's barrier (e2e/demo.spec.ts), with the name and phone number the redaction beat shows. */
const DOOR_TEXT = () =>
  `Hi, my name is Daniel Okafor. The automatic door button at the King Street branch has been broken for three weeks, ` +
  `so I can't get in with my wheelchair (screenshots ${stamp()}). Call me at 416-555-0142.`;

/**
 * A made-up loopback client address (127.x.y.z, never 127.0.0.1; local sign-in refuses a non-loopback
 * X-Forwarded-For) per browser context: the public pages here count against
 * their own rate-limit bucket, never the one the rest of the suite (and a second run) uses from 127.0.0.1.
 */
const freshIp = () => ((b: Buffer) => `127.${1 + (b[0] % 255)}.${b[1]}.${b[2]}`)(randomBytes(3));

let received: Filed; // a new web report: the receipt
let open: Filed; // waiting for the reporter: /r/ with the question and the offer line
const toVerify = new Map<string, Filed>(); // one per variant: answered "Yes, it works now" on its own screen
const staff = { review: "", triaged: "", assigned: "", verified: "" };

async function inRetest(text: string): Promise<Filed> {
  const filed = await fileReport(ORG, { text, wantsRetest: true, detail: "King Street branch, main entrance" });
  await moveCase(ORG, filed.ref, "fixed"); // with a re-test wanted, the fix opens the re-test
  return filed;
}

async function answerYes(browser: Browser, code: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  const page = await context.newPage();
  await page.goto(`/r/${code}`);
  await page.getByRole("group", { name: "Does it work for you now?" }).getByRole("radio", { name: "Yes, it works now" }).check();
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Your answer is saved" })).toBeVisible();
  await context.close();
}

test.beforeAll(async ({ browser }) => {
  received = await fileReport(ORG, { text: DOOR_TEXT(), wantsRetest: true, detail: "King Street branch, main entrance" });
  open = await inRetest(DOOR_TEXT());
  for (const { device, scheme } of VARIANTS) toVerify.set(key(device, scheme), await inRetest(DOOR_TEXT()));

  const review = await fileReport(ORG, { text: DOOR_TEXT(), wantsRetest: true, detail: "King Street branch, main entrance" });
  const triaged = await fileReport(ORG, { text: DOOR_TEXT(), wantsRetest: true });
  await moveCase(ORG, triaged.ref, "triaged");
  const assigned = await fileReport(ORG, { text: DOOR_TEXT(), wantsRetest: true });
  await moveCase(ORG, assigned.ref, "assigned");
  const done = await inRetest(DOOR_TEXT());
  await answerYes(browser, done.code);
  Object.assign(staff, { review: review.ref, triaged: triaged.ref, assigned: assigned.ref, verified: done.ref });
});

async function variantContext(browser: Browser, device: Device, scheme: Scheme): Promise<BrowserContext> {
  return browser.newContext({
    viewport: VIEWPORTS[device],
    colorScheme: scheme,
    reducedMotion: "reduce",
    extraHTTPHeaders: { "x-forwarded-for": freshIp() },
  });
}

/** Fonts loaded, transitions and animations finished, scrolled to the top (the staff header is sticky on desktop). */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
    window.scrollTo(0, 0);
  });
}

/** Screenshot first (so a failing check still leaves the picture to look at), then axe and, on phones, reflow. */
function shooter(page: Page, prefix: "reporter" | "staff", device: Device, scheme: Scheme) {
  return async (screen: string, { list = false }: { list?: boolean } = {}) => {
    await settle(page);
    const { width } = VIEWPORTS[device];
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const max = list ? LIST_SHOT_PX : MAX_SHOT_PX;
    await page.screenshot({
      path: `${DIR}/${prefix}-${screen}-${device}-${scheme}.png`,
      fullPage: true,
      ...(height > max ? { clip: { x: 0, y: 0, width, height: max } } : {}),
    });
    const label = `${prefix} ${screen} (${device}, ${scheme})`;
    await expect(page.getByRole("heading", { level: 1 }), label).toHaveCount(1);
    await expect(page.getByRole("status"), label).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Get help" }), label).toHaveCount(1);
    await expectNoAxeViolations(page, label);
    if (device === "mobile") {
      const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(pageWidth, `${label}: page width at ${width}px`).toBeLessThanOrEqual(width);
    }
  };
}

for (const { device, scheme } of VARIANTS) {
  test(`reporter screens, ${device}, ${scheme}`, async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const context = await variantContext(browser, device, scheme);
    const page = await context.newPage();
    const shot = shooter(page, "reporter", device, scheme);

    await page.goto("/");
    await shot("landing");

    // Phase 5: the two public reading pages (how a report is handled; AccessLoop's own accessibility notes).
    await page.goto("/trust");
    await expect(page.getByRole("heading", { level: 1, name: "How AccessLoop handles your report" })).toBeVisible();
    await shot("trust");
    await page.goto("/accessibility");
    await expect(page.getByRole("heading", { level: 1, name: "Accessibility of AccessLoop" })).toBeVisible();
    await shot("accessibility");

    // The four steps of the report form, up to the review with the AI summary (nothing is sent).
    await page.goto(`/o/${ORG}/report`);
    await expect(page.getByRole("heading", { level: 1, name: /report a barrier/i })).toBeVisible();
    await shot("report-step-1");
    await page.getByLabel("What got in your way?").fill(DOOR_TEXT());
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Where did it happen?" })).toBeFocused();
    await page.getByRole("group", { name: "Where did it happen?" }).getByRole("radio", { name: "At a place" }).check();
    await page.getByLabel("Where exactly? (optional)").fill("King Street branch, main entrance");
    // Out of the field before the picture: the focus halo on the last field read as a styling fault in review.
    await page.getByLabel("Where exactly? (optional)").blur();
    await shot("report-step-2");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "How can we follow up?" })).toBeFocused();
    await page.getByRole("group", { name: "How can we follow up?" }).getByRole("radio", { name: "Let me check the fix with my code" }).check();
    await shot("report-step-3");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Check your report" })).toBeFocused({ timeout: 15_000 });
    await expect(page.getByRole("region", { name: "We understood" })).not.toContainText("Daniel Okafor");
    await shot("report-step-4-review");

    // The receipt reads its code from the short-lived cookie (domain §4), never from the URL.
    const host = new URL(baseURL ?? "http://localhost:3000").hostname;
    await context.addCookies([{ name: "al_receipt", value: received.code, domain: host, path: `/o/${ORG}/receipt` }]);
    await page.goto(`/o/${ORG}/receipt`);
    await expect(page.getByRole("heading", { level: 1, name: "We got your report" })).toBeVisible();
    await expect(page.getByTestId("case-ref")).toHaveText(received.ref);
    await shot("receipt");

    await page.goto(`/r/${open.code}`);
    await expect(page.getByRole("group", { name: "Does it work for you now?" })).toBeVisible();
    await expect(page.getByText("We offer a $25 gift card")).toBeVisible();
    await shot("retest-open");

    // Right after "Yes, it works now": the answer, the badge and the closed loop (the verified moment, motion reduced).
    await page.goto(`/r/${toVerify.get(key(device, scheme))!.code}`);
    await page.getByRole("group", { name: "Does it work for you now?" }).getByRole("radio", { name: "Yes, it works now" }).check();
    await page.getByRole("button", { name: "Send answer" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Your answer is saved" })).toBeFocused();
    await expect(page.getByTestId("report-status")).toHaveText("Fixed and confirmed by you");
    await shot("retest-verified");

    await page.goto("/check");
    await expect(page.getByRole("heading", { level: 1, name: "Check your report" })).toBeVisible();
    await shot("check");
    await page.getByLabel("Your receipt code").fill("ABCD-1234");
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(page.getByRole("heading", { level: 2, name: "There is a problem" })).toBeVisible();
    await expect(page.locator(":focus")).toContainText("That code doesn't look right."); // the error summary takes focus
    await shot("check-error");
    await context.close();
  });
}

for (const { device, scheme } of VARIANTS) {
  test(`staff screens, ${device}, ${scheme}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await variantContext(browser, device, scheme);
    const page = await context.newPage();
    const shot = shooter(page, "staff", device, scheme);
    const caseStatus = page.getByTestId("case-status");

    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await shot("sign-in");

    // Phase 3: the dashboard is the lead's home (the demo's opening and closing shot); on desktop also with every
    // chart shown as its table.
    await signInAs(page, "E2E_LEAD_EMAIL");
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await expect(page.getByTestId("integrity-line")).toBeVisible();
    await shot("dashboard");
    if (device === "desktop") {
      for (const button of await page.getByRole("button", { name: /^Show as table \(/ }).all()) await button.click();
      await shot("dashboard-tables");
    }

    await page.goto("/app/inbox");
    await expect(page.getByRole("table", { name: "Cases received" })).toBeVisible();
    await shot("inbox", { list: true });

    await page.goto(`/app/cases/${staff.review}`);
    await expect(page.getByRole("region", { name: "Redaction review" })).toContainText("[PERSON]");
    await shot("case-redaction-review");
    await page.goto(`/app/cases/${staff.triaged}`);
    await expect(caseStatus).toHaveText("Triaged");
    await shot("case-triaged");
    await page.goto(`/app/cases/${staff.assigned}`);
    await expect(caseStatus).toHaveText("Assigned");
    await shot("case-assigned-lead");
    await page.goto(`/app/cases/${staff.verified}`);
    await expect(caseStatus).toHaveText("Verified by reporter");
    await shot("case-verified");

    await page.goto("/app/cases/new");
    await expect(page.getByRole("heading", { level: 1, name: "Log feedback received another way" })).toBeVisible();
    await shot("log-feedback");
    await page.getByRole("group", { name: "How did it arrive?" }).getByRole("radio", { name: "Phone", exact: true }).check();
    await page.getByLabel("What they told us").fill(`Caller says the phone menu has no way to reach a person (screenshots ${stamp()}).`);
    await page.getByRole("group", { name: "Where did it happen?" }).getByRole("radio", { name: "On the phone or at a service" }).check();
    await page.getByRole("group", { name: "Does the person want to stay anonymous?" }).getByRole("radio", { name: "Yes", exact: true }).check();
    await page.getByRole("group", { name: "Can we ask them to check the fix later?" }).getByRole("radio", { name: "Yes", exact: true }).check();
    await page.getByRole("button", { name: "Log feedback" }).click();
    await expect(page.getByTestId("receipt-code")).toBeVisible({ timeout: 15_000 });
    await shot("log-feedback-code");

    await page.goto("/app/outbox");
    await expect(page.getByRole("heading", { level: 1, name: "Outbox" })).toBeVisible();
    // e2e/channels.spec.ts runs first and always logs emails; on a fresh database the shot is the empty state.
    const first = page.getByRole("button", { name: /^Show the email/ }).first();
    if (await first.count()) {
      await first.click();
      await expect(first).toHaveAttribute("aria-expanded", "true");
    }
    await shot("outbox", { list: true });

    await page.goto("/app/settings");
    await expect(page.getByRole("button", { name: "Save settings" })).toBeVisible();
    await shot("settings");

    // Phase 7 T4.5: locations and one location's QR poster (the same location every run).
    const location = await ensureLocation(ORG, { name: "King Street branch", kind: "place", detail: "main entrance" });
    await page.goto("/app/settings/locations");
    await expect(page.getByRole("heading", { level: 1, name: "Locations and posters" })).toBeVisible();
    await shot("locations");
    await page.goto(`/app/settings/locations/${location}/poster`);
    await expect(page.getByRole("img", { name: /^QR code: opens / })).toBeVisible();
    await shot("location-poster");

    // Phase 3: the latest saved eval result (a simulated fake run unless someone saved a real one).
    await page.goto("/app/eval");
    await expect(page.getByRole("heading", { level: 1, name: "AI evaluation" })).toBeVisible();
    await shot("eval");

    await page.goto("/app/design");
    await expect(page.getByRole("heading", { level: 1, name: "Design system" })).toBeVisible();
    await shot("design");

    await signInAs(page, "E2E_OWNER_EMAIL");
    await page.goto("/app/my-work");
    await expect(page.getByRole("table", { name: "Cases assigned to you" })).toBeVisible();
    await shot("my-work", { list: true });
    await page.goto(`/app/cases/${staff.assigned}`);
    await expect(page.getByLabel("What did you fix?")).toBeVisible();
    await shot("case-assigned-owner");
    await context.close();
  });
}

// Phase 4: progress reports. One draft and one published report (built through the app's own report code), shot in
// every size and theme: staff list, new report, the draft (top and with the first Feedback sentence's sources open),
// the published report on the staff page, and the public org page and published report.
let reportDraft: MadeReport;
let reportPublished: MadeReport;
let reportTampered: MadeReport;

for (const { device, scheme } of VARIANTS) {
  test(`report screens, ${device}, ${scheme}`, async ({ browser }) => {
    test.setTimeout(240_000);
    reportDraft ??= await makeReport(ORG, { period: SEED_PERIOD });
    reportPublished ??= await makeReport(ORG, { publish: true, period: SEED_PERIOD });
    reportTampered ??= await makeReport(ORG, { period: SEED_PERIOD });
    const context = await variantContext(browser, device, scheme);
    const page = await context.newPage();
    const staffShot = shooter(page, "staff", device, scheme);

    await signInAs(page, "E2E_LEAD_EMAIL");
    await page.goto("/app/reports");
    await expect(page.getByRole("heading", { level: 1, name: "Progress reports" })).toBeVisible();
    await staffShot("reports", { list: true });
    await page.goto("/app/reports/new");
    await expect(page.getByLabel("Period start")).toBeVisible();
    await staffShot("report-new");
    await page.goto(`/app/reports/${reportDraft.id}`);
    await expect(page.getByRole("region", { name: "Report checks" })).toContainText("All required checks pass");
    await staffShot("report-draft");
    const sources = page.getByRole("region", { name: "Feedback" }).getByRole("button", { name: /^Sources for this sentence/ }).first();
    await sources.click();
    await expect(sources).toHaveAttribute("aria-expanded", "true");
    await sources.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${DIR}/staff-report-sources-${device}-${scheme}.png` });
    await expectNoAxeViolations(page, `staff report-sources (${device}, ${scheme})`);
    await page.goto(`/app/reports/${reportPublished.id}`);
    await expect(page.getByText(/within 48 hours/).first()).toBeVisible();
    await staffShot("report-published");

    // The evidence check after the demo beat (jsonb_set inflating the verified count), put back right after the shot.
    const restore = await inflateVerifiedCount(reportTampered.id);
    try {
      await page.goto(`/verify/${reportTampered.id}`);
      await expect(page.getByRole("status")).toContainText("changed after it was generated");
      await staffShot("verify-tampered", { list: true });
    } finally {
      await restore();
    }

    const anon = await variantContext(browser, device, scheme);
    const pub = await anon.newPage();
    const publicShot = shooter(pub, "reporter", device, scheme);
    await pub.goto(`/p/${ORG}`);
    await expect(pub.getByRole("heading", { level: 2, name: "How to give feedback" })).toBeVisible();
    await publicShot("public-org");
    await pub.goto(`/p/${ORG}/reports/${reportPublished.id}`);
    await expect(pub.getByRole("heading", { level: 2, name: "Feedback", exact: true })).toBeVisible();
    await publicShot("public-report");
    await pub.goto(`/verify/${reportPublished.id}`);
    await expect(pub.getByRole("status")).toContainText("All records match");
    await publicShot("verify", { list: true });
    await anon.close();
    await context.close();
  });
}
