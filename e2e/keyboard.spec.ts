// Keyboard only (WCAG 2.1.1, 2.4.3, 2.4.7, 2.4.11; CLAUDE.md "Accessibility contract"; docs/handoff.md Phase 5):
// the whole reporter flow, the receipt and the re-test on /r/{code} with Tab, Shift+Tab, Space, Enter and the arrow
// keys only. Text is typed only into the element that has focus, and nothing is clicked. After every step change
// and every submit, focus must be on the new heading; at every stop the focused element must show a visible
// indicator and must not sit under a sticky header. The first test also checks the Tab order a person meets (the
// skip link, the brand and "Get help" before the question; Next before Back; the summary answers (one radio group,
// moved with the arrow keys) and "Don't use AI on my report" before Send report), each step's heading named "Step N
// of 4: ..." while its field keeps the plain question, the page title of each step, that Back keeps every answer
// (Tab re-enters a radio group on the chosen
// option), that the receipt clears the saved draft, that a full page load starts at the top (no focus moved for
// the person), that nothing is left to Tab to after the re-test's result, and what was stored. The second test does
// the same for every missing answer: on each step, on the review (and "Change it" emptied), on /check and on the
// re-test, focus must land on the field, the first option or the error summary that says what to do; it also
// follows the skip link and opens the report page from /check. The third test tries /check past its rate limit:
// focus goes to the calm notice, which must show the focus ring. The staff test does the same on the pages that HAVE
// a sticky header (from 64rem up): sign in (the lead lands on the dashboard), then the inbox, a case page, Log
// feedback and Settings, each reached by keyboard and walked forward and back; then Reports: the list, "New report",
// "Generate draft", and a "Sources for this sentence" footnote opened, its first record reached and closed again.
// The last test takes a progress report the rest of the way by keyboard: every part written and saved (focus stays
// on its Save button), "Go to the report checks" past every footnote, Sign off and Publish (focus on the result line,
// with the ring), "View the published page" and a footnote there (public refs are plain text: a long list is one
// focusable region), then "Verify evidence chain" as the signed-in lead (walked under the sticky header, Reports the
// current tab) and the public evidence check, each with "Back to the report".
// The case is moved to "Waiting for the reporter to check" by e2e/fixtures/advance.ts (only the frozen core).
// Specs share one database: nothing here assumes fixed counts.
import { randomBytes } from "node:crypto";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers";
import { atLastTabStop, expectVisibleFocus, press, tabTo } from "./a11y-checks";
import { advanceToRetest } from "./fixtures/advance";
import { caseFacts } from "./fixtures/cases";
import { makeReport } from "./fixtures/reports";

const ORG = "maple-harbour";
/** lib/intake/draft.ts: where the report form keeps the person's answers while they type. */
const DRAFT_KEY = `accessloop:report-draft:${ORG}`;
const SOURCES_NAME = /^Sources for this sentence \(\d+ records?\)$/;
/** lib/rate-limit.ts and lib/rate-limit-message.ts: /check allows 30 tries per 10 minutes, then says this. */
const CHECK_LIMIT = 30;
const WINDOW_MS = 10 * 60_000;
const RATE_LIMITED = "Too many tries from this connection. Please wait a few minutes and try again.";

/** A made-up client address in 127/8 (loopback: local sign-in refuses others): its own rate-limit bucket, never the suite's 127.0.0.1. */
const freshIp = () => ((b: Buffer) => `127.${1 + (b[0] % 255)}.${b[1]}.${b[2]}`)(randomBytes(3));

/** Type into the focused element only (the keyboard's own events, like a person typing). */
async function typeHere(page: Page, text: string) {
  await page.keyboard.type(text);
}

/**
 * React has hydrated this element (React 19 keeps its props on every hydrated host node). The report steps are
 * plain <form method="post"> elements until then, so a key pressed earlier would send a native POST instead of
 * moving to the next step.
 */
async function hydrated(page: Page, selector: string) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  }, selector);
}

/** Nothing has focus yet: a fresh page load, where the browser starts at the top of the document. */
const focusAtTop = (page: Page) => page.evaluate(() => document.activeElement === document.body);

/**
 * A fresh reporter page, from the top: the skip link (shown on focus), the brand and "Get help" (the organization's
 * name is text, not a stop), then `first`, the first thing in the main content.
 */
async function headerThen(page: Page, first: Locator, label: string) {
  expect(await focusAtTop(page), `${label}: a fresh page starts at the top`).toBe(true);
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await press(page, "Tab", `${label}: Tab 1`);
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await press(page, "Tab", `${label}: Tab 2`);
  await expect(page.getByRole("link", { name: "AccessLoop", exact: true })).toBeFocused();
  await press(page, "Tab", `${label}: Tab 3`);
  await expect(page.getByRole("link", { name: "Get help", exact: true })).toBeFocused();
  await press(page, "Tab", `${label}: Tab 4`);
  await expect(first).toBeFocused();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Sign in with the keyboard (local mode): Tab to the person's button, Enter. Focus lands on the new page's h1. */
async function signInByKeyboard(page: Page, name: string) {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  const signIn = page.getByRole("button", { name: new RegExp(`^Sign in as ${escapeRe(name)}`) });
  await tabTo(page, signIn, `sign-in: to ${name}`, { max: 12 });
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/app\//);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused({ timeout: 15_000 });
  await expectVisibleFocus(page, "staff landing heading");
}

/**
 * Walk the page forward, then all the way back: every stop is visible and clear of any sticky header. Forward stops
 * at the last thing in the Tab order, so a short page never tabs out of the document.
 */
async function walkPage(page: Page, label: string, max: number) {
  let steps = 0;
  while (steps < max && !(await atLastTabStop(page))) {
    steps++;
    await press(page, "Tab", `${label}: Tab ${steps}`);
  }
  for (let i = 1; i <= steps; i++) await press(page, "Shift+Tab", `${label}: Shift+Tab ${i}`);
}

test("the whole reporter flow and the re-test work with the keyboard alone", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  const page = await context.newPage();
  const text = `The automatic door button at the side entrance does not open the door (keyboard ${Date.now().toString(36)}).`;
  const detail = "Side entrance on Elm Street";
  const email = "keyboard.reporter@example.com";

  await page.goto(`/o/${ORG}/report`);
  await expect(page.getByRole("heading", { level: 1, name: /report a barrier/i })).toBeVisible();
  await hydrated(page, "#report-text");

  // Step 1: from the top of a fresh page, the header's three stops, then the question. Shift+Tab goes back to
  // "Get help" and Tab returns; then type.
  const what = page.getByLabel("What got in your way?");
  await headerThen(page, what, "step 1");
  await expect(page.getByText("Step 1 of 4", { exact: true })).toBeVisible();
  // Phase 7 T4.3: the step is said in the heading (where focus lands after a step change), not in the field's name.
  await expect(what).toHaveAccessibleName("What got in your way?");
  await expect(page.getByRole("heading", { level: 2, name: "What got in your way?" })).toHaveAccessibleName(
    "Step 1 of 4: What got in your way?",
  );
  await press(page, "Shift+Tab", "step 1: back to the header");
  await expect(page.getByRole("link", { name: "Get help", exact: true })).toBeFocused();
  await press(page, "Tab", "step 1: to the text box again");
  await expect(what).toBeFocused();
  await typeHere(page, text);
  await expect(what).toHaveValue(text);
  const next = page.getByRole("button", { name: "Next" });
  const back = page.getByRole("button", { name: "Back" });
  await tabTo(page, next, "step 1: to Next");
  await press(page, "Enter", "step 1: Next");

  // Step 2: focus on the step's heading, and the page title says which step this is (WCAG 2.4.2).
  const step2 = page.getByRole("heading", { level: 2, name: "Where did it happen?" });
  await expect(step2).toBeFocused();
  await expect(step2).toHaveAccessibleName("Step 2 of 4: Where did it happen?");
  await expectVisibleFocus(page, "step 2 heading");
  await expect(page.getByText("Step 2 of 4", { exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/^Step 2 of 4: Where did it happen\? - Report a barrier to /);

  // The "Where did it happen?" radio group: Tab enters it on the first option (nothing is chosen for the person),
  // the arrow keys move and choose.
  const where = page.getByRole("group", { name: "Where did it happen?" });
  await expect(where).toHaveAccessibleName("Where did it happen?");
  const firstPlace = where.getByRole("radio", { name: "On a website or app" });
  const atAPlace = where.getByRole("radio", { name: "At a place" });
  await tabTo(page, firstPlace, "step 2: into the radio group", { max: 3 });
  await expect(firstPlace).not.toBeChecked();
  await press(page, "ArrowDown", "step 2: next option");
  await expect(atAPlace).toBeFocused();
  await expect(atAPlace).toBeChecked();
  await press(page, "ArrowDown", "step 2: next option");
  await expect(where.getByRole("radio", { name: "On the phone or at a service" })).toBeChecked();
  await press(page, "ArrowUp", "step 2: back up");
  await expect(atAPlace).toBeFocused();
  await expect(atAPlace).toBeChecked();
  // One Tab leaves the group (a radio group is one Tab stop).
  const whereDetail = page.getByLabel("Where exactly? (optional)");
  await press(page, "Tab", "step 2: out of the group");
  await expect(whereDetail).toBeFocused();
  await typeHere(page, detail);
  await tabTo(page, next, "step 2: to Next", { max: 3 });
  // Back comes right after Next, in the same place on every step.
  await press(page, "Tab", "step 2: to Back");
  await expect(back).toBeFocused();

  // Back (Enter) returns to step 1 with its heading focused, its title, and the words kept; Next brings the person
  // back to step 2, where Tab re-enters the group on the CHOSEN option and the detail is kept too.
  await press(page, "Enter", "step 2: Back");
  await expect(page.getByRole("heading", { level: 2, name: "What got in your way?" })).toBeFocused();
  await expectVisibleFocus(page, "step 1 heading after Back");
  await expect(page.getByText("Step 1 of 4", { exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/^Step 1 of 4: What got in your way\? - Report a barrier to /);
  await press(page, "Tab", "step 1 again: to the text box");
  await expect(what).toBeFocused();
  await expect(what).toHaveValue(text);
  await tabTo(page, next, "step 1 again: to Next");
  await press(page, "Enter", "step 1 again: Next");
  await expect(step2).toBeFocused();
  await tabTo(page, atAPlace, "step 2 again: into the radio group, on the chosen option", { max: 3 });
  await expect(atAPlace).toBeChecked();
  await press(page, "Tab", "step 2 again: out of the group");
  await expect(whereDetail).toBeFocused();
  await expect(whereDetail).toHaveValue(detail);
  await tabTo(page, next, "step 2 again: to Next", { max: 3 });
  await press(page, "Enter", "step 2: Next");

  // Step 3: ONE question (Phase 7 T4.2). Nothing is chosen for the person; the code answer shows what happens next
  // under it, the email answer its field. Then Next and Back in that order.
  await expect(page.getByRole("heading", { level: 2, name: "How can we follow up?" })).toBeFocused();
  await expectVisibleFocus(page, "step 3 heading");
  await expect(page.getByText("Step 3 of 4", { exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/^Step 3 of 4: How can we follow up\? - Report a barrier to /);
  const followUp = page.getByRole("group", { name: "How can we follow up?" });
  const dontContact = followUp.getByRole("radio", { name: "Don't contact me" });
  const withCode = followUp.getByRole("radio", { name: "Let me check the fix with my code" });
  const byEmail = followUp.getByRole("radio", { name: "Email me, and let me check the fix" });
  const afterCode = page.getByText("After you send this report, you get a receipt code.");
  await tabTo(page, dontContact, "step 3: into the question", { max: 3 });
  await expect(dontContact).not.toBeChecked();
  await expect(afterCode).toBeHidden();
  await press(page, "ArrowDown", "step 3: check the fix with my code");
  await expect(withCode).toBeFocused();
  await expect(withCode).toBeChecked();
  await expect(afterCode).toBeVisible();
  await press(page, "ArrowDown", "step 3: email me");
  await expect(byEmail).toBeChecked();
  await expect(afterCode).toBeHidden();
  const emailField = page.getByLabel("Email address");
  await expect(emailField).toBeVisible();
  await press(page, "Tab", "step 3: to the email field");
  await expect(emailField).toBeFocused();
  await typeHere(page, email);
  await expect(page.getByLabel("Don't use AI on my report")).toHaveCount(0); // on the review now
  await tabTo(page, next, "step 3: to Next", { max: 3 });
  await press(page, "Tab", "step 3: to Back");
  await expect(back).toBeFocused();
  await press(page, "Shift+Tab", "step 3: back to Next");
  await expect(next).toBeFocused();
  await press(page, "Enter", "step 3: Next");

  // Step 4: the review says what will be sent. The summary answers (one radio group) come first, then the AI choice,
  // Send report and Back.
  const review = page.getByRole("heading", { level: 2, name: "Check your report" });
  await expect(review).toBeFocused({ timeout: 15_000 });
  await expect(review).toHaveAccessibleName("Step 4 of 4: Check your report");
  await expectVisibleFocus(page, "review heading");
  await expect(page.getByText("Step 4 of 4", { exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/^Step 4 of 4: Check your report - Report a barrier to /);
  await expect(page.getByRole("region", { name: "Your words" })).toContainText(text);
  await expect(page.getByRole("region", { name: "Your words" })).toContainText(`At a place: ${detail}`);
  await expect(page.getByRole("region", { name: "We understood" })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toContainText(/How we follow up\s*Email me, and let me check the fix/);
  await expect(main).toContainText(email);
  await expect(main).toContainText(/AI summary\s*Used/);
  const answers = page.getByRole("group", { name: "Is this right?" });
  const yes = answers.getByRole("radio", { name: "Yes, that's right" });
  const changeIt = answers.getByRole("radio", { name: "Change it" });
  const keepMine = answers.getByRole("radio", { name: "Keep my words only" });
  const noAi = page.getByLabel("Don't use AI on my report");
  const send = page.getByRole("button", { name: "Send report" });
  await tabTo(page, yes, "review: into the summary answers", { max: 3 });
  await expect(yes).not.toBeChecked(); // nothing is chosen for the person
  for (const [target, name] of [[noAi, "Don't use AI on my report"], [send, "Send report"], [back, "Back"]] as const) {
    await press(page, "Tab", `review: to ${name}`);
    await expect(target).toBeFocused();
  }
  await expect(noAi).not.toBeChecked();
  for (const [target, name] of [[send, "Send report"], [noAi, "Don't use AI on my report"]] as const) {
    await press(page, "Shift+Tab", `review: back to ${name}`);
    await expect(target).toBeFocused();
  }
  // Shift+Tab goes back into the group with nothing chosen (on its first or last answer, as the browser does).
  await press(page, "Shift+Tab", "review: back into the summary answers");
  const entered = await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.value ?? "");
  expect(["ai_confirmed", "reporter_words"], "focus is back on an end of the summary answers").toContain(entered);
  await expect(yes).not.toBeChecked();
  await expect(keepMine).not.toBeChecked();
  // The arrow keys move the answer. Passing "Change it" opens its box under it, but focus stays with the answers
  // (the arrows must still move on) and the status region says it once.
  await press(page, entered === "ai_confirmed" ? "ArrowDown" : "ArrowUp", "review: Change it");
  await expect(changeIt).toBeChecked();
  await expect(changeIt).toBeFocused();
  await expect(page.getByLabel("Your summary", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("A box for your own summary is open under Change it.");
  await press(page, "ArrowUp", "review: Yes, that's right");
  await expect(yes).toBeChecked();
  await expect(yes).toBeFocused();
  await expect(page.getByLabel("Your summary", { exact: true })).toHaveCount(0);
  await expectNoAxeViolations(page, "review, answered by keyboard");
  await tabTo(page, send, "review: to Send report", { max: 4 });
  await page.keyboard.press("Enter");

  // The receipt: focus on its h1, and the answers kept in this browser are gone. Copy code works from the keyboard
  // and leaves focus where it was.
  const receipt = page.getByRole("heading", { level: 1, name: "We got your report" });
  await expect(receipt).toBeFocused({ timeout: 15_000 });
  await expectVisibleFocus(page, "receipt heading");
  await expect(page).toHaveURL(new RegExp(`/o/${ORG}/receipt$`));
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key) ?? sessionStorage.getItem(key), DRAFT_KEY)).toBeNull();
  const ref = (await page.getByTestId("case-ref").innerText()).trim();
  expect(ref).toMatch(/^BAR-\d{4}$/);
  const copy = page.getByRole("button", { name: "Copy code" });
  await tabTo(page, copy, "receipt: to Copy code", { max: 3 });
  await press(page, "Enter", "receipt: Copy code");
  await expect(page.getByRole("main").getByText(/^(Code copied\.|The code is selected\.)/)).toBeVisible();
  await expect(copy).toBeFocused();
  await tabTo(page, page.getByRole("link", { name: "Download as a text file" }), "receipt: to the download", { max: 2 });
  // Then the receipt's other safeguards (Phase 7 T4.4), in that order.
  await press(page, "Tab", "receipt: to Print receipt");
  await expect(page.getByRole("button", { name: "Print receipt" })).toBeFocused();
  await press(page, "Tab", "receipt: to the calendar reminder");
  await expect(page.getByRole("link", { name: "Add a reminder to my calendar" })).toBeFocused();
  const openReport = page.getByRole("link", { name: "Open your report page" });
  await tabTo(page, openReport, "receipt: to Open your report page", { max: 6 });

  // The team fixes it (fixture: frozen core only). The reporter follows the link with Enter: a plain link, so a
  // fresh page load that starts at the top (nothing moves focus for the person). The skip link goes to the content.
  await advanceToRetest(ORG, ref);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/r\/[0-9A-Z-]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Your report" })).toBeVisible();
  await expect(page.getByTestId("report-status")).toHaveText("Please tell us if it works now");
  expect(await focusAtTop(page), "report page: a fresh page starts at the top").toBe(true);
  await press(page, "Tab", "report page: the skip link");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();

  // The re-test: Tab into the question, choose with the arrow keys, add a comment, send with Enter.
  const question = page.getByRole("group", { name: "Does it work for you now?" });
  const works = question.getByRole("radio", { name: "Yes, it works now" });
  await tabTo(page, works, "re-test: into the question", { max: 8 });
  await expect(works).not.toBeChecked();
  await press(page, "ArrowDown", "re-test: next answer");
  await expect(question.getByRole("radio", { name: "Partly" })).toBeChecked();
  await press(page, "ArrowUp", "re-test: back up");
  await expect(works).toBeFocused();
  await expect(works).toBeChecked();
  const comment = page.getByLabel("Anything you want to add? (optional)");
  await press(page, "Tab", "re-test: to the comment");
  await expect(comment).toBeFocused();
  await typeHere(page, "It opens now with the button.");
  await tabTo(page, page.getByRole("button", { name: "Send answer" }), "re-test: to Send answer", { max: 2 });
  await page.keyboard.press("Enter");

  // The result heading takes focus; the status region says it; the badge shows the closed loop.
  const saved = page.getByRole("heading", { level: 2, name: "Your answer is saved" });
  await expect(saved).toBeFocused({ timeout: 15_000 });
  await expectVisibleFocus(page, "re-test result heading");
  await expect(page.getByRole("status")).toContainText("fixed and confirmed by you");
  await expect(page.getByTestId("report-status")).toHaveText("Fixed and confirmed by you");
  await expect(saved).toBeFocused(); // the refresh with the new status keeps focus where it was
  await expect(page.getByRole("group", { name: "Does it work for you now?" })).toHaveCount(0);
  // Tab moves on from the result, still with a visible indicator: the answered question left no controls behind,
  // so the next stop is the page's last one, "Other ways to reach {org}" (Phase 7 T4.1), then the footer.
  await press(page, "Tab", "after the result");
  await expect(page.getByRole("button", { name: /^Other ways to reach / })).toBeFocused();
  await press(page, "Tab", "after the other ways");
  await expect(page.getByRole("contentinfo").locator(":focus")).toHaveCount(1);
  await context.close();

  // What was stored: the fix confirmed through the receipt code, and the AI summary used (the opt-out stayed off).
  const f = await caseFacts(ORG, ref);
  expect(f.status).toBe("verified");
  expect(f.summary).not.toBeNull();
  expect(f.events.map((e) => e.type)).toContain("ai_structured");
  expect(f.events.filter((e) => e.type === "retest_verdict").at(-1)?.payload).toMatchObject({ verdict: "fixed", via: "receipt_code" });
});

test("by keyboard, a missing answer moves focus to it on every step, and /check opens the report page", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  const page = await context.newPage();
  const text = `The button that opens the side door does nothing when I press it (keyboard errors ${Date.now().toString(36)}).`;

  // The skip link is the first Tab stop of a fresh page, and Enter on it moves focus into the main content.
  await page.goto(`/o/${ORG}/report`);
  await expect(page.getByRole("heading", { level: 1, name: /report a barrier/i })).toBeVisible();
  await hydrated(page, "#report-text");
  await press(page, "Tab", "skip link");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
  await press(page, "Tab", "first stop in the main content");
  expect(await page.evaluate(() => document.getElementById("main")!.contains(document.activeElement))).toBe(true);

  // Step 1, Next with nothing typed: focus goes to the text box, which says what to do.
  const what = page.getByLabel("What got in your way?");
  const next = page.getByRole("button", { name: "Next" });
  await tabTo(page, next, "step 1: to Next", { max: 3 });
  await page.keyboard.press("Enter");
  await expect(what).toBeFocused();
  await expectVisibleFocus(page, "step 1: the text box after Next");
  await expect(what).toHaveAttribute("aria-invalid", "true");
  await expect(what).toHaveAccessibleDescription(/Tell us what got in your way\. A few words is enough\./);
  await typeHere(page, text);
  await tabTo(page, next, "step 1: to Next again", { max: 2 });
  await press(page, "Enter", "step 1: Next");
  await expect(page.getByRole("heading", { level: 2, name: "Where did it happen?" })).toBeFocused();

  // Step 2, Next with no place chosen: focus goes to the first option (not chosen for the person).
  const where = page.getByRole("group", { name: "Where did it happen?" });
  const firstPlace = where.getByRole("radio", { name: "On a website or app" });
  await tabTo(page, next, "step 2: to Next", { max: 4 });
  await page.keyboard.press("Enter");
  await expect(firstPlace).toBeFocused();
  await expectVisibleFocus(page, "step 2: the first option after Next");
  await expect(firstPlace).not.toBeChecked();
  await expect(where).toHaveAccessibleDescription(/Choose where it happened/);
  await press(page, " ", "step 2: choose it");
  await expect(firstPlace).toBeChecked();
  await tabTo(page, next, "step 2: to Next again", { max: 3 });
  await press(page, "Enter", "step 2: Next");
  await expect(page.getByRole("heading", { level: 2, name: "How can we follow up?" })).toBeFocused();

  // Step 3, Next with nothing chosen: focus goes to the first answer (not chosen for the person). Then the email
  // answer with no address: Next takes focus to the email field.
  const followUp = page.getByRole("group", { name: "How can we follow up?" });
  const dontContact = followUp.getByRole("radio", { name: "Don't contact me" });
  const byEmail = followUp.getByRole("radio", { name: "Email me, and let me check the fix" });
  await tabTo(page, next, "step 3: to Next", { max: 4 });
  await page.keyboard.press("Enter");
  await expect(dontContact).toBeFocused();
  await expectVisibleFocus(page, "step 3: the first answer after Next");
  await expect(dontContact).not.toBeChecked();
  await expect(followUp).toHaveAccessibleDescription(/Choose one answer\. The first two keep you anonymous\./);
  await press(page, "ArrowDown", "step 3: the code answer");
  await press(page, "ArrowDown", "step 3: the email answer");
  await expect(byEmail).toBeChecked();
  const emailField = page.getByLabel("Email address");
  await tabTo(page, next, "step 3: to Next again", { max: 4 });
  await page.keyboard.press("Enter");
  await expect(emailField).toBeFocused();
  await expectVisibleFocus(page, "step 3: the email field after Next");
  await expect(emailField).toHaveAttribute("aria-invalid", "true");
  await expect(emailField).toHaveAccessibleDescription(/Enter your email address, or choose one of the other answers\./);
  // Change of mind: Shift+Tab back to the question and choose the code instead; the field goes away.
  await press(page, "Shift+Tab", "step 3: back to the question");
  await expect(byEmail).toBeFocused();
  await press(page, "ArrowUp", "step 3: check the fix with my code");
  await expect(followUp.getByRole("radio", { name: "Let me check the fix with my code" })).toBeChecked();
  await expect(emailField).toHaveCount(0);
  await tabTo(page, next, "step 3: to Next once more", { max: 4 });
  await page.keyboard.press("Enter");

  // The review, Send report with the summary unanswered: focus goes to the first answer.
  await expect(page.getByRole("heading", { level: 2, name: "Check your report" })).toBeFocused({ timeout: 15_000 });
  const answers = page.getByRole("group", { name: "Is this right?" });
  const yes = answers.getByRole("radio", { name: "Yes, that's right" });
  const send = page.getByRole("button", { name: "Send report" });
  await tabTo(page, send, "review: to Send report", { max: 6 });
  await page.keyboard.press("Enter");
  await expect(yes).toBeFocused();
  await expectVisibleFocus(page, "review: the first answer after Send report");
  await expect(yes).not.toBeChecked();
  await expect(answers).toHaveAccessibleDescription(/Choose one answer: Yes, that.s right, Change it, or Keep my words only./);
  // "Change it": its summary box opens under it and is the next Tab stop; emptied, Send report brings focus back to it.
  const changeIt = answers.getByRole("radio", { name: "Change it" });
  await press(page, "ArrowDown", "review: Change it");
  await expect(changeIt).toBeFocused();
  await expect(changeIt).toBeChecked();
  const yourSummary = page.getByLabel("Your summary", { exact: true });
  await press(page, "Tab", "review: to Your summary");
  await expect(yourSummary).toBeFocused();
  await expect(yourSummary).not.toHaveValue("");
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await expect(yourSummary).toHaveValue("");
  await tabTo(page, send, "review: to Send report again", { max: 4 });
  await page.keyboard.press("Enter");
  await expect(yourSummary).toBeFocused();
  await expectVisibleFocus(page, "review: Your summary after Send report");
  await expect(yourSummary).toHaveAccessibleDescription(/Write a short summary, or choose Keep my words only\./);
  await typeHere(page, "The side door button does not open the door.");
  await tabTo(page, send, "review: to Send report once more", { max: 4 });
  await page.keyboard.press("Enter");

  const receipt = page.getByRole("heading", { level: 1, name: "We got your report" });
  await expect(receipt).toBeFocused({ timeout: 15_000 });
  const code = (await page.getByTestId("receipt-code").innerText()).trim();
  const ref = (await page.getByTestId("case-ref").innerText()).trim();
  expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
  await advanceToRetest(ORG, ref);

  // /check, reached from the receipt (a plain link: a fresh page from the top, the header's three stops, then the
  // code field): a code that is too short puts focus on the error summary; its link puts focus on the field (with
  // what was typed), and the right code opens the report page with its h1 focused.
  await tabTo(page, page.getByRole("link", { name: "the Check your report page" }), "receipt: to the Check page", { max: 10 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/check\\?org=${ORG}$`)); // it says which organization (Phase 7 T4.1)
  await expect(page.getByRole("heading", { level: 1, name: "Check your report" })).toBeVisible();
  await hydrated(page, "#receipt-code");
  const codeField = page.getByLabel("Your receipt code");
  await headerThen(page, codeField, "check");
  await typeHere(page, "ABCD-1234");
  await page.keyboard.press("Enter");
  const problem = page.getByRole("heading", { level: 2, name: "There is a problem" });
  await expect(problem).toBeVisible();
  await expect(page.locator(":focus")).toContainText("There is a problem");
  await expectVisibleFocus(page, "check: the error summary");
  await press(page, "Tab", "check: the error's link");
  await expect(page.locator(":focus")).toHaveText("That code doesn't look right. It has 16 letters and numbers.");
  await page.keyboard.press("Enter");
  await expect(codeField).toBeFocused();
  await expectVisibleFocus(page, "check: the field after the error's link");
  await expect(codeField).toHaveValue("ABCD-1234");
  await expect(codeField).toHaveAttribute("aria-invalid", "true");
  await page.keyboard.press("Control+A");
  await typeHere(page, code);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/r\/[0-9A-Z-]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Your report" })).toBeFocused({ timeout: 15_000 });
  await expectVisibleFocus(page, "report page heading after /check");
  await expect(page.getByTestId("report-status")).toHaveText("Please tell us if it works now");

  // One Tab from the heading reaches the question (nothing to Tab through before it); then Send answer with
  // nothing chosen: focus on the error summary, its link to the first answer.
  const question = page.getByRole("group", { name: "Does it work for you now?" });
  const works = question.getByRole("radio", { name: "Yes, it works now" });
  await press(page, "Tab", "re-test: from the heading");
  await expect(works).toBeFocused();
  await expect(works).not.toBeChecked();
  await tabTo(page, page.getByRole("button", { name: "Send answer" }), "re-test: to Send answer", { max: 10 });
  await page.keyboard.press("Enter");
  await expect(problem).toBeVisible();
  await expect(page.locator(":focus")).toContainText("There is a problem");
  await expectVisibleFocus(page, "re-test: the error summary");
  await press(page, "Tab", "re-test: the error's link");
  await expect(page.locator(":focus")).toHaveText("Choose one answer.");
  await page.keyboard.press("Enter");
  await expect(works).toBeFocused();
  await expectVisibleFocus(page, "re-test: the first answer after the error's link");
  await expect(works).not.toBeChecked();
  for (let i = 1; i <= 3; i++) await press(page, "ArrowDown", `re-test: answer ${i + 1}`);
  await expect(question.getByRole("radio", { name: "I can't check right now" })).toBeChecked();
  await tabTo(page, page.getByRole("button", { name: "Send answer" }), "re-test: to Send answer again", { max: 3 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "Your answer is saved" })).toBeFocused({ timeout: 15_000 });
  await expectVisibleFocus(page, "re-test result heading");
  await expect(page.getByRole("status")).toContainText("marked it as fixed but not checked by you");
  await expect(page.getByTestId("report-status")).toHaveText("Fixed (not checked by you)");
  await context.close();
});

test("by keyboard, /check over the limit: the notice that takes focus shows a focus indicator", async ({ browser }) => {
  test.setTimeout(120_000);
  // lib/rate-limit.ts counts in fixed 10-minute windows aligned to the epoch: start well inside one, so the count
  // is never reset halfway through (as e2e/reporter.spec.ts does).
  const left = WINDOW_MS - (Date.now() % WINDOW_MS);
  if (left < 30_000) await new Promise((resolve) => setTimeout(resolve, left + 1_000));
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  const page = await context.newPage();
  await page.goto("/check");
  await expect(page.getByRole("heading", { level: 1, name: "Check your report" })).toBeVisible();
  await hydrated(page, "#receipt-code");
  const codeField = page.getByLabel("Your receipt code");
  await headerThen(page, codeField, "check");
  await typeHere(page, "ABCD-1234");

  // Every try counts, even a code that doesn't look right (counted before anything else). Each one puts focus on
  // the error summary; its link brings focus back to the field (with what was typed), and Enter tries again.
  for (let i = 1; i <= CHECK_LIMIT; i++) {
    await page.keyboard.press("Enter");
    await expect(page.locator(":focus"), `try ${i}`).toContainText("There is a problem");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(codeField, `try ${i}: back on the field`).toBeFocused();
  }

  // One more: the calm notice takes focus, and shows it (it is not an error summary, but it is where focus went).
  await page.keyboard.press("Enter");
  const focused = page.locator(":focus");
  await expect(focused).toContainText("We could not check your code");
  await expect(focused).toContainText(RATE_LIMITED);
  await expectVisibleFocus(page, "check over the limit: the notice");
  await expect(page.getByRole("status")).toHaveText(RATE_LIMITED);
  await expect(page).toHaveURL(/\/check$/);
  // From the notice, Tab goes on to the field, which keeps what was typed.
  await press(page, "Tab", "check over the limit: to the field");
  await expect(codeField).toBeFocused();
  await expect(codeField).toHaveValue("ABCD-1234");
  await context.close();
});

test("staff pages with the sticky header: focus is never under it, going forward or back", async ({ browser }) => {
  test.setTimeout(240_000);
  // From 64rem the staff header is sticky (components/layout/SiteHeader.tsx): use a desktop size well above it.
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  await signInByKeyboard(page, "Alex Rivera");
  await expect(page.locator("[data-sticky-header]")).toHaveCSS("position", "sticky");
  const walk = (label: string, max: number) => walkPage(page, label, max);

  // The lead's home is the dashboard (staffHome): walk it first, its count links and "Show as table" buttons.
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await walk("dashboard", 60);

  // Another section: Shift+Tab back into the header's tabs, Enter; the new page's h1 takes focus.
  async function openTab(tab: string, path: string, heading: string | RegExp) {
    if (new URL(page.url()).pathname === path) return;
    const link = page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: tab, exact: true });
    await tabTo(page, link, `to the ${tab} tab`, { back: true, max: 80 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeFocused({ timeout: 15_000 });
    await expectVisibleFocus(page, `${tab} heading`);
  }
  await openTab("Inbox", "/app/inbox", "Inbox");
  await walk("inbox", 60);

  // Open a case with Enter on its link; the case page's h1 takes focus. Then walk it.
  const table = page.getByRole("region", { name: /^Cases received/ });
  await tabTo(page, table, "inbox: to the table region", { max: 60 });
  await press(page, "Tab", "inbox: first case link");
  const caseLink = page.locator(":focus");
  await expect(caseLink).toHaveText(/^BAR-\d{4}$/);
  const ref = (await caseLink.innerText()).trim();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${ref}`) })).toBeFocused({ timeout: 15_000 });
  await expectVisibleFocus(page, "case page heading");
  await walk("case page", 60);

  // The two long forms, reached through the header's tabs.
  await openTab("Log feedback", "/app/cases/new", "Log feedback received another way");
  await walk("Log feedback", 60);
  await openTab("Settings", "/app/settings", /./);
  await walk("Settings", 60);

  // Progress reports (Phase 4): the list, its one "New report" link, then "Generate draft" with the period's
  // default dates (this calendar year). Each new page's h1 takes focus.
  await openTab("Reports", "/app/reports", "Progress reports");
  await walk("reports", 40);
  await tabTo(page, page.getByRole("link", { name: "New report" }), "reports: to New report", { max: 12 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/reports\/new$/);
  await expect(page.getByRole("heading", { level: 1, name: "New progress report" })).toBeFocused({ timeout: 15_000 });
  await expectVisibleFocus(page, "new report heading");
  await walk("new report", 30);
  await tabTo(page, page.getByRole("button", { name: "Generate draft" }), "new report: to Generate draft", { max: 16 });
  await page.keyboard.press("Enter");

  // The draft: its h1 takes focus and "Draft ready" is the one announcement. Once the building moment has played,
  // Tab down the report (under the sticky header all the way) to the first footnote of the Feedback section.
  await page.waitForURL(/\/app\/reports\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1, name: /^Accessibility progress report \d{4}, version \d+$/ })).toBeFocused({ timeout: 15_000 });
  await expectVisibleFocus(page, "draft heading");
  await expect(page.getByRole("status")).toHaveText("Draft ready");
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
  const feedback = page.getByRole("region", { name: "Feedback" });
  const sources = feedback.getByRole("button", { name: SOURCES_NAME }).first();
  await tabTo(page, sources, "draft: to the first Feedback footnote", { max: 100 });
  await expect(sources).toHaveAttribute("aria-expanded", "false");

  // Enter opens its card with focus kept on the button; Tab reaches the first record's link inside the card;
  // Shift+Tab comes back, and Space closes it again.
  await press(page, "Enter", "draft: open the footnote");
  await expect(sources).toHaveAttribute("aria-expanded", "true");
  await expect(sources).toBeFocused();
  const list = feedback.getByRole("list", { name: "Sources" });
  await expect(list).toContainText(/BAR-\d{4}/);
  await press(page, "Tab", "draft: into the Sources card");
  await expect(list.getByRole("link", { name: /^Open BAR-\d{4}$/ }).first()).toBeFocused();
  await press(page, "Shift+Tab", "draft: back to the footnote");
  await expect(sources).toBeFocused();
  await press(page, " ", "draft: close the footnote");
  await expect(sources).toHaveAttribute("aria-expanded", "false");
  await expect(sources).toBeFocused();
  await expect(feedback.getByRole("list", { name: "Sources" })).toHaveCount(0);
  await context.close();
});

test("a progress report by keyboard: every part written and saved, signed off, published, its sources and its evidence check", async ({ browser }) => {
  test.setTimeout(300_000);
  // A fresh draft through the app's own report code ("Generate draft" by keyboard is in the staff test above).
  const draft = await makeReport(ORG);
  const title = new RegExp(`^${escapeRe(draft.title)}$`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  const page = await context.newPage();
  await signInByKeyboard(page, "Alex Rivera");

  // The draft (a full page load: focus starts at the top). Each text box: Tab to it, type, Tab to its Save button,
  // Enter. The result shows under that button and focus stays on it (a long document: focus never jumps away).
  await page.goto(`/app/reports/${draft.id}`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  const boxes = page.getByRole("textbox");
  const parts = await boxes.count();
  expect(parts).toBeGreaterThan(1);
  for (let i = 0; i < parts; i++) {
    const box = boxes.nth(i);
    const id = await box.getAttribute("id");
    await tabTo(page, box, `draft: to text box ${i + 1}`, { max: 80 });
    await typeHere(page, `Progress written with the keyboard (${id}).`);
    // (A `has:` locator is evaluated inside each form, so pick the form by its text box's id.)
    const save = page.locator(`form:has(#${id})`).getByRole("button", { name: /^Save .+ text$/ });
    await press(page, "Tab", `draft: to its Save button (${id})`);
    await expect(save).toBeFocused();
    await press(page, "Enter", `draft: Save (${id})`);
    await expect(page.getByTestId(`${id}-result`)).toContainText("Saved.");
    await expect(save).toBeFocused();
    await expectVisibleFocus(page, `draft: Save (${id}) after saving`);
  }
  await expect(page.getByRole("region", { name: "Report checks" })).toContainText("Every part has its text");

  // The checks and sign-off come after the whole report (every footnote) in the Tab order, wherever they are drawn:
  // Shift+Tab back up to the draft note's "Go to the report checks", Enter, and the next Tab is in the panel.
  await tabTo(page, page.getByRole("link", { name: "Go to the report checks" }), "draft: back to Go to the report checks", { back: true, max: 80 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Report checks" })).toBeInViewport();

  // Sign off, then Publish: each button is replaced by the next step, so focus goes to the result at the top of the
  // panel, which shows the focus ring (a Notice in a focus target).
  const result = page.getByTestId("report-result");
  await tabTo(page, page.getByRole("button", { name: "Sign off" }), "report checks: to Sign off", { max: 10 });
  await page.keyboard.press("Enter");
  await expect(result).toContainText("Signed off.");
  await expect(result).toBeFocused();
  await expectVisibleFocus(page, "the sign-off result");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await tabTo(page, page.getByRole("button", { name: "Publish", exact: true }), "signed off: to Publish", { max: 8 });
  await page.keyboard.press("Enter");
  await expect(result).toContainText("Published.");
  await expect(result).toBeFocused();
  await expectVisibleFocus(page, "the publish result");

  // The published page, by its link: its h1 takes focus. A Feedback footnote: Enter opens its Sources card with focus
  // kept; public refs are plain text, so a long list is one focusable scroll region (Tab goes into it) and a short
  // one has nothing to stop on (Tab goes on to the next footnote). Shift+Tab comes back and Space closes it.
  await tabTo(page, page.getByRole("link", { name: "View the published page" }), "published: to View the published page", { max: 8 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/p/${ORG}/reports/${draft.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeFocused({ timeout: 15_000 });
  await expectVisibleFocus(page, "published report heading");
  const feedback = page.getByRole("region", { name: "Feedback" });
  const sources = feedback.getByRole("button", { name: SOURCES_NAME }).first();
  await tabTo(page, sources, "published report: to the first Feedback footnote", { max: 60 });
  await press(page, "Enter", "published report: open the footnote");
  await expect(sources).toHaveAttribute("aria-expanded", "true");
  await expect(sources).toBeFocused();
  const list = feedback.getByRole("list", { name: "Sources" });
  await expect(list).toContainText(/BAR-\d{4}/);
  await expect(list.getByRole("link")).toHaveCount(0); // never links into staff pages
  const scrolls = (await list.getAttribute("tabindex")) === "0";
  await press(page, "Tab", "published report: on from the open footnote");
  if (scrolls) await expect(list).toBeFocused();
  else await expect(page.locator(":focus")).toHaveText(SOURCES_NAME);
  await press(page, "Shift+Tab", "published report: back to the footnote");
  await expect(sources).toBeFocused();
  await press(page, " ", "published report: close the footnote");
  await expect(sources).toHaveAttribute("aria-expanded", "false");
  await expect(sources).toBeFocused();
  await expect(feedback.getByRole("list", { name: "Sources" })).toHaveCount(0);

  // Back to the report's staff page (the browser's Back): its h1 takes focus, and the header's "Verify evidence chain"
  // is the next stop. The evidence check's h1 takes focus; the lead is signed in, so it is the staff page (Reports
  // the current tab), walked forward and back under the sticky header; "Back to the report" returns, h1 focused.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/app/reports/${draft.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeFocused({ timeout: 15_000 });
  await tabTo(page, page.getByRole("link", { name: "Verify evidence chain" }), "staff report: to Verify evidence chain", { max: 5 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/verify/${draft.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Evidence check" })).toBeFocused({ timeout: 15_000 });
  await expectVisibleFocus(page, "evidence check heading");
  await expect(page.getByTestId("evidence-line")).toHaveText(/^All records match/);
  await expect(page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "true");
  await walkPage(page, "evidence check", 40);
  await tabTo(page, page.getByRole("link", { name: "Back to the report" }), "evidence check: to Back to the report", { max: 40 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/app/reports/${draft.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeFocused({ timeout: 15_000 });
  await expect(page.locator("[data-report-state]").first()).toHaveText("Published");
  await context.close();

  // Anyone: the org's public page lists the report (newest first) and Enter opens it, its h1 focused. Its public
  // evidence check (a fresh page load): the Records table is one focusable region with nothing to open inside, and
  // "Back to the report" returns to the report, its h1 focused. (The public report's own "Verify evidence chain" is
  // in its footer, after every footnote: a walk there grows with the shared database, so it is not walked.)
  const anon = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  const pub = await anon.newPage();
  await pub.goto(`/p/${ORG}`);
  await expect(pub.getByRole("heading", { level: 1, name: /: accessibility feedback$/ })).toBeVisible();
  await tabTo(pub, pub.locator(`a[href="/p/${ORG}/reports/${draft.id}"]`), "public page: to the new report", { max: 40 });
  await pub.keyboard.press("Enter");
  await expect(pub.getByRole("heading", { level: 1, name: title })).toBeFocused({ timeout: 15_000 });
  await expectVisibleFocus(pub, "public report heading");
  await pub.goto(`/verify/${draft.id}`);
  await expect(pub.getByRole("heading", { level: 1, name: "Evidence check" })).toBeVisible();
  await expect(pub.getByTestId("evidence-line")).toHaveText(/^All records match/);
  const records = pub.getByRole("region", { name: "Records", exact: true });
  await tabTo(pub, records, "public evidence check: to the Records table", { max: 20 });
  await expect(records.getByRole("link")).toHaveCount(0);
  await tabTo(pub, pub.getByRole("link", { name: "Back to the report" }), "public evidence check: back to Back to the report", { back: true, max: 20 });
  await pub.keyboard.press("Enter");
  await expect(pub).toHaveURL(new RegExp(`/p/${ORG}/reports/${draft.id}$`));
  await expect(pub.getByRole("heading", { level: 1, name: title })).toBeFocused({ timeout: 15_000 });
  await anon.close();
});
