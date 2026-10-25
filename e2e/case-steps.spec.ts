// Phase 7 T2 (docs/phase7-prompt.md items 1, 3, 4, 8 and 9; human decisions D1-D4): the case page's new and changed steps.
// D1 the close reasons depend on the status; D2 "Correct the triage"; D3 "Stop waiting" 14 days after the request;
// D4 reopening a verified or closed case; and the truthful "Log fix" answer (the reporter is never said to be asked
// when nobody was); notes and interim accommodations (item 4), a duplicate's original with the link both ways
// (item 8), and an acknowledgement recorded late (item 9). Every case is fresh (e2e/fixtures/cases.ts); the reporter's
// answers go through /r/[code].
// axe in light and dark on each new form. Specs share one database: never assume fixed counts.
import { test, expect, type Browser, type Page } from "@playwright/test";
import { expectNoAxeViolations, signInAs } from "./helpers";
import { caseFacts, fileReport, logFixDaysAgo, moveCase } from "./fixtures/cases";
import { zonedDate, zonedNoon } from "@/lib/dates";
import { formatDateLong } from "@/lib/format";

const ORG = "maple-harbour";
const LEAD = "Alex Rivera";

let counter = 0;
const stamp = () => `${Date.now().toString(36)}-${++counter}`;
const DOOR = () => `The automatic door button at the side entrance is broken (case steps ${stamp()}).`;

async function staffPage(browser: Browser, role: "lead" | "owner") {
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, role === "lead" ? "E2E_LEAD_EMAIL" : "E2E_OWNER_EMAIL");
  return page;
}

async function openCase(page: Page, ref: string) {
  const res = await page.goto(`/app/cases/${ref}`);
  expect(res?.status(), ref).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${ref}`) })).toBeVisible();
}

async function axeBothThemes(page: Page, label: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    // Back to the top (as e2e/dashboard.spec.ts does): the staff header is sticky from 64rem, and a target scrolled
    // under it reads to axe as an "obscured" target-size problem (focus is kept clear of it by scroll-padding).
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
      window.scrollTo(0, 0);
    });
    await expectNoAxeViolations(page, `${label} (${colorScheme})`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

const result = (page: Page) => page.getByTestId("case-action-result");
const history = (page: Page) => page.getByRole("region", { name: "History" });

async function answerOnReceiptPage(browser: Browser, code: string, label: string) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/r/${code}`);
  await page.getByRole("group", { name: "Does it work for you now?" }).getByRole("radio", { name: label }).check();
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Your answer is saved" })).toBeVisible();
  await page.context().close();
}

test.describe("closing (D1) and reopening a closed case (D4)", () => {
  test("an assigned case closes only as a duplicate (of a named original) or no action possible; reopened, it goes back to Triaged", async ({ browser }) => {
    const original = await fileReport(ORG, { text: DOOR(), wantsRetest: false });
    await moveCase(ORG, original.ref, "assigned");
    const filed = await fileReport(ORG, { text: DOOR(), wantsRetest: false });
    await moveCase(ORG, filed.ref, "assigned");
    const page = await staffPage(browser, "lead");
    await openCase(page, filed.ref);
    await page.getByRole("button", { name: "Close without a fix" }).click();
    const reason = page.getByLabel("Reason for closing");
    await expect(reason.locator("option")).toHaveText(["Choose a reason", "Duplicate of another case", "No action possible"]);
    await expect(page.getByText("Work has started on this case, so it can only be closed as a duplicate or as no action possible.")).toBeVisible();
    const originalField = page.getByLabel("Reference of the original case");
    await expect(originalField).toHaveCount(0); // only for a duplicate
    await axeBothThemes(page, "case: assigned, close form");

    // T2 item 8: a duplicate names its original, a case of this org (not itself).
    await reason.selectOption("duplicate");
    await expect(originalField).toBeVisible();
    await page.getByRole("button", { name: "Close case" }).click();
    await expect(page.locator(":focus")).toContainText("Type the reference of the case this one repeats");
    await axeBothThemes(page, "case: close as duplicate, error");
    await originalField.fill("BAR-99999");
    await page.getByRole("button", { name: "Close case" }).click();
    await expect(page.locator(":focus")).toContainText("There is no case BAR-99999 in this organization.");
    await originalField.fill(filed.ref);
    await page.getByRole("button", { name: "Close case" }).click();
    await expect(page.locator(":focus")).toContainText(`${filed.ref} is this case.`);
    await expect(page.getByTestId("case-status")).toHaveText("Assigned"); // nothing was saved
    await originalField.fill(` ${original.ref.toLowerCase()} `); // typed by a person: case and spaces don't matter
    await page.getByRole("button", { name: "Close case" }).click();
    await expect(page.getByTestId("case-status")).toHaveText("Closed");
    await expect(result(page)).toContainText(`Case closed as a duplicate of ${original.ref}. Status: Closed.`);
    const notice = page.getByText(`Duplicate of ${original.ref}. The work on this barrier goes on in that case.`);
    await expect(notice).toBeVisible();
    await expect(history(page)).toContainText(`Closed: duplicate of ${original.ref}`);
    // The "Original case" link stands on its own line in the History: a 44px target (CLAUDE.md), like the evidence link.
    const historyLink = history(page).getByRole("link", { name: original.ref, exact: true });
    expect((await historyLink.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("region", { name: "Case details" }).getByRole("link", { name: original.ref, exact: true })).toBeVisible();
    const closed = (await caseFacts(ORG, filed.ref)).events.filter((e) => e.type === "closed").pop()!;
    expect(closed.payload).toMatchObject({ reason: "duplicate", duplicateOf: { ref: original.ref } });
    await axeBothThemes(page, "case: closed as a duplicate");

    // The link both ways: the original lists this report under "Reported again".
    await page.getByRole("region", { name: "Case details" }).getByRole("link", { name: original.ref, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${original.ref}`) })).toBeVisible();
    const again = page.getByRole("region", { name: "Case details" });
    await expect(again).toContainText("1 other report was closed as a duplicate of this case");
    await expect(again.getByRole("link", { name: filed.ref, exact: true })).toBeVisible();
    // The owner of the original sees that it was reported again, but no other case's ref.
    const owner = await staffPage(browser, "owner");
    await openCase(owner, original.ref);
    await expect(owner.getByRole("region", { name: "Case details" })).toContainText("1 other report was closed as a duplicate of this case.");
    await expect(owner.getByRole("main")).not.toContainText(filed.ref);
    await owner.context().close();
    await page.goto(`/app/cases/${filed.ref}`);
    await expect(page.getByTestId("case-status")).toHaveText("Closed");

    // D4: the closed case can be reopened, behind a quiet toggle; a reason is required.
    await page.getByRole("button", { name: "Reopen this case" }).click();
    await expect(page.getByText("If the case was closed by mistake, reopen it. It goes back to Triaged")).toBeVisible();
    await axeBothThemes(page, "case: closed, reopen form");
    await page.getByRole("button", { name: "Reopen case" }).click();
    await expect(page.locator(":focus")).toContainText("Say why you are reopening it.");
    await page.getByLabel("Why are you reopening it?").fill("It is not a duplicate: the other report was about another door.");
    await page.getByRole("button", { name: "Reopen case" }).click();
    await expect(page.getByTestId("case-status")).toHaveText("Triaged");
    await expect(result(page)).toContainText("Case reopened. Status: Triaged. Assign it to someone to fix it.");
    await expect(history(page)).toContainText(`Reopened by ${LEAD}`);
    const facts = await caseFacts(ORG, filed.ref);
    expect(facts.status).toBe("triaged");
    expect(facts.assignee).toBeNull();
    // Triaged again, but it was assigned before (D1): never "spam" or "out of scope", so a case someone worked on
    // can't be closed out of the numbers after a reopen (review finding, docs/decisions.md 2026-10-21).
    await page.getByRole("button", { name: "Close without a fix" }).click();
    await expect(page.getByLabel("Reason for closing").locator("option")).toHaveText(["Choose a reason", "Duplicate of another case", "No action possible"]);
    await expect(page.getByText("Work has started on this case, so it can only be closed as a duplicate or as no action possible.")).toBeVisible();
    // Reopened, it is no longer a duplicate: the original stops listing it (the History keeps the close).
    await expect(history(page)).toContainText(`Closed: duplicate of ${original.ref}`);
    await openCase(page, original.ref);
    await expect(page.getByRole("region", { name: "Case details" })).not.toContainText("Reported again");
    await page.context().close();
  });

  test("a new case closed as not feedback about a barrier reopens to New", async ({ browser }) => {
    const filed = await fileReport(ORG, { text: `Cheap watches here (case steps ${stamp()})`, aiOptOut: true });
    const page = await staffPage(browser, "lead");
    await openCase(page, filed.ref);
    await page.getByRole("button", { name: "Close without a fix" }).click();
    await page.getByLabel("Reason for closing").selectOption({ label: "Not feedback about a barrier" });
    await page.getByRole("button", { name: "Close case" }).click();
    await expect(page.getByTestId("case-status")).toHaveText("Closed");
    await page.getByRole("button", { name: "Reopen this case" }).click();
    await page.getByLabel("Why are you reopening it?").fill("It was real feedback after all.");
    await page.getByRole("button", { name: "Reopen case" }).click();
    await expect(page.getByTestId("case-status")).toHaveText("New");
    await expect(result(page)).toContainText("Case reopened. Status: New. Check the redaction, then triage it.");
    await page.context().close();
  });
});

test.describe("correcting the triage (D2)", () => {
  test("the lead corrects the area of an assigned case with a reason; the History keeps both", async ({ browser }) => {
    const filed = await fileReport(ORG, { text: DOOR(), wantsRetest: false });
    await moveCase(ORG, filed.ref, "assigned");
    const page = await staffPage(browser, "lead");
    await openCase(page, filed.ref);
    await page.getByRole("button", { name: "Correct the triage" }).click();
    await expect(page.getByLabel("Area", { exact: true })).toHaveValue("built_environment");
    await expect(page.getByLabel("Summary for public reports")).toHaveValue("A door at a branch entrance did not open.");
    await axeBothThemes(page, "case: assigned, correct the triage");

    // Nothing changed: refused, nothing saved.
    await page.getByLabel("Why are you correcting it?").fill("Checking.");
    await page.getByRole("button", { name: "Save correction" }).click();
    await expect(result(page)).toContainText("Nothing was saved: change the area or the public summary, or both.");

    await page.getByLabel("Area", { exact: true }).selectOption("ict");
    await page.getByLabel("Why are you correcting it?").fill("It was the booking website, not the door.");
    await page.getByRole("button", { name: "Save correction" }).click();
    await expect(result(page)).toContainText("Area corrected. Status: Assigned.");
    await expect(page.getByTestId("case-status")).toHaveText("Assigned");
    await expect(history(page)).toContainText("Area corrected: Information and communication technologies");
    await expect(history(page)).toContainText("Why: It was the booking website, not the door.");
    await expect(history(page)).toContainText("Triaged: The built environment"); // the first triage stays in the log
    const facts = await caseFacts(ORG, filed.ref);
    expect([facts.status, facts.priorityArea]).toEqual(["assigned", "ict"]);
    expect(facts.assignee).not.toBeNull(); // still the same team's case
    const last = facts.events.filter((e) => e.type === "triaged").pop()!;
    expect(last.payload).toMatchObject({ retriage: true, changed: ["priorityArea"], priorityArea: "ict", from: "assigned", to: "assigned" });
    await page.context().close();
  });
});

test.describe("asking the reporter, honestly; stopping the wait (D3); reopening a verified case (D4)", () => {
  test("with no email on file, Log fix says nobody was emailed; the lead can stop waiting only from day 14", async ({ browser }) => {
    const filed = await fileReport(ORG, { text: DOOR(), wantsRetest: true });
    await moveCase(ORG, filed.ref, "assigned");
    const owner = await staffPage(browser, "owner");
    await openCase(owner, filed.ref);
    await owner.getByLabel("What did you fix?").fill("Replaced the door operator motor.");
    await owner.getByRole("button", { name: "Log fix" }).click();
    await expect(owner.getByTestId("case-status")).toHaveText("Waiting for the reporter to check");
    await expect(result(owner)).toContainText(
      "Fix logged. Status: Waiting for the reporter to check. No contact on file: they'll see it only if they open their report page with their code.",
    );
    await expect(owner.getByTestId("retest-asked")).toContainText("No contact on file: they'll see it only if they open their report page with their code.");
    await expect(owner.getByRole("main")).not.toContainText("is asked");
    await owner.context().close();

    const lead = await staffPage(browser, "lead");
    await openCase(lead, filed.ref);
    await expect(lead.getByTestId("retest-asked")).toContainText("No contact on file");
    await expect(lead.getByText(/you can stop waiting from .+, 14 days after they were asked/)).toBeVisible();
    await expect(lead.getByRole("button", { name: "Stop waiting" })).toHaveCount(0);
    await lead.context().close();
  });

  test("with an email on file, Log fix says the request email was logged (simulated email)", async ({ browser }) => {
    const filed = await fileReport(ORG, { text: DOOR(), wantsRetest: true, email: `sam.${stamp()}@example.com` });
    await moveCase(ORG, filed.ref, "assigned");
    const lead = await staffPage(browser, "lead");
    await openCase(lead, filed.ref);
    await lead.getByLabel("What did you fix?").fill("Replaced the door operator motor.");
    await lead.getByRole("button", { name: "Log fix" }).click();
    await expect(lead.getByTestId("case-status")).toHaveText("Waiting for the reporter to check");
    await expect(result(lead)).toContainText(
      "The email asking the reporter to check it was logged, not sent (email is simulated in this prototype; the Outbox shows it).",
    );
    await expect(lead.getByTestId("retest-asked")).toContainText("was logged, not sent");
    await lead.context().close();
  });

  test("20 days after the request, the lead stops waiting: fixed, not verified, reporter unreachable", async ({ browser }) => {
    const filed = await fileReport(ORG, { text: DOOR(), wantsRetest: true });
    await moveCase(ORG, filed.ref, "assigned");
    await logFixDaysAgo(ORG, filed.ref, 20);
    const page = await staffPage(browser, "lead");
    await openCase(page, filed.ref);
    await expect(page.getByTestId("case-status")).toHaveText("Waiting for the reporter to check");
    await expect(page.getByRole("heading", { level: 3, name: "Stop waiting for the reporter" })).toBeVisible();
    await axeBothThemes(page, "case: waiting 20 days, stop waiting");
    await page.getByRole("button", { name: "Stop waiting" }).click();
    await expect(page.getByTestId("case-status")).toHaveText("Fixed, not verified by reporter");
    await expect(result(page)).toContainText(
      "Stopped waiting for the reporter. Status: Fixed, not verified by reporter. The fix counts as not verified by the reporter.",
    );
    await expect(history(page)).toContainText("Stopped waiting for the reporter after 20 days: reporter unreachable");
    const facts = await caseFacts(ORG, filed.ref);
    expect(facts.events[facts.events.length - 1]).toMatchObject({
      type: "retest_expired",
      actorKind: "staff",
      payload: { reason: "reporter_unreachable", afterDays: 20, from: "retest_open", to: "fixed_unverified" },
    });
    // The round is over: the reporter's page no longer asks.
    const reporter = await (await browser.newContext()).newPage();
    await reporter.goto(`/r/${filed.code}`);
    await expect(reporter.getByRole("group", { name: "Does it work for you now?" })).toHaveCount(0);
    await reporter.context().close();
    await page.context().close();
  });

  test("a verified case reopens to Assigned and is no longer verified", async ({ browser }) => {
    const filed = await fileReport(ORG, { text: DOOR(), wantsRetest: true });
    await moveCase(ORG, filed.ref, "fixed");
    await answerOnReceiptPage(browser, filed.code, "Yes, it works now");
    const page = await staffPage(browser, "lead");
    await openCase(page, filed.ref);
    await expect(page.getByTestId("case-status")).toHaveText("Verified by reporter");
    await page.getByRole("button", { name: "Reopen this case" }).click();
    await expect(page.getByText("from now on it no longer counts as verified by the reporter")).toBeVisible();
    await axeBothThemes(page, "case: verified, reopen form");
    await page.getByLabel("Why are you reopening it?").fill("The door stopped opening again a month later.");
    await page.getByRole("button", { name: "Reopen case" }).click();
    await expect(page.getByTestId("case-status")).toHaveText("Assigned");
    await expect(result(page)).toContainText("Case reopened. Status: Assigned.");
    await expect(page.getByRole("region", { name: "Case details" })).not.toContainText("Confirmed by the reporter");
    const facts = await caseFacts(ORG, filed.ref);
    expect(facts.status).toBe("assigned");
    expect(facts.events[facts.events.length - 1]).toMatchObject({ type: "reopened", payload: { from: "verified", to: "assigned" } });
    await page.context().close();
  });
});

/* ------------------------------------------------------------------ T2 items 4 and 9 */

/** YYYY-MM-DD `n` days before today in the display time zone (America/Toronto), like the server. */
function daysAgo(n: number): string {
  const [y, m, d] = zonedDate(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

const notesCard = (page: Page) => page.getByRole("region", { name: "Notes" });

test.describe("notes and interim accommodations (T2 item 4)", () => {
  test("the lead and the assigned owner add notes; an interim accommodation has its own label; the auditor only reads", async ({ browser }) => {
    const filed = await fileReport(ORG, { text: DOOR(), wantsRetest: false });
    await moveCase(ORG, filed.ref, "assigned");
    const lead = await staffPage(browser, "lead");
    await openCase(lead, filed.ref);
    const card = notesCard(lead);
    await expect(card).toContainText("No notes yet.");
    await expect(card.getByRole("group", { name: "What kind of note is it?" }).getByRole("radio", { name: "Internal note" })).toBeChecked();
    await axeBothThemes(lead, "case: notes, empty");

    await card.getByRole("button", { name: "Add note" }).click();
    await expect(lead.locator(":focus")).toContainText("Write the note.");
    await axeBothThemes(lead, "case: notes, error");

    // An interim accommodation: what the person was offered meanwhile (layer 1 takes the phone number out).
    await card.getByRole("radio", { name: "Interim accommodation" }).check();
    await card.getByLabel("Note", { exact: true }).fill("Staff open the side door on request; the branch line is 416-555-0142.");
    await card.getByRole("button", { name: "Add note" }).click();
    await expect(result(lead)).toContainText("Interim accommodation added. It is in the case history, for staff only: the reporter does not see it.");
    await expect(card.getByLabel("Note", { exact: true })).toHaveValue(""); // the form empties
    await expect(card.getByRole("radio", { name: "Internal note" })).toBeChecked();
    await expect(card.getByRole("listitem").first()).toContainText("Interim accommodation");
    await expect(card).toContainText("Staff open the side door on request; the branch line is [PHONE].");
    await expect(history(lead)).toContainText(`Interim accommodation added by ${LEAD}`);
    await expect(history(lead)).toContainText("Offered meanwhile: Staff open the side door on request");
    await expect(lead.getByRole("main")).not.toContainText("416-555-0142");
    const facts = await caseFacts(ORG, filed.ref);
    expect(facts.events[facts.events.length - 1]).toMatchObject({
      type: "note_added",
      actorKind: "staff",
      payload: { kind: "interim_accommodation", note: "Staff open the side door on request; the branch line is [PHONE]." },
    });
    expect(JSON.stringify(facts.events)).not.toContain("416-555-0142");
    await lead.context().close();

    // The owner the case is assigned to reads the lead's note and adds an internal one (newest first).
    const owner = await staffPage(browser, "owner");
    await openCase(owner, filed.ref);
    const ownerCard = notesCard(owner);
    await expect(ownerCard).toContainText("Staff open the side door on request");
    await ownerCard.getByLabel("Note", { exact: true }).fill("A new door operator is ordered; it arrives next week.");
    await ownerCard.getByRole("button", { name: "Add note" }).click();
    await expect(result(owner)).toContainText("Internal note added.");
    await expect(ownerCard.getByRole("listitem").first()).toContainText("Internal note");
    await expect(ownerCard.getByRole("listitem").first()).toContainText("A new door operator is ordered");
    await expect(history(owner)).toContainText("Internal note added by Facilities team");
    await axeBothThemes(owner, "case: notes, owner");
    await owner.context().close();

    // The auditor reads the notes; there is no form.
    const auditor = await (await browser.newContext()).newPage();
    await auditor.goto("/sign-in");
    await auditor.getByRole("button", { name: /^Sign in as Internal audit .*Maple Harbour/ }).click();
    await auditor.waitForURL(/\/app\//);
    await openCase(auditor, filed.ref);
    await expect(notesCard(auditor).getByRole("listitem")).toHaveCount(2);
    await expect(auditor.getByRole("button", { name: "Add note" })).toHaveCount(0);
    await auditor.context().close();
  });
});

test.describe("acknowledgement honesty (T2 item 9)", () => {
  test("a call acknowledged 12 days ago and recorded today says so, and the dashboard counts it as recorded late", async ({ browser }) => {
    const page = await staffPage(browser, "lead");
    const received = daysAgo(12);
    await page.goto("/app/cases/new");
    await expect(page.getByRole("heading", { level: 1, name: "Log feedback received another way" })).toBeVisible();
    const pick = (question: string, answer: string) =>
      page.getByRole("group", { name: question }).getByRole("radio", { name: answer, exact: true }).check();
    await pick("How did it arrive?", "Phone");
    await page.getByLabel("Date received").fill(received);
    await page.getByLabel("What they told us").fill(`The branch phone menu hangs up before I can choose an option (case steps ${stamp()}).`);
    await pick("Where did it happen?", "On the phone or at a service");
    await pick("Does the person want to stay anonymous?", "No");
    await pick("Can we ask them to check the fix later?", "No");
    await page.getByLabel("They asked us not to use AI on their report").check();
    await page.getByRole("button", { name: "Log feedback" }).click();
    await expect(page.getByRole("heading", { level: 2, name: /^Feedback logged as BAR-\d{4,6}$/ })).toBeFocused({ timeout: 15_000 });
    const ref = (await page.getByTestId("case-ref").innerText()).trim();

    await openCase(page, ref);
    await page.getByLabel("I acknowledged by phone on").fill(received); // they called back the day it came in...
    await page.getByRole("button", { name: "Record acknowledgement" }).click(); // ...but it is written down today
    const details = page.getByRole("region", { name: "Case details" });
    const longDate = (iso: string) => formatDateLong(zonedNoon(iso));
    await expect(details).toContainText(`Acknowledged by phone on ${longDate(received)}`);
    await expect(page.getByTestId("ack-recorded-on")).toHaveText(
      `Recorded on ${longDate(zonedDate(new Date()))}, 12 days later: more than 7 days after the day it gives.`,
    );
    await expect(history(page)).toContainText(`Given to the person on ${longDate(received)}. Recorded 12 days later.`);
    await axeBothThemes(page, "case: acknowledgement recorded late");

    // The dashboard's acknowledgement tile says how many records were written more than 7 days late, and links them.
    await page.goto("/app/dashboard");
    const late = page.getByTestId("tile-acknowledgement").getByRole("link", { name: /recorded more than 7 days after the date given$/ });
    await expect(late).toHaveAttribute("href", /ack=late/);
    await late.click();
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeFocused();
    await expect(page.getByRole("main")).toContainText("Acknowledgement recorded more than 7 days after the date it gives");
    await expect(page.getByRole("link", { name: ref, exact: true })).toBeVisible();
    await page.context().close();
  });
});

test.describe("correcting an approved redaction (T2 stretch)", () => {
  test("the lead hides a name the approval missed: a new record, every text redacted again, the owner sees it hidden", async ({ browser }) => {
    // Layer 1 and the fake name check both miss "Morgan", so the approved redaction shows it.
    const filed = await fileReport(ORG, {
      text: `The automatic door button at the side entrance is broken. Morgan at the front desk had to let me in (case steps ${stamp()}).`,
      wantsRetest: false,
    });
    await moveCase(ORG, filed.ref, "assigned");
    const lead = await staffPage(browser, "lead");
    await openCase(lead, filed.ref);
    const report = lead.getByRole("region", { name: "The report, with personal details removed" });
    await expect(report).toContainText("Morgan at the front desk");
    await report.getByRole("button", { name: "Hide a detail that was missed" }).click();
    await axeBothThemes(lead, "case: correct the redaction, open");

    await report.getByLabel("Exact words to hide").fill("Morgan");
    await report.getByLabel("Kind of detail").selectOption("STAFF_NAME");
    await report.getByRole("button", { name: "Hide these words" }).click();
    await expect(report).toContainText("Hidden in 1 place. It is saved when you save the corrected redaction.");
    await expect(report.getByRole("heading", { level: 3, name: "The report with these words hidden" })).toBeVisible();
    await expect(report).toContainText("[STAFF_NAME] at the front desk");
    await axeBothThemes(lead, "case: correct the redaction, preview");
    await report.getByRole("button", { name: "Save the corrected redaction" }).click();
    await expect(result(lead)).toContainText(/Redaction corrected: \d+ details? (is|are) hidden now\./);
    await expect(report).not.toContainText("Morgan");
    await expect(report).toContainText("[STAFF_NAME] at the front desk");
    await expect(history(lead)).toContainText(`Redaction corrected by ${LEAD}`);
    await expect(history(lead)).toContainText(`Redaction approved by ${LEAD}`); // the first approval stays in the log
    const facts = await caseFacts(ORG, filed.ref);
    expect(facts.redactedText).toContain("[STAFF_NAME] at the front desk");
    const approvals = facts.events.filter((e) => e.type === "redaction_approved");
    expect(approvals).toHaveLength(2);
    expect(approvals[1].payload).toMatchObject({ revision: true, removed: 0, added: 1 });
    expect(JSON.stringify(approvals)).not.toContain("Morgan"); // spans are offsets and types, never the value

    // The same words again: nothing new to hide, nothing saved (the toggle stays open after the save).
    const toggle = report.getByRole("button", { name: "Hide a detail that was missed" });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(report).not.toContainText("It is saved when you save the corrected redaction."); // the last answer is gone
    await report.getByLabel("Exact words to hide").fill("Morgan");
    await report.getByRole("button", { name: "Hide these words" }).click();
    await expect(lead.locator(":focus")).toContainText("These words are already hidden everywhere they appear.");
    await lead.context().close();

    // The owner reads the corrected text, with no way to correct it.
    const owner = await staffPage(browser, "owner");
    await openCase(owner, filed.ref);
    await expect(owner.getByRole("main")).not.toContainText("Morgan");
    await expect(owner.getByRole("button", { name: "Hide a detail that was missed" })).toHaveCount(0);
    await owner.context().close();
  });
});
