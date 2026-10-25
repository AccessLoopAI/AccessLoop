// Channels and messages (docs/domain.md §1.3 ACR s.9, §3, §4; Phase 2 Slice C): staff-logged intake by phone and by
// email, the receipt code shown once (or emailed, never shown), acknowledgement in the same means, the re-test
// request email and the one reminder per round, the web form's acknowledgement email, the Outbox (never an address,
// never a code), the org settings page (on Lakeview, restored after), lead-only pages and actions, and axe in light
// AND dark on every new page and state. FAKE_EMAIL=1: nothing is sent; outbound_messages logs "skipped_fake".
// Specs share one database and run in file order: never assume fixed counts or fresh org settings.
import { test, expect, type Browser, type Page } from "@playwright/test";
import { expectNoAxeViolations, signInAs } from "./helpers";
import { caseFacts, fileReport, moveCase } from "./fixtures/cases";
import { messagesOf, orgSettingsOf, outboxCount, restoreOrgSettings } from "./fixtures/messages";
import { SIGNED_OUT } from "@/lib/auth/signed-out";
import { zonedDate, zonedNoon } from "@/lib/dates";
import { formatDateLong } from "@/lib/format";

const ORG = "maple-harbour";
const LAKEVIEW = "lakeview-telecom";
const LOCAL = process.env.AUTH_MODE === "local";
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;
const READ_CODE = "Read this code to the person; it won't be shown again";
const PLACEHOLDER = "[receipt code: in the sent email only, never stored]";
const ROLE_REFUSED = "Your role can't do this. Nothing was saved.";
const AN_ADDRESS = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
type Role = "lead" | "owner" | "auditor" | "other-lead";

let counter = 0;
// Base 36, so the stamp is never a long digit run (layer 1 would hide it as an account number).
const stamp = () => `${Date.now().toString(36)}-${++counter}`;

/** YYYY-MM-DD `n` days before today in the display time zone (America/Toronto), like the server. */
function daysAgo(n: number): string {
  const [y, m, d] = zonedDate(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}
const longDate = (iso: string) => formatDateLong(zonedNoon(iso));

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

/** Wait for running CSS transitions and animations (a theme switch starts colour transitions) before axe. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
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

/** Reflow (WCAG 1.4.10): at 320 CSS px nothing scrolls the page sideways (tables scroll inside their region). */
async function noSideScrollAt320(page: Page, label: string) {
  const size = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 800 });
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, `${label}: page width at 320px`).toBeLessThanOrEqual(320);
  if (size) await page.setViewportSize(size);
}

const group = (page: Page, name: string) => page.getByRole("group", { name });
const pick = (page: Page, question: string, answer: string) => group(page, question).getByRole("radio", { name: answer, exact: true }).check();
const caseResult = (page: Page) => page.getByTestId("case-action-result");
const region = (page: Page, name: string) => page.getByRole("region", { name });

async function openCase(page: Page, ref: string) {
  const res = await page.goto(`/app/cases/${ref}`);
  expect(res?.status(), ref).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${ref}`) })).toBeVisible();
}

interface Intake {
  channel: "Email" | "Phone" | "Mail" | "In person" | "Other";
  date?: string;
  text: string;
  where: string;
  anonymous: boolean;
  email?: string;
  contact?: string;
  retest: boolean;
  noAi?: boolean;
}

async function fillIntake(page: Page, f: Intake) {
  await pick(page, "How did it arrive?", f.channel);
  if (f.date) await page.getByLabel("Date received").fill(f.date);
  await page.getByLabel("What they told us").fill(f.text);
  await pick(page, "Where did it happen?", f.where);
  await pick(page, "Does the person want to stay anonymous?", f.anonymous ? "Yes" : "No");
  if (f.email) await page.getByLabel("Email address (optional)").fill(f.email);
  if (f.contact) await page.getByLabel("Phone or mailing address (optional)").fill(f.contact);
  await pick(page, "Can we ask them to check the fix later?", f.retest ? "Yes" : "No");
  if (f.noAi) await page.getByLabel("They asked us not to use AI on their report").check();
}

/** Log feedback through the form and wait for the confirmation. Returns the ref (and the code when shown). */
async function logIntake(page: Page, f: Intake): Promise<{ ref: string; code: string | null }> {
  await page.goto("/app/cases/new");
  await expect(page.getByRole("heading", { level: 1, name: "Log feedback received another way" })).toBeVisible();
  await fillIntake(page, f);
  await page.getByRole("button", { name: "Log feedback" }).click();
  const logged = page.getByRole("heading", { level: 2, name: /^Feedback logged as BAR-\d{4,6}$/ });
  await expect(logged).toBeFocused({ timeout: 15_000 });
  const ref = (await page.getByTestId("case-ref").innerText()).trim();
  const codes = page.getByTestId("receipt-code");
  const code = (await codes.count()) ? (await codes.innerText()).trim() : null;
  return { ref, code };
}

/* ------------------------------------------------------------------ staff-logged intake */

test.describe("staff-logged intake (/app/cases/new)", () => {
  test("phone feedback without an email: the code is shown once, with the exact instruction, and never again", async ({ browser }) => {
    const page = await staffPage(browser, "lead");
    await page.goto("/app/cases/new");
    await expect(page.getByRole("heading", { level: 1, name: "Log feedback received another way" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("status")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Log feedback" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByLabel("Date received")).toHaveValue(zonedDate(new Date()));
    await axeBothThemes(page, "log feedback: empty");

    // Nothing chosen: one ErrorSummary that takes focus, each message also on its field.
    await page.getByRole("button", { name: "Log feedback" }).click();
    const summary = page.locator(":focus");
    await expect(summary).toContainText("There is a problem");
    for (const msg of ["Choose how the feedback arrived.", "Write what they told us.", "Choose where it happened.",
      "Choose if the person wants to stay anonymous.", "Choose if we can ask them to check the fix later."]) {
      await expect(summary).toContainText(msg);
    }
    await expect(page.getByLabel("What they told us")).toHaveAttribute("aria-invalid", "true");
    await axeBothThemes(page, "log feedback: with errors");
    await noSideScrollAt320(page, "log feedback: with errors");

    // A date in the future is refused; what was typed stays.
    const received = daysAgo(3);
    const text = `Caller says the phone menu has no way to reach a person, and the TTY line rings out (channels ${stamp()}).`;
    await fillIntake(page, { channel: "Phone", date: daysAgo(-1), text, where: "On the phone or at a service", anonymous: false, contact: "416-555-0199", retest: true });
    await page.getByRole("button", { name: "Log feedback" }).click();
    await expect(page.locator(":focus")).toContainText("The date received can't be in the future.");
    await expect(page.getByLabel("What they told us")).toHaveValue(text);

    await page.getByLabel("Date received").fill(received);
    await page.getByRole("button", { name: "Log feedback" }).click();
    await expect(page.getByRole("heading", { level: 2, name: /^Feedback logged as BAR-\d{4,6}$/ })).toBeFocused({ timeout: 15_000 });
    await expect(page.getByText(READ_CODE, { exact: true })).toBeVisible();
    const code = (await page.getByTestId("receipt-code").innerText()).trim();
    expect(code).toMatch(CODE_RE);
    const ref = (await page.getByTestId("case-ref").innerText()).trim();
    await expect(page.getByRole("status")).toContainText(`Feedback logged as ${ref}`);
    await expect(page.getByRole("status")).not.toContainText(code);
    await axeBothThemes(page, "log feedback: code shown");
    await noSideScrollAt320(page, "log feedback: code shown");

    // The code is nowhere but this screen: not in the URL, not in a cookie, not in the database.
    expect(page.url()).not.toContain(code);
    expect(JSON.stringify(await page.context().cookies())).not.toContain(code);
    const facts = await caseFacts(ORG, ref);
    expect(facts.status).toBe("new");
    const submitted = facts.events.find((e) => e.type === "submitted")!;
    expect(submitted.actorKind).toBe("staff");
    expect(submitted.payload).toMatchObject({ channel: "phone", codeRelayedByStaff: true, hasEmail: false, isAnonymous: false, wantsRetest: true });
    expect(JSON.stringify(facts.events)).not.toContain(code);
    expect(facts.events.map((e) => e.type)).not.toContain("ack_recorded"); // a phone call is acknowledged by the lead
    expect(await messagesOf(ORG, ref)).toEqual([]);

    // A reload never shows it again: an empty form.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Log feedback received another way" })).toBeVisible();
    await expect(page.getByTestId("receipt-code")).toHaveCount(0);
    await expect(page.getByText(READ_CODE)).toHaveCount(0);
    await expect(page.getByLabel("What they told us")).toHaveValue("");
    expect(await page.getByRole("main").innerText()).not.toContain(code);

    // The person can use it: the code opens their report page.
    const reporter = await (await browser.newContext()).newPage();
    expect((await reporter.goto(`/r/${code}`))?.status()).toBe(200);
    await expect(reporter.getByRole("heading", { level: 1, name: "Your report" })).toBeVisible();
    await reporter.context().close();

    // The case page: received three days ago by phone, not acknowledged yet. The lead records the call back.
    await openCase(page, ref);
    await expect(page.locator("header.al-page-header")).toContainText(`Received ${longDate(received)}`);
    const details = region(page, "Case details");
    await expect(details).toContainText("Not acknowledged yet");
    await expect(details).toContainText("Phone");
    await expect(region(page, "History")).toContainText("Feedback received by phone");
    await expect(region(page, "History")).toContainText("Staff gave the receipt code to the person.");
    await expect(page.getByRole("button", { name: "Send acknowledgement email" })).toHaveCount(0);
    const ackDate = page.getByLabel("I acknowledged by phone on");
    await expect(ackDate).toHaveValue(zonedDate(new Date()));
    await axeBothThemes(page, "case: phone intake, acknowledgement form");

    await ackDate.fill(daysAgo(4)); // before the day it arrived
    await page.getByRole("button", { name: "Record acknowledgement" }).click();
    await expect(page.locator(":focus")).toContainText("The date can't be before the day the feedback arrived");
    const ackOn = daysAgo(2);
    await ackDate.fill(ackOn);
    await page.getByRole("button", { name: "Record acknowledgement" }).click();
    await expect(caseResult(page)).toContainText(`Acknowledgement recorded: acknowledged by phone on ${longDate(ackOn)}.`);
    await expect(caseResult(page)).toBeFocused();
    await expect(details).toContainText(`Acknowledged by phone on ${longDate(ackOn)}`);
    await expect(region(page, "History")).toContainText("Acknowledgement recorded (by phone)");
    // The History keeps the day it was given (two days ago), not only the day it was recorded (today).
    await expect(region(page, "History")).toContainText(`Given to the person on ${longDate(ackOn)}.`);
    await expect(page.getByRole("button", { name: "Record acknowledgement" })).toHaveCount(0);
    await expect(page.getByText("Acknowledged on screen")).toHaveCount(0);
    await axeBothThemes(page, "case: phone intake, acknowledgement recorded");
    const after = await caseFacts(ORG, ref);
    const ack = after.events.find((e) => e.type === "ack_recorded")!;
    expect(ack.actorKind).toBe("staff");
    expect(ack.payload).toEqual({ channel: "phone", manual: true, on: ackOn });
    await page.context().close();
  });

  test("Back after opening the new case never shows the code again", async ({ browser }) => {
    const page = await staffPage(browser, "lead");
    const { ref, code } = await logIntake(page, {
      channel: "In person", text: `A visitor said the counter is too high to sign at (channels ${stamp()}).`,
      where: "At a place", anonymous: true, retest: false, noAi: true,
    });
    expect(code).toMatch(CODE_RE);
    await page.getByRole("link", { name: `Open case ${ref}` }).click();
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${ref}`) })).toBeVisible();
    await expect(region(page, "Case details")).toContainText("Anonymous: no acknowledgement needed");
    await expect(page.getByRole("button", { name: "Record acknowledgement" })).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/app\/cases\/new$/);
    await expect(page.getByRole("heading", { level: 1, name: "Log feedback received another way" })).toBeVisible();
    await expect(page.getByTestId("receipt-code")).toHaveCount(0);
    expect(await page.getByRole("main").innerText()).not.toContain(code!);
    const facts = await caseFacts(ORG, ref);
    expect(facts.events.find((e) => e.type === "submitted")!.payload).toMatchObject({ channel: "in_person", codeRelayedByStaff: true, aiOptOut: true, isAnonymous: true });
    expect(facts.events.map((e) => e.type)).not.toContain("ai_structured");
    await page.context().close();
  });

  test("a failed attempt's line goes away once a retry works; a known person with no contact details is described as such", async ({ browser }) => {
    const page = await staffPage(browser, "lead");
    await page.goto("/app/cases/new");
    await expect(page.getByRole("heading", { level: 1, name: "Log feedback received another way" })).toBeVisible();
    // The first "Log feedback" never reaches the server (a dropped connection); the next one does.
    let dropped = false;
    await page.route("**/app/cases/new", (route) => {
      if (!dropped && route.request().method() === "POST") {
        dropped = true;
        return route.abort();
      }
      return route.continue();
    });
    const text = `A letter says the branch's large-print forms ran out again (channels ${stamp()}).`;
    await fillIntake(page, { channel: "Mail", text, where: "At a place", anonymous: false, retest: false, noAi: true });
    await page.getByRole("button", { name: "Log feedback" }).click();
    const line = page.getByTestId("intake-result");
    await expect(line).toContainText("Nothing was saved");
    await expect(line).toBeFocused();
    await expect(page.getByLabel("What they told us")).toHaveValue(text); // nothing typed is lost
    await page.getByRole("button", { name: "Log feedback" }).click();
    await expect(page.getByRole("heading", { level: 2, name: /^Feedback logged as BAR-\d{4,6}$/ })).toBeFocused({ timeout: 15_000 });
    await expect(line).toHaveCount(0); // the failure line never contradicts the success view
    const ref = (await page.getByTestId("case-ref").innerText()).trim();
    await page.unroute("**/app/cases/new");

    // "No" to anonymity with neither an email nor a contact: the case page doesn't claim contact details exist.
    await openCase(page, ref);
    const details = region(page, "Case details");
    await expect(details).toContainText("Not anonymous, but no contact details were recorded");
    await expect(details).not.toContainText("Gave contact details");
    await expect(page.getByLabel("I acknowledged by mail on")).toBeVisible(); // domain §4's wording
    await page.context().close();
  });

  test("a session that ended while typing: the form says so and keeps what was typed (WCAG 2.2.1)", async ({ browser }) => {
    const page = await staffPage(browser, "lead");
    await page.goto("/app/cases/new");
    await expect(page.getByRole("heading", { level: 1, name: "Log feedback received another way" })).toBeVisible();
    const text = `A caller said the website's chat window traps the keyboard (channels ${stamp()}).`;
    await fillIntake(page, { channel: "Phone", text, where: "On the phone or at a service", anonymous: true, retest: false, noAi: true });
    await page.context().clearCookies(); // the session ended (or they signed out in another tab)
    await page.getByRole("button", { name: "Log feedback" }).click();
    const line = page.getByTestId("intake-result");
    await expect(line).toContainText(SIGNED_OUT);
    await expect(line).toBeFocused();
    await expect(page).toHaveURL(/\/app\/cases\/new$/);
    await expect(page.getByLabel("What they told us")).toHaveValue(text);
    await page.context().close();
  });

  test("email feedback with an address: the code is emailed, never shown; the Outbox shows it; the acknowledgement email is recorded", async ({ browser }) => {
    const page = await staffPage(browser, "lead");
    const address = `channels.${stamp()}@example.com`;
    const { ref, code } = await logIntake(page, {
      channel: "Email", text: `Your online statements are images, so my screen reader can't read them (channels ${stamp()}).`,
      where: "On a website or app", anonymous: false, email: address, retest: true,
    });
    expect(code).toBeNull();
    await expect(page.getByTestId("receipt-code")).toHaveCount(0);
    await expect(page.getByText(READ_CODE)).toHaveCount(0);
    await expect(page.getByText("The receipt code was emailed to the person")).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText(address);
    await axeBothThemes(page, "log feedback: code emailed");

    const facts = await caseFacts(ORG, ref);
    expect(facts.events.find((e) => e.type === "submitted")!.payload).toMatchObject({ channel: "email", codeRelayedByStaff: false, hasEmail: true });
    const sentEvent = facts.events.find((e) => e.type === "message_sent")!;
    expect(sentEvent.payload).toMatchObject({ template: "receipt_code", channel: "email", status: "skipped_fake", codeIncluded: true });
    expect(JSON.stringify(facts.events)).not.toContain(address);
    const logged = await messagesOf(ORG, ref);
    expect(logged.map((m) => [m.template, m.status, m.channel])).toEqual([["receipt_code", "skipped_fake", "email"]]);
    expect(sentEvent.payload.messageId).toBe(logged[0].id);

    // The Outbox: the email that would have been sent, with the code's placeholder, and never an address.
    await page.goto("/app/outbox");
    await expect(page.getByRole("heading", { level: 1, name: "Outbox" })).toBeVisible();
    await expect(page.getByText("Email is simulated in this prototype")).toBeVisible();
    const row = page
      .getByRole("row")
      .filter({ hasText: ref })
      .filter({ has: page.getByRole("cell", { name: "Receipt code", exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Not sent: simulated email");
    await expect(row.getByRole("rowheader").getByRole("link", { name: ref })).toBeVisible();
    await row.getByRole("button", { name: /^Show the email/ }).click();
    await expect(row.getByRole("button", { name: /^Show the email/ })).toHaveAttribute("aria-expanded", "true");
    await expect(row.getByText(/To: The reporter.s email \(never shown\)/)).toBeVisible(); // the opened email's "To:" line
    await expect(row).toContainText(`Your receipt code (${ref})`);
    await expect(row).toContainText(PLACEHOLDER);
    await expect(row).not.toContainText(/[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/);
    const main = await page.getByRole("main").innerText();
    expect(main).not.toContain(address);
    expect(main).not.toMatch(AN_ADDRESS);
    await axeBothThemes(page, "outbox: with rows, an email open");
    await noSideScrollAt320(page, "outbox: with rows, an email open");

    // Acknowledge it the same way it came: by email.
    await openCase(page, ref);
    const details = region(page, "Case details");
    await expect(details).toContainText("Not acknowledged yet");
    await expect(page.getByLabel(/^I acknowledged .+ on$/)).toHaveCount(0);
    await axeBothThemes(page, "case: email intake, acknowledgement email form");
    await page.getByRole("button", { name: "Send acknowledgement email" }).click();
    await expect(caseResult(page)).toContainText("Acknowledgement email logged, not sent");
    await expect(caseResult(page)).toBeFocused();
    await expect(details).toContainText("Acknowledged by email on");
    await expect(region(page, "History")).not.toContainText("Given to the person"); // the email went out today
    await axeBothThemes(page, "case: email intake, acknowledgement email sent");
    await expect(page.getByRole("button", { name: "Send acknowledgement email" })).toHaveCount(0);
    const history = region(page, "History");
    await expect(history).toContainText("Email logged, not sent (simulated): receipt code email");
    await expect(history).toContainText("Email logged, not sent (simulated): acknowledgement email");
    await expect(history).toContainText("Acknowledgement recorded (by email)");
    await expect(page.getByText("Acknowledged on screen")).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText(address);
    const acked = await caseFacts(ORG, ref);
    expect(acked.events.find((e) => e.type === "ack_recorded")!.payload).toMatchObject({ channel: "email" });
    expect((await messagesOf(ORG, ref)).map((m) => m.template)).toEqual(["receipt_code", "ack"]);

    await page.goto("/app/outbox");
    const ackRow = page.getByRole("row").filter({ hasText: ref }).filter({ has: page.getByRole("cell", { name: "Acknowledgement", exact: true }) });
    await expect(ackRow).toHaveCount(1);
    await ackRow.getByRole("button", { name: /^Show the email/ }).click();
    await expect(ackRow).toContainText(`We received your feedback (${ref})`);
    await expect(ackRow).not.toContainText(PLACEHOLDER); // this one never had a code in it
    await page.context().close();
  });
});

/* ------------------------------------------------------------------ re-test emails */

test.describe("re-test emails (domain §3 re-test ethics)", () => {
  test("the request goes out when an owner logs a fix; the lead may send one reminder, once", async ({ browser }) => {
    const address = `retest.${stamp()}@example.com`;
    const filed = await fileReport(ORG, { text: `The automatic door button at the side entrance is broken (channels ${stamp()}).`, wantsRetest: true, email: address });
    await moveCase(ORG, filed.ref, "assigned");

    const owner = await staffPage(browser, "owner");
    await openCase(owner, filed.ref);
    await owner.getByLabel("What did you fix?").fill("Replaced the door operator and tested it.");
    await owner.getByRole("button", { name: "Log fix" }).click();
    await expect(owner.getByTestId("case-status")).toHaveText("Waiting for the reporter to check");
    await expect(owner.getByRole("button", { name: "Send a reminder email" })).toHaveCount(0); // lead only
    await owner.context().close();

    await expect.poll(async () => (await messagesOf(ORG, filed.ref)).map((m) => m.template)).toEqual(["retest_request"]);
    const facts = await caseFacts(ORG, filed.ref);
    const request = facts.events.find((e) => e.type === "message_sent")!;
    expect(request.actorKind).toBe("system");
    expect(request.payload).toMatchObject({ template: "retest_request", status: "skipped_fake", round: 1, codeIncluded: false });
    expect(JSON.stringify(facts.events)).not.toContain(address);

    const lead = await staffPage(browser, "lead");
    await openCase(lead, filed.ref);
    await expect(region(lead, "History")).toContainText("Email logged, not sent (simulated): re-test request email");
    const remind = lead.getByRole("button", { name: "Send a reminder email" });
    await expect(remind).toHaveCount(1);
    await axeBothThemes(lead, "case: waiting for the reporter, reminder available");
    await remind.click();
    await expect(caseResult(lead)).toContainText("Reminder email logged, not sent");
    await expect(caseResult(lead)).toContainText("It is the only reminder for round 1.");
    await expect(remind).toHaveCount(0);
    await expect(lead.getByText("A reminder email went out on")).toBeVisible();
    await axeBothThemes(lead, "case: waiting for the reporter, reminder sent");
    await lead.reload();
    await expect(lead.getByRole("button", { name: "Send a reminder email" })).toHaveCount(0);
    expect((await messagesOf(ORG, filed.ref)).map((m) => m.template)).toEqual(["retest_request", "retest_reminder"]);

    // The Outbox has both, with no code in either.
    await lead.goto("/app/outbox");
    const reminderRow = lead.getByRole("row").filter({ hasText: filed.ref }).filter({ has: lead.getByRole("cell", { name: "Re-test reminder", exact: true }) });
    await expect(reminderRow).toHaveCount(1);
    await reminderRow.getByRole("button", { name: /^Show the email/ }).click();
    await expect(reminderRow).toContainText("This is the only reminder we will send about this fix.");
    await expect(reminderRow).not.toContainText(PLACEHOLDER);
    await expect(lead.getByRole("row").filter({ hasText: filed.ref }).filter({ has: lead.getByRole("cell", { name: "Re-test request", exact: true }) })).toHaveCount(1);
    await lead.context().close();
  });

  test("an anonymous reporter gets no re-test email and no reminder button", async ({ browser }) => {
    const filed = await fileReport(ORG, { text: `The ramp at the back door is too steep (channels ${stamp()}).`, wantsRetest: true });
    await moveCase(ORG, filed.ref, "fixed");
    const lead = await staffPage(browser, "lead");
    await openCase(lead, filed.ref);
    await expect(lead.getByTestId("case-status")).toHaveText("Waiting for the reporter to check");
    await expect(lead.getByRole("button", { name: "Send a reminder email" })).toHaveCount(0);
    expect(await messagesOf(ORG, filed.ref)).toEqual([]);
    await lead.context().close();
  });
});

/* ------------------------------------------------------------------ the web form's acknowledgement email */

test("a web report with an email gets the acknowledgement email; the Outbox shows it with the code's placeholder", async ({ browser }) => {
  const reporter = await (await browser.newContext()).newPage();
  const address = `web.${stamp()}@example.com`;
  await reporter.goto(`/o/${ORG}/report`);
  await reporter.getByLabel("What got in your way?").fill(`The branch door is too heavy to open from a wheelchair (channels ${stamp()}).`);
  await reporter.getByRole("button", { name: "Next" }).click();
  await reporter.getByRole("group", { name: "Where did it happen?" }).getByRole("radio", { name: "At a place" }).check();
  await reporter.getByRole("button", { name: "Next" }).click();
  await reporter.getByRole("group", { name: "How can we follow up?" }).getByRole("radio", { name: "Email me, and let me check the fix" }).check();
  await reporter.getByLabel("Email address").fill(address);
  await reporter.getByRole("button", { name: "Next" }).click();
  await expect(reporter.getByRole("heading", { level: 2, name: "Check your report" })).toBeFocused({ timeout: 15_000 });
  await reporter.getByRole("radio", { name: "Yes, that's right" }).check();
  await reporter.getByRole("button", { name: "Send report" }).click();
  await expect(reporter.getByRole("heading", { level: 1, name: "We got your report" })).toBeFocused();
  const ref = (await reporter.getByTestId("case-ref").innerText()).trim();
  const code = (await reporter.getByTestId("receipt-code").innerText()).trim();
  await reporter.context().close();

  expect((await messagesOf(ORG, ref)).map((m) => [m.template, m.status])).toEqual([["ack", "skipped_fake"]]);
  const facts = await caseFacts(ORG, ref);
  expect(facts.events.find((e) => e.type === "ack_recorded")!.payload).toMatchObject({ channel: "web_screen" }); // the receipt is the s.9(4) acknowledgement
  expect(facts.events.find((e) => e.type === "message_sent")!.payload).toMatchObject({ template: "ack", codeIncluded: true });
  expect(JSON.stringify(facts.events)).not.toContain(address);
  expect(JSON.stringify(facts.events)).not.toContain(code);

  const lead = await staffPage(browser, "lead");
  await lead.goto("/app/outbox");
  const row = lead.getByRole("row").filter({ hasText: ref }).filter({ has: lead.getByRole("cell", { name: "Acknowledgement", exact: true }) });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: /^Show the email/ }).click();
  await expect(row).toContainText(PLACEHOLDER);
  await expect(row).not.toContainText(code);
  expect(await lead.getByRole("main").innerText()).not.toContain(address);
  // The case page shows the on-screen acknowledgement once, and asks for no other.
  await openCase(lead, ref);
  await expect(lead.getByText("Acknowledged on screen")).toHaveCount(1);
  await expect(lead.getByRole("button", { name: "Send acknowledgement email" })).toHaveCount(0);
  await lead.context().close();
});

/* ------------------------------------------------------------------ settings */

test("settings: errors in place, then a successful save, on Lakeview (restored afterwards)", async ({ browser }) => {
  const original = await orgSettingsOf(LAKEVIEW);
  const mapleBefore = await orgSettingsOf(ORG);
  try {
    const page = await staffPage(browser, "other-lead");
    await page.goto("/app/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(page.getByLabel("Title of the person who receives feedback")).toHaveValue(original.feedbackDesignateTitle);
    await expect(page.getByLabel("Email address")).toHaveValue(original.contactEmail);
    await expect(page.getByLabel("Organization type")).toHaveValue(original.entityClass);
    const areas = group(page, "Areas in your accessibility plan");
    await expect(areas.getByRole("checkbox")).toHaveCount(7);
    await expect(areas.getByRole("checkbox", { checked: true })).toHaveCount(original.planAreas.length);
    await axeBothThemes(page, "settings");

    await page.getByLabel("Title of the person who receives feedback").fill("");
    await page.getByLabel("Email address").fill("not an email");
    await page.getByLabel("Phone number").fill("call us");
    for (const box of await areas.getByRole("checkbox").all()) await box.uncheck();
    await page.getByRole("button", { name: "Save settings" }).click();
    const summary = page.locator(":focus");
    await expect(summary).toContainText("There is a problem");
    await expect(summary).toContainText("Enter the title of the person who receives feedback");
    await expect(summary).toContainText("Enter an email address");
    await expect(summary).toContainText("Enter a phone number");
    await expect(summary).toContainText("Choose at least one area");
    await expect(page.getByLabel("Email address")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Email address")).toHaveValue("not an email"); // nothing typed is lost
    await axeBothThemes(page, "settings: with errors");
    await noSideScrollAt320(page, "settings: with errors");
    expect(await orgSettingsOf(LAKEVIEW)).toEqual(original);

    const title = `Accessibility Lead (e2e ${stamp()})`;
    await page.getByLabel("Title of the person who receives feedback").fill(title);
    await page.getByLabel("Email address").fill("access@example.org");
    await page.getByLabel("Phone number").fill("1-800-555-0199");
    await areas.getByRole("checkbox", { name: "Information and communication technologies", exact: true }).check();
    await areas.getByRole("checkbox", { name: "Transportation", exact: true }).check();
    await page.getByLabel("What you offer people who check a fix (optional)").fill("We thank you with a coffee card.");
    await page.getByLabel("Organization type").selectOption("federal_public");
    await page.getByRole("button", { name: "Save settings" }).click();
    const done = page.getByTestId("settings-result");
    await expect(done).toContainText("Settings saved.");
    await expect(done).toBeFocused();
    await expect(page.getByRole("status")).toContainText("Settings saved.");
    await axeBothThemes(page, "settings: saved");

    const saved = await orgSettingsOf(LAKEVIEW);
    expect(saved).toEqual({
      ...original,
      feedbackDesignateTitle: title,
      contactEmail: "access@example.org",
      contactPhone: "1-800-555-0199",
      planAreas: ["ict", "transportation"],
      retestOfferText: "We thank you with a coffee card.",
      entityClass: "federal_public",
    });
    expect(await orgSettingsOf(ORG)).toEqual(mapleBefore); // only the signed-in lead's own org
    await page.reload();
    await expect(page.getByLabel("Title of the person who receives feedback")).toHaveValue(title);
    await expect(areas.getByRole("checkbox", { checked: true })).toHaveCount(2);
    await page.context().close();
  } finally {
    await restoreOrgSettings(LAKEVIEW, original);
  }
  expect(await orgSettingsOf(LAKEVIEW)).toEqual(original);
});

/* ------------------------------------------------------------------ lead only */

test.describe("lead-only pages and actions", () => {
  test("owners and auditors get 404 on Log feedback, the Outbox and Settings, and don't see them in the navigation", async ({ browser }) => {
    test.skip(!LOCAL, "the auditor signs in through the local 'Sign in as' page");
    for (const role of ["owner", "auditor"] as const) {
      const page = await staffPage(browser, role);
      const nav = page.getByRole("navigation", { name: "Staff" });
      for (const name of ["Log feedback", "Outbox", "Settings"]) await expect(nav.getByRole("link", { name })).toHaveCount(0);
      for (const path of ["/app/cases/new", "/app/outbox", "/app/settings"]) {
        const res = await page.goto(path);
        expect(res?.status(), `${role} ${path}`).toBe(404);
        await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(/Log feedback|Outbox|Settings/);
        await expect(page.getByRole("main")).not.toContainText(PLACEHOLDER);
      }
      await page.context().close();
    }
    const lead = await staffPage(browser, "lead");
    const nav = lead.getByRole("navigation", { name: "Staff" });
    await expect(nav.getByRole("link")).toHaveText(["Dashboard", "Inbox", "Log feedback", "My work", "Reports", "Outbox", "Eval", "Settings"]);
    await lead.context().close();
  });

  test("every new action refuses an owner or an auditor, even from a lead's open page", async ({ browser }) => {
    test.skip(!LOCAL, "switches sessions through the local 'Sign in as' page");
    const lead = await staffPage(browser, "lead");
    const emailCase = await logIntake(lead, {
      channel: "Email", text: `The PDF forms can't be filled in with a keyboard (refuse ack ${stamp()}).`,
      where: "In a document", anonymous: false, email: `refuse.${stamp()}@example.com`, retest: false,
    });
    const phoneCase = await logIntake(lead, {
      channel: "Phone", text: `The hold music drowns out the menu options (refuse record ${stamp()}).`,
      where: "On the phone or at a service", anonymous: false, retest: false,
    });
    const retest = await fileReport(ORG, { text: `The elevator buttons have no braille (refuse remind ${stamp()}).`, wantsRetest: true, email: `remind.${stamp()}@example.com` });
    await moveCase(ORG, retest.ref, "fixed");
    await lead.context().close();

    const context = await browser.newContext();
    const pages = { intake: await context.newPage(), settings: await context.newPage(), ack: await context.newPage(), record: await context.newPage(), remind: await context.newPage() };
    await signInAsRole(pages.intake, "lead");
    await pages.intake.goto("/app/cases/new");
    const intakeText = `Refused intake ${stamp()}: the website times out too fast.`;
    await fillIntake(pages.intake, { channel: "Mail", text: intakeText, where: "On a website or app", anonymous: true, retest: false });
    await pages.settings.goto("/app/settings");
    await expect(pages.settings.getByRole("button", { name: "Save settings" })).toBeVisible();
    await openCase(pages.ack, emailCase.ref);
    await openCase(pages.record, phoneCase.ref);
    await openCase(pages.remind, retest.ref);
    const settingsBefore = await orgSettingsOf(ORG);
    const casesBefore = await messagesOf(ORG, emailCase.ref);

    const attempt = async () => {
      await pages.intake.getByRole("button", { name: "Log feedback" }).click();
      await expect(pages.intake.getByTestId("intake-result")).toContainText(ROLE_REFUSED);
      await expect(pages.intake.getByTestId("receipt-code")).toHaveCount(0);
      await pages.settings.getByRole("button", { name: "Save settings" }).click();
      await expect(pages.settings.getByTestId("settings-result")).toContainText(ROLE_REFUSED);
      await pages.ack.getByRole("button", { name: "Send acknowledgement email" }).click();
      await expect(pages.ack.getByTestId("case-action-result")).toContainText(ROLE_REFUSED);
      await pages.record.getByRole("button", { name: "Record acknowledgement" }).click();
      await expect(pages.record.getByTestId("case-action-result")).toContainText(ROLE_REFUSED);
      await pages.remind.getByRole("button", { name: "Send a reminder email" }).click();
      await expect(pages.remind.getByTestId("case-action-result")).toContainText(ROLE_REFUSED);
    };
    const unchanged = async () => {
      expect(await orgSettingsOf(ORG)).toEqual(settingsBefore);
      expect(await messagesOf(ORG, emailCase.ref)).toEqual(casesBefore);
      expect((await caseFacts(ORG, emailCase.ref)).events.map((e) => e.type)).not.toContain("ack_recorded");
      expect((await caseFacts(ORG, phoneCase.ref)).events.map((e) => e.type)).not.toContain("ack_recorded");
      expect(await messagesOf(ORG, retest.ref)).toEqual([]);
    };

    const switcher = await context.newPage();
    await signInAsRole(switcher, "owner");
    await attempt();
    await unchanged();
    await signInAsRole(switcher, "auditor");
    await attempt();
    await unchanged();
    // No case was created from the refused intake.
    const inbox = await staffPage(browser, "lead");
    await inbox.goto("/app/inbox");
    await expect(inbox.getByRole("main")).not.toContainText(intakeText.slice(0, 30));
    await inbox.context().close();
    await context.close();
  });
});

/* ------------------------------------------------------------------ the Outbox when empty */

test("the Outbox of an org with no emails says what will appear there (Lakeview)", async ({ browser }) => {
  const page = await staffPage(browser, "other-lead");
  const res = await page.goto("/app/outbox");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Outbox" })).toBeVisible();
  if ((await outboxCount(LAKEVIEW)) === 0) {
    await expect(page.getByRole("heading", { level: 2, name: "No emails yet" })).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  } else {
    await expect(page.getByRole("table", { name: /Emails sent to reporters/ })).toBeVisible();
  }
  await axeBothThemes(page, "outbox: Lakeview");
  await page.context().close();
});
