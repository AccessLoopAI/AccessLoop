// The staff side of the loop (docs/domain.md §2, §3, §5; Phase 2 Slice B): the redaction review (keep, remove and
// add spans, approve), the logged "Show original", triage, assign, the owner's fix with evidence, close and reopen,
// the History, My work, and axe (light AND dark) on the case page in every status as the lead, the assigned owner
// and the auditor. Every case is fresh: e2e/fixtures/cases.ts files it through the app's own intake code and moves
// it with the frozen core; the reporter's answers go through /r/[code] with the receipt code, as in real life.
// Specs share one database and run in file order: never assume fixed counts.
import { test, expect, type Browser, type Page } from "@playwright/test";
import { expectNoAxeViolations, signInAs, signOut } from "./helpers";
import { caseFacts, closeCase, fileReport, moveCase, type Filed } from "./fixtures/cases";

const ORG = "maple-harbour";
const LOCAL = process.env.AUTH_MODE === "local";
const LEAD = "Alex Rivera";
const OWNER = "Facilities team";
type Role = "lead" | "owner" | "auditor";

let counter = 0;
// Base 36, so the stamp is never a long digit run (layer 1 would hide it as an account number).
const stamp = () => `${Date.now().toString(36)}-${++counter}`;

/** The demo's barrier, with a name the fake flagPii knows and a phone number layer 1 catches. */
const DOOR_TEXT = () =>
  `Hi, my name is Daniel Okafor. The automatic door button at the King Street branch is broken again ` +
  `(staff spec ${stamp()}). Call me at 416-555-0142.`;

async function signInAsRole(page: Page, role: Role) {
  if (role === "lead") return signInAs(page, "E2E_LEAD_EMAIL");
  if (role === "owner") return signInAs(page, "E2E_OWNER_EMAIL");
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /^Sign in as Internal audit .*Maple Harbour/ }).click();
  await page.waitForURL(/\/app\//);
}

async function staffPage(browser: Browser, role: Role, colorScheme: "light" | "dark" = "light") {
  const page = await (await browser.newContext({ colorScheme })).newPage();
  await signInAsRole(page, role);
  return page;
}

async function openCase(page: Page, ref: string) {
  const res = await page.goto(`/app/cases/${ref}`);
  expect(res?.status(), ref).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${ref}`) })).toBeVisible();
}

/** Wait for every running CSS animation (the verified moment) to finish, so axe sees the final colours. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
}

/** axe in the light theme, then the dark theme, on the same page and state; back to light afterwards. */
async function axeBothThemes(page: Page, label: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await settle(page); // a theme switch starts colour transitions: let them finish before axe reads the colours
    await expectNoAxeViolations(page, `${label} (${colorScheme})`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await settle(page);
}

const region = (page: Page, name: string) => page.getByRole("region", { name });
const result = (page: Page) => page.getByTestId("case-action-result");

async function answerOnReceiptPage(browser: Browser, code: string, label: string, comment?: string) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/r/${code}`);
  await page.getByRole("group", { name: "Does it work for you now?" }).getByRole("radio", { name: label }).check();
  if (comment) await page.getByLabel("Anything you want to add? (optional)").fill(comment);
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Your answer is saved" })).toBeVisible();
  await page.context().close();
}

test.describe("the lead's redaction review, reveal, triage and assign", () => {
  test("remove one span, add one, see the original (logged), approve, triage and assign", async ({ browser }) => {
    const filed = await fileReport(ORG, { text: DOOR_TEXT(), wantsRetest: true });
    const page = await staffPage(browser, "lead");
    await openCase(page, filed.ref);
    await expect(page.getByTestId("case-status")).toHaveText("New");

    const review = region(page, "Redaction review");
    await expect(review).toContainText("[PERSON]");
    await expect(review).toContainText("[PHONE]");
    await expect(review).not.toContainText("Daniel Okafor");
    await expect(review).not.toContainText("416-555-0142");
    await expect(page.getByText("Acknowledged on screen")).toHaveCount(1);
    await expect(review.getByRole("checkbox", { name: /^Keep hidden/ })).toHaveCount(2);
    await expect(review.getByRole("listitem").first()).toContainText("Found by AI");
    await expect(review.getByRole("listitem").nth(1)).toContainText("Found by a pattern");

    // Words that are not in the report: a calm error on the field, and nothing changes.
    const words = review.getByLabel("Exact words to hide");
    await words.fill("Nowhere Lane");
    await review.getByLabel("Kind of detail").selectOption("STREET_ADDRESS");
    await review.getByRole("button", { name: "Hide these words" }).click();
    await expect(review.getByRole("heading", { name: "There is a problem" })).toBeVisible();
    await expect(page.locator(":focus")).toContainText("We couldn't find those exact words in the report.");
    await expect(words).toHaveValue("Nowhere Lane");

    // Add the street name: it is hidden everywhere it appears, and the region still never shows it.
    await words.fill("King Street");
    await review.getByRole("button", { name: "Hide these words" }).click();
    await expect(review).toContainText("at the [STREET_ADDRESS] branch");
    await expect(page.locator(":focus")).toContainText("Hidden in 1 place.");
    await expect(review).not.toContainText("King Street");
    await expect(review.getByRole("checkbox", { name: /^Keep hidden/ })).toHaveCount(3);
    await expect(review.getByRole("listitem").nth(2)).toContainText("Added by you");
    await expect(words).toHaveValue("");

    // Remove the phone span (say the reporter wants to be called back by staff who read the case).
    await review.getByRole("checkbox", { name: "Keep hidden (detail 2, phone)", exact: true }).uncheck();
    await expect(review).toContainText("2 of 3 details stay hidden");
    await axeBothThemes(page, "case: redaction review with changes");

    // "Show original" is the lead's (logged) way to read the words.
    await page.getByRole("button", { name: "Show original" }).click();
    const original = region(page, "Original report");
    await expect(original).toContainText("Daniel Okafor");
    await expect(original).toContainText("416-555-0142");
    await expect(page.getByRole("heading", { level: 2, name: "Original report" })).toBeFocused();
    await expect(region(page, "History")).toContainText(`Original viewed by ${LEAD}`);
    await axeBothThemes(page, "case: original shown");

    await page.getByRole("button", { name: "Approve redaction" }).click();
    await expect(result(page)).toContainText("Redaction approved. 2 details stay hidden. Next: triage the case.");
    await expect(result(page)).toBeFocused();
    await expect(region(page, "Redaction review")).toHaveCount(0);
    const report = region(page, "The report, with personal details removed");
    await expect(report).toContainText(`Redaction approved by ${LEAD}`);
    await expect(report).toContainText("my name is [PERSON].");
    await expect(report).toContainText("at the [STREET_ADDRESS] branch");
    await expect(report).toContainText("416-555-0142"); // the span the lead removed
    await expect(original).toContainText("Daniel Okafor"); // still open: it lives in the browser only

    const approved = await caseFacts(ORG, filed.ref);
    expect(approved.status).toBe("new");
    expect(approved.redactionApprovedAt).not.toBeNull();
    expect(approved.needsManualRedaction).toBe(false);
    expect(approved.redactedText).toContain("[STREET_ADDRESS]");
    expect(approved.redactedText).not.toContain("Daniel");
    const event = approved.events.find((e) => e.type === "redaction_approved")!;
    expect(event.actorKind).toBe("staff");
    expect(event.payload).toMatchObject({ kept: 1, removed: 1, added: 1 });
    expect((event.payload.spans as { type: string; source: string }[]).map((s) => [s.type, s.source]))
      .toEqual([["PERSON", "llm"], ["STREET_ADDRESS", "human"]]);
    const payloadText = JSON.stringify(event.payload);
    for (const value of ["Daniel", "Okafor", "King Street", "416"]) expect(payloadText).not.toContain(value);
    expect(approved.events.filter((e) => e.type === "private_revealed")).toHaveLength(1);

    // Triage: the AI's area is pre-selected; a public summary may never bring a hidden detail back.
    await expect(page.getByLabel("Priority area")).toHaveValue("built_environment");
    await page.getByLabel("Public summary").fill("Daniel Okafor could not open the door.");
    await page.getByRole("button", { name: "Save triage" }).click();
    await expect(page.locator(":focus")).toContainText("The public summary includes a detail that is hidden in the report.");
    await expect(page.getByTestId("case-status")).toHaveText("New");
    await page.getByLabel("Public summary").fill("The automatic door button at a branch entrance was broken.");
    await page.getByRole("button", { name: "Save triage" }).click();
    await expect(page.getByTestId("case-status")).toHaveText("Triaged");
    await expect(result(page)).toBeFocused();
    await expect(result(page)).toContainText("Triage saved. Status: Triaged.");
    await axeBothThemes(page, "case: triaged (after the form)");

    await page.getByLabel("Assign to").selectOption({ label: OWNER });
    await page.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByTestId("case-status")).toHaveText("Assigned");
    await expect(result(page)).toContainText(`Assigned to ${OWNER}. Status: Assigned.`);
    await expect(page.getByLabel("Assign to")).toHaveValue(/.+/); // reassigning uses the same "Assign" button

    const history = region(page, "History");
    for (const line of [
      "Report received on the web form",
      "Acknowledgement shown on screen",
      "Summary made by the simulated AI",
      "2 details hidden automatically (person, phone)",
      `Redaction approved by ${LEAD}`,
      "Kept 1 found automatically, removed 1, added 1 by hand.",
      `Original viewed by ${LEAD}`,
      "Triaged: The built environment",
      "Public summary: The automatic door button at a branch entrance was broken.",
      `Assigned to ${OWNER}`,
      "Status: Triaged",
    ]) {
      await expect(history, line).toContainText(line);
    }
    await expect(history).not.toContainText("Daniel");
    await expect(page.getByText("Acknowledged on screen")).toHaveCount(1);
    const after = await caseFacts(ORG, filed.ref);
    expect(after).toMatchObject({ status: "assigned", priorityArea: "built_environment", assignee: OWNER });

    // "Hide original" forgets the text and gives focus back to "Show original".
    await page.getByRole("button", { name: "Hide original" }).click();
    await expect(region(page, "Original report")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show original" })).toBeFocused();
    await expect(page.getByRole("main")).not.toContainText("Daniel Okafor");
    await signOut(page);
    await page.context().close();
  });

  test("words the lead hides are hidden in the place detail too", async ({ browser }) => {
    const filed = await fileReport(ORG, { text: DOOR_TEXT(), detail: "King Street branch, main entrance" });
    const page = await staffPage(browser, "lead");
    await openCase(page, filed.ref);
    const review = region(page, "Redaction review");
    await expect(review).toContainText("Where exactly");
    await review.getByLabel("Exact words to hide").fill("King Street");
    await review.getByLabel("Kind of detail").selectOption("STREET_ADDRESS");
    await review.getByRole("button", { name: "Hide these words" }).click();
    await expect(review).toContainText("[STREET_ADDRESS] branch, main entrance");
    await expect(review).toContainText("2 places");
    await page.getByRole("button", { name: "Approve redaction" }).click();
    await expect(result(page)).toContainText("Redaction approved.");
    await expect(region(page, "Case details")).toContainText("[STREET_ADDRESS] branch, main entrance");
    await page.context().close();
  });

  // Domain §6: the triage form shows "AI suggestion" with a confidence word and what the AI was unsure about, and a
  // guess below the eval's abstain threshold (0.5) is never pre-selected. The fake's door answer is 0.93; words it
  // has no answer for get its fallback (programs and services, 0.3, unsure about the area).
  test("the AI suggestion says how sure it is; a low-confidence guess is shown but not selected", async ({ browser }) => {
    const sure = await fileReport(ORG, { text: DOOR_TEXT() });
    await moveCase(ORG, sure.ref, "approved");
    const vague = await fileReport(ORG, { text: `It did not work for me again today (staff spec ${stamp()}).` });
    await moveCase(ORG, vague.ref, "approved");
    const page = await staffPage(browser, "lead");

    await openCase(page, sure.ref);
    const area = page.getByLabel("Priority area");
    await expect(area).toHaveValue("built_environment");
    await expect(area).toHaveAccessibleDescription(/AI suggestion:\s*The built environment \(high confidence\)\.\s*It is selected\./);
    await expect(region(page, "Case details")).toContainText("AI suggestion: The built environment (high confidence)");

    await openCase(page, vague.ref);
    await expect(area).toHaveValue("");
    await expect(area).toHaveAccessibleDescription(
      /AI suggestion:\s*The design and delivery of programs and services \(low confidence\)\.\s*It is not selected, because the AI was not sure\. Choose the area yourself\.\s*The AI was unsure about:\s*Which area fits/,
    );
    await expectNoAxeViolations(page, "case: triage with a low-confidence AI suggestion");
    // Nothing is chosen for the lead: saving without an area asks for one.
    await page.getByLabel("Public summary").fill("A service did not work for the person.");
    await page.getByRole("button", { name: "Save triage" }).click();
    await expect(page.locator(":focus")).toContainText("Choose the area this barrier belongs to.");
    await expect(page.getByTestId("case-status")).toHaveText("New");
    await page.context().close();
  });
});

test.describe("the original stays out of the back/forward cache; long tokens reflow at 320px", () => {
  test("a long email and file name never widen the case page; pagehide forgets the shown original", async ({ browser }) => {
    const email = "firstname.lastname@mapleharbour.ca";
    const file = "Annual_Accessibility_Plan_2026.pdf"; // one unbroken token that layer 1 leaves in place
    const filed = await fileReport(ORG, { text: `Email me at ${email} about ${file} (staff spec ${stamp()}).`, email, wantsRetest: true });
    const page = await staffPage(browser, "lead");
    await page.setViewportSize({ width: 320, height: 800 });
    const pageWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
    await openCase(page, filed.ref);
    const review = region(page, "Redaction review");
    await expect(review).toContainText(file);
    await expect(review).not.toContainText(email);
    expect(await pageWidth(), "redaction review at 320px").toBeLessThanOrEqual(320);

    await page.getByRole("button", { name: "Show original" }).click();
    const original = region(page, "Original report");
    await expect(original).toContainText(`Email me at ${email}`);
    await expect(original.getByText(email, { exact: true })).toBeVisible(); // the reporter's email row
    expect(await pageWidth(), "original shown at 320px").toBeLessThanOrEqual(320);

    // Leaving the page (pagehide, also when it goes into the back/forward cache): the decrypted text is dropped from
    // the DOM at once, so a snapshot never holds it and Back never shows it without a new private_revealed record.
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    await expect(region(page, "Original report")).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText(email);
    await expect(page.getByRole("button", { name: "Show original" })).toBeVisible();
    await page.context().close();
  });
});

test.describe("owners log fixes", () => {
  test("My work lists the assigned case; the owner logs a fix with evidence and never sees lead tools", async ({ browser }) => {
    const filed = await fileReport(ORG, { text: DOOR_TEXT(), wantsRetest: false });
    await moveCase(ORG, filed.ref, "assigned");
    const page = await staffPage(browser, "owner");
    await page.goto("/app/my-work");
    const table = page.getByRole("table", { name: "Cases assigned to you" });
    const row = table.getByRole("row").filter({ hasText: filed.ref });
    await expect(row).toHaveCount(1);
    await expect(row.locator("[data-status]")).toHaveText("Assigned");
    await expect(row).toContainText("The built environment");
    await expect(row).not.toContainText("Daniel");
    await row.getByRole("link", { name: filed.ref, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${filed.ref}`) })).toBeVisible();

    await expect(page.getByRole("button", { name: "Show original" })).toHaveCount(0);
    for (const name of ["Approve redaction", "Save triage", "Assign", "Close case", "Close without a fix", "Reopen case"]) {
      await expect(page.getByRole("button", { name }), name).toHaveCount(0);
    }
    // Log fix, and "Add a note" (Phase 7 T2 item 4: the owner it is assigned to can add notes).
    await expect(page.getByRole("main").locator("form")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Add note" })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("Daniel Okafor");
    await expect(page.getByRole("link", { name: "Back to my work" })).toBeVisible();

    const fix = page.getByLabel("What did you fix?");
    const evidence = page.getByLabel("Link to evidence (optional)");
    await fix.fill("Replaced the door operator motor and tested it 10 times with the button.");
    for (const [bad, message] of [
      ["javascript:alert(1)", "Enter a full link that starts with https:// or http://"],
      ["https://example.com/fix?ticket=1", "This link may carry personal details"],
    ] as const) {
      await evidence.fill(bad);
      await page.getByRole("button", { name: "Log fix" }).click();
      await expect(page.locator(":focus")).toContainText(message);
      await expect(page.getByTestId("case-status")).toHaveText("Assigned");
      await expect(fix).toHaveValue(/Replaced the door operator/); // nothing typed is lost
    }
    await axeBothThemes(page, "case: owner, evidence link error");
    await evidence.fill("https://example.com/fixes/door-motor.jpg");
    await page.getByRole("button", { name: "Log fix" }).click();
    // No re-test wanted: the fix is logged as fixed, not verified by the reporter.
    await expect(page.getByTestId("case-status")).toHaveText("Fixed, not verified by reporter");
    await expect(result(page)).toBeFocused();
    const history = region(page, "History");
    await expect(history).toContainText(`Fix logged by ${OWNER}`);
    await expect(history).toContainText("What they fixed: Replaced the door operator motor");
    await expect(history.getByRole("link", { name: /Evidence: https:\/\/example\.com\/fixes\/door-motor\.jpg/ })).toBeVisible();
    await expect(history).not.toContainText("Re-test requested");
    const facts = await caseFacts(ORG, filed.ref);
    expect(facts.status).toBe("fixed_unverified");
    expect(facts.events.find((e) => e.type === "fix_logged")?.payload).toMatchObject({
      evidenceUrl: "https://example.com/fixes/door-motor.jpg",
      retestRound: 0,
    });
    await page.context().close();
  });

  test("with a re-test wanted, the fix goes to the reporter; their answers come back into the History", async ({ browser }) => {
    const filed = await fileReport(ORG, { text: DOOR_TEXT(), wantsRetest: true });
    await moveCase(ORG, filed.ref, "assigned");
    const owner = await staffPage(browser, "owner");
    await openCase(owner, filed.ref);
    await owner.getByLabel("What did you fix?").fill("Replaced the door operator motor.");
    await owner.getByRole("button", { name: "Log fix" }).click();
    await expect(owner.getByTestId("case-status")).toHaveText("Waiting for the reporter to check");
    await expect(region(owner, "History")).toContainText("Re-test requested (round 1)");
    // Nothing to do while the reporter has the question but add a note (Phase 7 T2 item 4).
    await expect(owner.getByRole("main").locator("form")).toHaveCount(1);
    await expect(owner.getByRole("button", { name: "Add note" })).toBeVisible();

    await answerOnReceiptPage(browser, filed.code, "Partly", "The button still sticks.");
    await owner.reload();
    await expect(owner.getByTestId("case-status")).toHaveText("Assigned");
    const ownerHistory = region(owner, "History");
    await expect(ownerHistory).toContainText("The reporter answered: Partly (round 1)");
    await expect(ownerHistory).not.toContainText("The button still sticks."); // unreviewed reporter words: lead only
    await expect(ownerHistory).toContainText("Only the lead can read it");

    const lead = await staffPage(browser, "lead");
    await openCase(lead, filed.ref);
    await expect(region(lead, "History")).toContainText("Their comment: The button still sticks.");

    await owner.getByLabel("What did you fix?").fill("Adjusted the button's spring and tested it.");
    await owner.getByRole("button", { name: "Log fix" }).click();
    await expect(owner.getByTestId("case-status")).toHaveText("Waiting for the reporter to check");
    await expect(region(owner, "History")).toContainText("Re-test requested (round 2)");

    await answerOnReceiptPage(browser, filed.code, "Yes, it works now");
    // Signature moment 1, staff side: the first visit plays the closing loop once; later visits are calm.
    await openCase(lead, filed.ref);
    await expect(lead.getByTestId("case-status")).toHaveText("Verified by reporter");
    await expect(lead.getByTestId("case-status")).toHaveAttribute("data-celebrate", "true");
    await expect(lead.getByText("Loop closed: the reporter confirmed the fix.")).toBeVisible();
    await expect(region(lead, "History")).toContainText("The reporter answered: Yes, it works now (round 2)");
    await axeBothThemes(lead, "case: verified, the moment played");
    await lead.reload();
    await expect(lead.getByTestId("case-status")).toHaveText("Verified by reporter");
    await expect(lead.getByTestId("case-status")).not.toHaveAttribute("data-celebrate");
    await owner.context().close();
    await lead.context().close();
  });
});

test.describe("closing and reopening", () => {
  test("the lead closes a new case without approving it, and reopens then closes a fixed one", async ({ browser }) => {
    const spam = await fileReport(ORG, { text: `Buy cheap watches now (staff spec ${stamp()})`, aiOptOut: true });
    const page = await staffPage(browser, "lead");
    await openCase(page, spam.ref);
    await expect(region(page, "Redaction review")).toContainText("Check the redaction by hand");
    await page.getByRole("button", { name: "Close without a fix" }).click();
    await page.getByRole("button", { name: "Close case" }).click();
    await expect(page.locator(":focus")).toContainText("Choose why you are closing it.");
    await page.getByLabel("Reason for closing").selectOption({ label: "Not feedback about a barrier" });
    await page.getByLabel("Note (optional)").fill("An advert, not feedback.");
    await page.getByRole("button", { name: "Close case" }).click();
    await expect(page.getByTestId("case-status")).toHaveText("Closed");
    await expect(result(page)).toContainText("Case closed. Status: Closed.");
    await expect(region(page, "History")).toContainText("Closed: not feedback about a barrier");
    await expect(region(page, "History")).toContainText("Note: An advert, not feedback.");
    await expect(page.getByRole("button", { name: "Close case" })).toHaveCount(0);
    // Never approved, so the review stays (lead only): auditors still can't read it.
    await expect(region(page, "Redaction review")).toBeVisible();

    const fixed = await fileReport(ORG, { text: DOOR_TEXT(), wantsRetest: false });
    await moveCase(ORG, fixed.ref, "fixed");
    await openCase(page, fixed.ref);
    await expect(page.getByTestId("case-status")).toHaveText("Fixed, not verified by reporter");
    await page.getByRole("button", { name: "Reopen case" }).click();
    await expect(page.locator(":focus")).toContainText("Say why you are reopening it.");
    // The History is read by owners and auditors: a hidden name, in any letter case, never goes into it.
    await page.getByLabel("Why are you reopening it?").fill("DANIEL OKAFOR called: the door stopped again.");
    await page.getByRole("button", { name: "Reopen case" }).click();
    await expect(page.locator(":focus")).toContainText("The reason includes a detail that is hidden in the report.");
    await expect(page.getByTestId("case-status")).toHaveText("Fixed, not verified by reporter");
    await page.getByLabel("Why are you reopening it?").fill("The door stopped opening again a week later.");
    await page.getByRole("button", { name: "Reopen case" }).click();
    await expect(page.getByTestId("case-status")).toHaveText("Assigned");
    await expect(result(page)).toContainText("Case reopened. Status: Assigned.");
    await expect(region(page, "History")).toContainText(`Reopened by ${LEAD}`);
    await expect(region(page, "History")).toContainText("Why: The door stopped opening again a week later.");
    // The lead can log a fix too (their words are checked for hidden details: they have read the original), or close it.
    await page.getByLabel("What did you fix?").fill("Showed Daniel Okafor the new door opener.");
    await page.getByRole("button", { name: "Log fix" }).click();
    await expect(page.locator(":focus")).toContainText("The fix description includes a detail that is hidden in the report.");
    await expect(page.getByTestId("case-status")).toHaveText("Assigned");
    await page.getByRole("button", { name: "Close without a fix" }).click();
    await page.getByLabel("Reason for closing").selectOption("no_action_possible");
    await page.getByLabel("Note (optional)").fill("Told daniel okafor by phone.");
    await page.getByRole("button", { name: "Close case" }).click();
    await expect(page.locator(":focus")).toContainText("The note includes a detail that is hidden in the report.");
    await expect(page.getByTestId("case-status")).toHaveText("Assigned");
    await page.getByLabel("Note (optional)").fill("");
    await page.getByRole("button", { name: "Close case" }).click();
    await expect(page.getByTestId("case-status")).toHaveText("Closed");
    await expect(region(page, "History")).toContainText("Closed: no action possible");
    await expect(region(page, "History")).not.toContainText(/okafor/i);
    await page.context().close();
  });
});

test.describe("axe on the case page in every status, light and dark", () => {
  test.setTimeout(240_000);

  test("as the lead, the assigned owner and the auditor; and My work", async ({ browser }) => {
    test.skip(!LOCAL, "the auditor signs in through the local 'Sign in as' page");
    const make = (wantsRetest: boolean) =>
      fileReport(ORG, { text: `The automatic door button at the side entrance is broken (axe ${stamp()}). My name is Sam Example.`, wantsRetest });

    const pending = await make(true);
    const approved = await make(true);
    await moveCase(ORG, approved.ref, "approved");
    const triaged = await make(true);
    await moveCase(ORG, triaged.ref, "triaged");
    const assigned = await make(true);
    await moveCase(ORG, assigned.ref, "assigned");
    const retest = await make(true);
    await moveCase(ORG, retest.ref, "fixed");
    const verified = await make(true);
    await moveCase(ORG, verified.ref, "fixed");
    await answerOnReceiptPage(browser, verified.code, "Yes, it works now");
    const unchecked = await make(false);
    await moveCase(ORG, unchecked.ref, "fixed");
    const closed = await make(true);
    await moveCase(ORG, closed.ref, "assigned");
    await closeCase(ORG, closed.ref);

    const statuses: [string, Filed, string][] = [
      ["new, waiting for redaction review", pending, "New"],
      ["new, redaction approved", approved, "New"],
      ["triaged", triaged, "Triaged"],
      ["assigned", assigned, "Assigned"],
      ["waiting for the reporter", retest, "Waiting for the reporter to check"],
      ["verified", verified, "Verified by reporter"],
      ["fixed, not verified", unchecked, "Fixed, not verified by reporter"],
      ["closed", closed, "Closed"],
    ];
    // Facilities team is assigned from "assigned" on; before that the case is not theirs (404, never 403).
    const ownerSees = new Set(["assigned", "waiting for the reporter", "verified", "fixed, not verified", "closed"]);

    for (const role of ["lead", "owner", "auditor"] as const) {
      for (const scheme of ["light", "dark"] as const) {
        const page = await staffPage(browser, role, scheme);
        for (const [label, c, status] of statuses) {
          const name = `case: ${label} (${role}, ${scheme})`;
          if (role === "owner" && !ownerSees.has(label)) {
            const res = await page.goto(`/app/cases/${c.ref}`);
            expect(res?.status(), name).toBe(404);
            continue;
          }
          await openCase(page, c.ref);
          await expect(page.getByTestId("case-status"), name).toHaveText(status);
          await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
          await expect(page.getByRole("status")).toHaveCount(1);
          await expect(page.getByRole("link", { name: "Get help" })).toHaveCount(1);
          if (role !== "lead") await expect(page.getByRole("button", { name: "Show original" }), name).toHaveCount(0);
          if (role === "auditor") {
            await expect(page.getByRole("main").locator("form"), name).toHaveCount(0);
            await expect(page.getByRole("main").getByRole("button"), name).toHaveCount(0);
          }
          await settle(page);
          await expectNoAxeViolations(page, name);
        }
        if (role !== "auditor") {
          await page.goto("/app/my-work");
          await expect(page.getByRole("heading", { level: 1, name: "My work" })).toBeVisible();
          if (role === "owner") {
            await expect(page.getByRole("table", { name: "Cases assigned to you" }).getByRole("row").filter({ hasText: assigned.ref })).toHaveCount(1);
          }
          await expectNoAxeViolations(page, `my work (${role}, ${scheme})`);
        }
        await page.context().close();
      }
    }
  });
});
