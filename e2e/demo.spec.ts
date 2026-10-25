// THE acceptance test. "Done" for every phase = this file (or the part of it the phase covers) is green
// against the deployed Vercel preview URL with FAKE_LLM=1. It mirrors the 2-minute demo beat by beat.
// The accessible names used here ARE the UI contract: do not change them in the app without changing them here,
// and do not change them here just to make a test pass.
import { test, expect } from "@playwright/test";
import { expectNoAxeViolations, signInAs, signOut } from "./helpers";

const ORG = "maple-harbour";

// The live report. Swap the text for your tester's real barrier, but keep one name and one dictated number
// so the redaction beat still shows. lib/ai/fakes/*.json must contain matching entries.
const SCENARIO = {
  text:
    "Hi, my name is Daniel Okafor. The automatic door button at the King Street branch has been broken " +
    "for three weeks, so I can't get in with my wheelchair. Call me at four one six five five five zero one four two.",
  where: "At a place",
  whereDetail: "King Street branch, main entrance",
  name: "Daniel Okafor",
  ownerName: "Facilities team",
  areaLabel: "The built environment",
  publicSummary: "The automatic door button at a branch entrance was broken.",
  fix: "Replaced the door operator motor and tested it 10 times with the button.",
};

// Phase gates: DEMO_UNTIL_STEP=1 in Phase 1 (reporter flow + receipt), DEMO_UNTIL_STEP=4 in Phases 2-3.
// Unset = all 5 steps (Phase 4 onward). This is the ONLY sanctioned way to run part of this test.
const UNTIL = Number(process.env.DEMO_UNTIL_STEP ?? 5);

test.describe.configure({ mode: "serial" });

test("closes one barrier loop end to end and produces a cited, checked report", async ({ browser, request }) => {
  let receiptCode = "";
  let caseRef = "";

  // 0:15–0:45 — A reporter submits a barrier. No account, no CAPTCHA, anonymous by default.
  await test.step("reporter submits a barrier", async () => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`/o/${ORG}/report`);
    await expect(page.getByRole("heading", { level: 1, name: /report a barrier/i })).toBeVisible();
    await expectNoAxeViolations(page, "report: step 1");

    await page.getByLabel("What got in your way?").fill(SCENARIO.text);
    await page.getByRole("button", { name: "Next" }).click();

    await page.getByRole("group", { name: "Where did it happen?" })
      .getByRole("radio", { name: SCENARIO.where }).check();
    await page.getByLabel("Where exactly? (optional)").fill(SCENARIO.whereDetail);
    await expectNoAxeViolations(page, "report: step 2");
    await page.getByRole("button", { name: "Next" }).click();

    // Step 3 is one question (Phase 7, docs/decisions.md 2026-10-20): re-test with the code, still anonymous.
    await page.getByRole("group", { name: "How can we follow up?" })
      .getByRole("radio", { name: "Let me check the fix with my code" }).check();
    await expect(page.getByRole("group", { name: "How can we follow up?" })
      .getByRole("radio", { name: "Email me, and let me check the fix" })).not.toBeChecked();
    await expect(page.getByText("An AI tool helps summarize your report")).toBeVisible();
    await expectNoAxeViolations(page, "report: step 3");
    await page.getByRole("button", { name: "Next" }).click();

    // Review: focus moves to the heading; the reporter sees their own words next to the AI summary.
    const review = page.getByRole("heading", { level: 2, name: "Check your report" });
    await expect(review).toBeFocused({ timeout: 15_000 });
    await expect(page.getByRole("region", { name: "Your words" })).toContainText("door button");
    await expect(page.getByRole("region", { name: "We understood" })).not.toContainText(SCENARIO.name);
    await expectNoAxeViolations(page, "report: review");
    await page.getByRole("radio", { name: "Yes, that's right" }).check();
    await page.getByRole("button", { name: "Send report" }).click();

    // Receipt = the acknowledgement "in the same means" (ACR s.9(4)).
    await expect(page.getByRole("heading", { level: 1, name: "We got your report" })).toBeFocused();
    receiptCode = (await page.getByTestId("receipt-code").innerText()).trim();
    expect(receiptCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    caseRef = (await page.getByTestId("case-ref").innerText()).trim(); // non-secret reference, e.g. BAR-0017
    expect(caseRef).toMatch(/^BAR-\d{4}$/);
    await expect(page.getByRole("button", { name: "Copy code" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download as a text file" })).toBeVisible();
    await expectNoAxeViolations(page, "receipt");
    await page.context().close();
  });

  if (UNTIL < 2) return;
  // 0:45–1:05 — Staff view: redacted, acknowledged, original reveal is logged, triaged, assigned.
  await test.step("lead approves redaction, triages and assigns", async () => {
    const page = await (await browser.newContext()).newPage();
    await signInAs(page, "E2E_LEAD_EMAIL");
    await page.goto("/app/inbox");
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: caseRef });
    await expect(row).toContainText("New");
    await row.getByRole("link", { name: caseRef }).click();

    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${caseRef}`) })).toBeVisible();
    const redaction = page.getByRole("region", { name: "Redaction review" });
    await expect(redaction).not.toContainText(SCENARIO.name);
    await expect(redaction).toContainText("[PERSON]");
    await expect(redaction).toContainText("[PHONE]");
    await expect(page.getByText("Acknowledged on screen")).toBeVisible();
    await expectNoAxeViolations(page, "case: new");

    // Reveal is possible for the lead, and it is logged.
    await page.getByRole("button", { name: "Show original" }).click();
    await expect(page.getByRole("region", { name: "Original report" })).toContainText(SCENARIO.name);
    await expect(page.getByRole("region", { name: "History" })).toContainText("Original viewed by");

    await page.getByRole("button", { name: "Approve redaction" }).click();
    await expect(page.getByLabel("Priority area")).toHaveValue("built_environment"); // AI suggestion pre-selected
    await page.getByLabel("Public summary").fill(SCENARIO.publicSummary);
    await page.getByRole("button", { name: "Save triage" }).click();
    await expect(page.getByTestId("case-status")).toHaveText("Triaged");

    await page.getByLabel("Assign to").selectOption({ label: SCENARIO.ownerName });
    await page.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByTestId("case-status")).toHaveText("Assigned");
    await expectNoAxeViolations(page, "case: assigned");
    await signOut(page);
    await page.context().close();
  });

  if (UNTIL < 3) return;
  // 1:05–1:15 — The owner logs the fix with evidence. Owners never see the original.
  await test.step("owner logs the fix", async () => {
    const page = await (await browser.newContext()).newPage();
    await signInAs(page, "E2E_OWNER_EMAIL");
    await page.goto("/app/my-work");
    await page.getByRole("row").filter({ hasText: caseRef }).getByRole("link", { name: caseRef }).click();
    await expect(page.getByRole("button", { name: "Show original" })).toHaveCount(0);
    await page.getByLabel("What did you fix?").fill(SCENARIO.fix);
    await page.getByRole("button", { name: "Log fix" }).click();
    await expect(page.getByTestId("case-status")).toHaveText("Waiting for the reporter to check");
    await signOut(page);
    await page.context().close();
  });

  if (UNTIL < 4) return;
  // 1:15–1:25 — The reporter re-tests. GET never consumes the code (email scanners prefetch links).
  await test.step("reporter confirms the fix", async () => {
    const prefetch = await request.get(`/r/${receiptCode}`);
    expect(prefetch.status()).toBe(200);

    const page = await (await browser.newContext()).newPage();
    await page.goto(`/r/${receiptCode}`);
    await expect(page.getByRole("heading", { level: 1, name: "Your report" })).toBeVisible();
    await expect(page.getByText("We offer a $25 gift card")).toBeVisible();
    const q = page.getByRole("group", { name: "Does it work for you now?" });
    for (const name of ["Yes, it works now", "Partly", "No, still a barrier", "I can't check right now",
      "Don't contact me about this again"]) {
      await expect(q.getByRole("radio", { name })).toBeVisible();
    }
    await expectNoAxeViolations(page, "re-test");
    await q.getByRole("radio", { name: "Yes, it works now" }).check();
    await page.getByRole("button", { name: "Send answer" }).click();
    await expect(page.getByRole("status")).toContainText("fixed and confirmed by you");
    await page.context().close();
  });

  if (UNTIL < 5) return;
  // 1:25–1:50 — Generate the report: required headings checked, every sentence cited, chain verified.
  await test.step("lead generates a checked, cited progress report", async () => {
    const page = await (await browser.newContext()).newPage();
    await signInAs(page, "E2E_LEAD_EMAIL");
    await page.goto(`/app/cases/${caseRef}`);
    await expect(page.getByTestId("case-status")).toHaveText("Verified by reporter");

    await page.goto("/app/reports");
    await page.getByRole("link", { name: "New report" }).click();
    await page.getByLabel("Period start").fill("2026-01-01");
    await page.getByLabel("Period end").fill("2026-12-31");
    await page.getByRole("button", { name: "Generate draft" }).click();

    const checks = page.getByRole("region", { name: "Report checks" });
    await expect(checks).toContainText("All required checks pass", { timeout: 30_000 });
    for (const h of ["General", "Consultations", "Feedback", "The built environment"]) {
      await expect(page.getByRole("heading", { level: 2, name: h, exact: true })).toBeVisible();
    }
    const feedback = page.getByRole("region", { name: "Feedback" });
    await expect(feedback).toContainText("confirmed by the person who reported");
    await expect(feedback).not.toContainText(SCENARIO.name);

    const sources = feedback.getByRole("button", { name: /^Sources for this sentence \(\d+ records?\)$/ });
    expect(await sources.count()).toBeGreaterThan(2);
    await sources.first().click();
    await expect(feedback.getByRole("list", { name: "Sources" }).first()).toContainText(/BAR-\d{4}/);
    await expectNoAxeViolations(page, "report draft");

    await page.getByRole("link", { name: "Verify evidence chain" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Evidence check" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("All records match");
    // One table row per cited case (domain §8); the live case is among them.
    await expect(page.getByRole("table", { name: "Records" }).getByRole("row").filter({ hasText: caseRef })).toHaveCount(1);
    await page.context().close();
  });
});
