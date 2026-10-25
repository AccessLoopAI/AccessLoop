// The reporter side of the loop (docs/domain.md §3, §4, §9; Phase 2 Slice A): the re-test page /r/[code] with
// its five answers, /check, the autosaved draft, the "Don't use AI" path and the cross-org receipt check. Phase 7
// (T4.1-T4.4, T3.10): the other ways to reach the organization, French words marked lang="fr", the receipt shown
// once (its cookie cleared), its safeguards (print, a calendar reminder without the code, the code in two groups
// of eight, spelled out, copied without hyphens), and drafts kept in the tab unless the person asks otherwise.
// Every case is new: it is sent through the public form (that is the only way to get a receipt code), then moved
// to retest_open by e2e/fixtures/advance.ts, which uses only the frozen core (withOrg, appendCaseEvent,
// transition). Specs share one database and run in file order: never assume fixed counts or fresh rows.
import { randomBytes } from "node:crypto";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers";
import { orgId, ownerSql, withSql } from "./db";
import { advanceToRetest, closeCaseInThePast } from "./fixtures/advance";
import { gotoHydrated, hydrated, reloadHydrated } from "./hydration";

const ORG = "maple-harbour";
const LAKEVIEW = "lakeview-telecom";
const DRAFT_KEY = `accessloop:report-draft:${ORG}`;
const QUESTION = "Does it work for you now?";
const SENTENCE = {
  fixed: "Thank you. It's now marked as fixed and confirmed by you.",
  partly: "Thank you. We'll tell the team it only partly works, so they can keep working on it.",
  not_fixed: "Thank you. We'll tell the team it still needs work.",
  cant_check: "That's fine. We've marked it as fixed but not checked by you.",
  opt_out: "We won't contact you about this report again.",
};

/* ------------------------------------------------------------------ helpers */

interface Sent {
  code: string;
  ref: string;
}

let counter = 0;

/** Send a fresh report through the public form and read its receipt (code + reference). */
async function sendReport(browser: Browser, opts: { retest?: boolean; aiOptOut?: boolean } = {}): Promise<Sent> {
  const page = await (await browser.newContext()).newPage();
  await gotoHydrated(page, `/o/${ORG}/report`);
  await page
    .getByLabel("What got in your way?")
    .fill(`The automatic door button at the side entrance is broken again (reporter spec ${Date.now()}-${++counter}).`);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("group", { name: "Where did it happen?" }).getByRole("radio", { name: "At a place" }).check();
  await page.getByRole("button", { name: "Next" }).click();
  await page
    .getByRole("group", { name: "How can we follow up?" })
    .getByRole("radio", { name: opts.retest === false ? "Don't contact me" : "Let me check the fix with my code" })
    .check();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Check your report" })).toBeFocused({ timeout: 15_000 });
  // The AI choice is on the review (Phase 7 T4.2).
  if (opts.aiOptOut) await page.getByLabel("Don't use AI on my report").check();
  else await page.getByRole("radio", { name: "Yes, that's right" }).check();
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "We got your report" })).toBeFocused();
  const sent = {
    code: (await page.getByTestId("receipt-code").innerText()).trim(),
    ref: (await page.getByTestId("case-ref").innerText()).trim(),
  };
  await page.context().close();
  return sent;
}

/** A sent report, moved by the fixture to "Waiting for the reporter to check". */
async function retestCase(browser: Browser): Promise<Sent> {
  const sent = await sendReport(browser, { retest: true });
  await advanceToRetest(ORG, sent.ref);
  return sent;
}

let spare: Sent | null = null;
/** One quick report (no AI, no re-test) shared by the tests that only need a valid Maple Harbour code. */
async function spareCase(browser: Browser): Promise<Sent> {
  spare ??= await sendReport(browser, { retest: false, aiOptOut: true });
  return spare;
}

interface CaseFacts {
  status: string;
  wantsRetest: boolean;
  aiOptOut: boolean;
  needsManualRedaction: boolean;
  summary: string | null;
  summarySource: string | null;
  events: { type: string; actorKind: string; payload: Record<string, unknown> }[];
}

/** The case and its events, read as the owner inside the org's RLS context (e2e/db.ts). */
async function facts(ref: string): Promise<CaseFacts> {
  return withSql(ownerSql, async (sql) => {
    const id = await orgId(sql, ORG);
    return (await sql.begin(async (tx) => {
      await tx`select set_config('app.org_id', ${id}, true), set_config('app.role', 'system', true)`;
      const [c] = await tx<Omit<CaseFacts, "events">[]>`
        select status, wants_retest as "wantsRetest", ai_opt_out as "aiOptOut",
          needs_manual_redaction as "needsManualRedaction", summary, summary_source as "summarySource"
        from cases where org_id = ${id} and ref = ${ref}`;
      const events = await tx<CaseFacts["events"]>`
        select e.type, e.actor_kind as "actorKind", e.payload from case_events e
        join cases c on c.id = e.case_id where c.org_id = ${id} and c.ref = ${ref} order by e.seq`;
      return { ...c, events };
    })) as CaseFacts;
  });
}

/** A well-formed receipt code that (almost certainly) belongs to nobody. */
function unknownCode(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const chars = [...randomBytes(16)].map((b) => alphabet[b % 32]).join("");
  return chars.match(/.{4}/g)!.join("-");
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

async function openReport(browser: Browser, code: string, colorScheme: "light" | "dark" = "light") {
  const page = await (await browser.newContext({ colorScheme })).newPage();
  const res = await gotoHydrated(page, `/r/${code}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Your report" })).toBeVisible();
  return page;
}

async function answer(page: Page, label: string, comment?: string) {
  await page.getByRole("group", { name: QUESTION }).getByRole("radio", { name: label }).check();
  if (comment) await page.getByLabel("Anything you want to add? (optional)").fill(comment);
  await page.getByRole("button", { name: "Send answer" }).click();
}

/* ------------------------------------------------------------------ /r/[code] */

test.describe("the re-test page /r/[code]", () => {
  test("GET only renders; 'Yes, it works now' verifies the case, closes the loop and says so", async ({ browser, request }) => {
    const { code, ref } = await retestCase(browser);
    const before = await facts(ref);
    expect(before.status).toBe("retest_open");

    // Email link scanners prefetch links: a GET (any number, any letter case) changes nothing.
    for (const url of [`/r/${code}`, `/r/${code.toLowerCase()}`]) {
      const res = await request.get(url);
      expect(res.status(), url).toBe(200);
      expect(await res.text()).toContain("Your report");
    }
    const after = await facts(ref);
    expect(after.status).toBe("retest_open");
    expect(after.events.length).toBe(before.events.length);

    const page = await openReport(browser, code);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("status")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Get help" })).toHaveCount(1);
    await expect(page.getByTestId("report-status")).toHaveText("Please tell us if it works now");
    await expect(page.getByText("We offer a $25 gift card")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "What the team changed" })).toContainText("Replaced the door operator");
    const q = page.getByRole("group", { name: QUESTION });
    await expect(q.getByRole("radio")).toHaveCount(5);
    await expectNoAxeViolations(page, "re-test, open (light)");
    const dark = await openReport(browser, code, "dark");
    await expectNoAxeViolations(dark, "re-test, open (dark)");
    await dark.context().close();

    await answer(page, "Yes, it works now", "It opens now. Call me at 416-555-0142 if you need more.");
    await expect(page.getByRole("status")).toHaveText(SENTENCE.fixed);
    await expect(page.getByRole("heading", { level: 2, name: "Your answer is saved" })).toBeFocused();
    await expect(page.getByRole("region", { name: "Your answer is saved" })).toContainText(SENTENCE.fixed); // shown, not only said
    await expect(page.getByTestId("report-status")).toHaveText("Fixed and confirmed by you");
    await expect(page.getByText("The loop is closed. You confirmed the fix.")).toBeVisible();
    await expect(page.getByRole("group", { name: QUESTION })).toHaveCount(0); // answering twice is impossible
    await expect(page.getByText("We offer a $25 gift card")).toHaveCount(0);
    await settle(page);
    await expectNoAxeViolations(page, "re-test, just verified (light)");

    const done = await facts(ref);
    expect(done.status).toBe("verified");
    const verdicts = done.events.filter((e) => e.type === "retest_verdict");
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].actorKind).toBe("reporter");
    expect(verdicts[0].payload).toMatchObject({ verdict: "fixed", via: "receipt_code", round: 1, from: "retest_open", to: "verified" });
    // Free text is layer-1 redacted before it enters the log.
    expect(String(verdicts[0].payload.comment)).toContain("[PHONE]");
    expect(JSON.stringify(verdicts[0].payload)).not.toContain("416-555-0142");

    // A later visit shows the closed loop, without the one-time moment or the answer message.
    await reloadHydrated(page);
    await expect(page.getByTestId("report-status")).toHaveText("Fixed and confirmed by you");
    await expect(page.getByRole("heading", { name: "Your answer is saved" })).toHaveCount(0);
    await page.context().close();
    const verifiedDark = await openReport(browser, code, "dark");
    await expectNoAxeViolations(verifiedDark, "re-test, verified (dark)");
    await verifiedDark.context().close();
  });

  test("'Partly' sends it back to the team; the page then offers Stop contact, which keeps the status", async ({ browser }) => {
    const { code, ref } = await retestCase(browser);
    const page = await openReport(browser, code);
    await answer(page, "Partly");
    await expect(page.getByRole("status")).toHaveText(SENTENCE.partly);
    await expect(page.getByRole("heading", { level: 2, name: "Your answer is saved" })).toBeFocused();
    await expect(page.getByTestId("report-status")).toHaveText("Someone is working on a fix");
    expect((await facts(ref)).status).toBe("assigned");

    // Not in a re-test now: no question, but the reporter can still stop contact.
    await reloadHydrated(page);
    await expect(page.getByRole("group", { name: QUESTION })).toHaveCount(0);
    const stop = page.getByRole("button", { name: "Stop contact about this report" });
    await expect(stop).toBeVisible();
    await expectNoAxeViolations(page, "re-test page, not in a re-test (light)");
    const dark = await openReport(browser, code, "dark");
    await expectNoAxeViolations(dark, "re-test page, not in a re-test (dark)");
    await dark.context().close();

    await stop.click();
    await expect(page.getByRole("status")).toHaveText(SENTENCE.opt_out);
    await expect(page.getByRole("heading", { level: 2, name: "Your answer is saved" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Stop contact about this report" })).toHaveCount(0);
    const f = await facts(ref);
    expect(f.status).toBe("assigned"); // opt-out outside a re-test only records the wish
    expect(f.wantsRetest).toBe(false);
    expect(f.events.at(-1)).toMatchObject({ type: "opted_out", actorKind: "reporter" });
    await page.context().close();
  });

  test("'No, still a barrier' sends it back to the team (and nothing chosen asks first)", async ({ browser }) => {
    const { code, ref } = await retestCase(browser);
    const page = await openReport(browser, code);
    await page.getByLabel("Anything you want to add? (optional)").fill("The button still sticks.");
    await page.getByRole("button", { name: "Send answer" }).click();
    const summary = page.getByRole("heading", { level: 2, name: "There is a problem" });
    await expect(summary).toBeVisible();
    await expect(page.locator(":focus")).toContainText("Choose one answer.");
    await expect(page.getByLabel("Anything you want to add? (optional)")).toHaveValue("The button still sticks.");
    expect((await facts(ref)).status).toBe("retest_open");

    // A comment over 1,000 characters is refused, never cut short: nothing is saved and every word stays.
    const comment = page.getByLabel("Anything you want to add? (optional)");
    const long = "The button still sticks. ".repeat(42); // 1,050 characters
    await page.getByRole("group", { name: QUESTION }).getByRole("radio", { name: "No, still a barrier" }).check();
    await comment.fill(long);
    await page.getByRole("button", { name: "Send answer" }).click();
    await expect(page.locator(":focus")).toContainText("Keep your comment under 1,000 characters.");
    await expect(page.getByRole("status")).toHaveText("Keep your comment under 1,000 characters.");
    await expect(comment).toHaveValue(long);
    await expect(comment).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("group", { name: QUESTION }).getByRole("radio", { name: "No, still a barrier" })).toBeChecked();
    await axeBothThemes(page, "re-test, comment too long");
    expect((await facts(ref)).status).toBe("retest_open");

    await answer(page, "No, still a barrier", "The button still sticks.");
    await expect(page.getByRole("status")).toHaveText(SENTENCE.not_fixed);
    await expect(page.getByTestId("report-status")).toHaveText("Someone is working on a fix");
    const f = await facts(ref);
    expect(f.status).toBe("assigned");
    expect(f.events.filter((e) => e.type === "retest_verdict").at(-1)?.payload).toMatchObject({
      verdict: "not_fixed", via: "receipt_code", comment: "The button still sticks.",
    });
    await page.context().close();
  });

  test("'I can't check right now' marks it fixed but not checked", async ({ browser }) => {
    const { code, ref } = await retestCase(browser);
    const page = await openReport(browser, code);
    await answer(page, "I can't check right now");
    await expect(page.getByRole("status")).toHaveText(SENTENCE.cant_check);
    await expect(page.getByTestId("report-status")).toHaveText("Fixed (not checked by you)");
    const f = await facts(ref);
    expect(f.status).toBe("fixed_unverified");
    expect(f.events.filter((e) => e.type === "retest_verdict").at(-1)?.payload).toMatchObject({
      verdict: "cant_check", via: "receipt_code",
    });
    await page.context().close();
  });

  test("'Don't contact me about this again' stops the re-test and all contact", async ({ browser }) => {
    const { code, ref } = await retestCase(browser);
    const page = await openReport(browser, code);
    await answer(page, "Don't contact me about this again");
    await expect(page.getByRole("status")).toHaveText(SENTENCE.opt_out);
    await expect(page.getByTestId("report-status")).toHaveText("Fixed (not checked by you)");
    await expect(page.getByRole("button", { name: "Stop contact about this report" })).toHaveCount(0);
    const f = await facts(ref);
    expect(f.status).toBe("fixed_unverified");
    expect(f.wantsRetest).toBe(false);
    expect(f.events.at(-1)).toMatchObject({ type: "opted_out", actorKind: "reporter" });
    expect(f.events.filter((e) => e.type === "retest_verdict")).toHaveLength(0);
    await page.context().close();
  });

  test("a second, stale answer gets a calm 'already answered' and changes nothing", async ({ browser }) => {
    const { code, ref } = await retestCase(browser);
    const first = await openReport(browser, code);
    const second = await openReport(browser, code); // the same page left open in another tab
    await answer(first, "Yes, it works now");
    await expect(first.getByRole("status")).toHaveText(SENTENCE.fixed);

    await answer(second, "No, still a barrier");
    await expect(second.getByRole("heading", { level: 2, name: "This question is already answered" })).toBeFocused();
    await expect(second.getByRole("status")).toContainText("This question is already answered");
    await expect(second.getByTestId("report-status")).toHaveText("Fixed and confirmed by you");
    const f = await facts(ref);
    expect(f.status).toBe("verified");
    expect(f.events.filter((e) => e.type === "retest_verdict")).toHaveLength(1);
    await first.context().close();
    await second.context().close();
  });

  test("unknown, malformed and expired codes are a 404", async ({ browser, request }) => {
    for (const path of [`/r/${unknownCode()}`, "/r/not-a-code", "/r/ABCD-EFGH", `/r/${"Z".repeat(40)}`]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(404);
      expect(await res.text(), path).not.toContain("Where your report is now");
    }

    // Domain §4: a code works until the case is verified or closed, plus 30 days.
    const old = await sendReport(browser, { retest: false, aiOptOut: true });
    await closeCaseInThePast(ORG, old.ref, 31);
    const res = await request.get(`/r/${old.code}`);
    expect(res.status()).toBe(404);
    expect(await res.text()).not.toContain(old.ref);
  });
});

/* ------------------------------------------------------------------ /check */

test.describe("/check", () => {
  test("is clean in both themes, empty and with an error", async ({ browser }) => {
    for (const colorScheme of ["light", "dark"] as const) {
      const page = await (await browser.newContext({ colorScheme })).newPage();
      await gotoHydrated(page, "/check");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check your report");
      await expect(page.getByRole("status")).toHaveCount(1);
      await expectNoAxeViolations(page, `/check, empty (${colorScheme})`);
      await page.getByLabel("Your receipt code").fill("1234");
      await page.getByRole("button", { name: "Check", exact: true }).click();
      await expect(page.getByRole("heading", { level: 2, name: "There is a problem" })).toBeVisible();
      await expectNoAxeViolations(page, `/check, with an error (${colorScheme})`);
      await page.context().close();
    }
  });

  test("finds a report from a typed code, and refuses bad and unknown codes calmly", async ({ browser }) => {
    const { code } = await spareCase(browser);
    const page = await (await browser.newContext()).newPage();
    await gotoHydrated(page, "/check");
    const field = page.getByLabel("Your receipt code");
    const check = page.getByRole("button", { name: "Check", exact: true });
    await expect(field).toHaveAttribute("autocomplete", "off");
    await expect(field).toHaveAttribute("spellcheck", "false");

    // Malformed: the error summary takes focus, and the field says it too.
    await field.fill("ABCD-1234");
    await check.click();
    const formatError = "That code doesn't look right. It has 16 letters and numbers.";
    await expect(page.locator(":focus")).toContainText(formatError);
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveValue("ABCD-1234"); // what was typed stays, to fix in place
    await expect(page.getByRole("status")).toHaveText(formatError);

    // Unknown: one calm answer that doesn't say whether the code exists.
    await field.fill(unknownCode());
    await check.click();
    const unknown = "We couldn't find a report with that code. Check it and try again.";
    await expect(page.locator(":focus")).toContainText(unknown);
    await expect(page.getByRole("status")).toHaveText(unknown);

    // A real code, typed in lowercase with spaces instead of hyphens, lands on /r/{code}.
    await field.fill(`  ${code.toLowerCase().replace(/-/g, " ")} `);
    await check.click();
    await expect(page).toHaveURL(new RegExp(`/r/${code}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Your report" })).toBeFocused();
    await page.context().close();
  });

  test("an expired code gets the same calm 'couldn't find' answer", async ({ browser }) => {
    const old = await sendReport(browser, { retest: false, aiOptOut: true });
    await closeCaseInThePast(ORG, old.ref, 45);
    const page = await (await browser.newContext()).newPage();
    await gotoHydrated(page, "/check");
    await page.getByLabel("Your receipt code").fill(old.code);
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(page.locator(":focus")).toContainText("We couldn't find a report with that code.");
    await expect(page).toHaveURL(/\/check$/);
    await page.context().close();
  });
});

/* ------------------------------------------------------------------ the report form's draft, and the AI opt-out */

test("the report form keeps a draft in this tab, on this device only when asked; Start over and sending clear it", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const text = `The ramp at the side door is too steep for my chair (draft ${Date.now()}).`;
  // Phase 7 T3.10: this tab's sessionStorage by default; localStorage only with "Keep this draft on this device".
  const inTab = () => page.evaluate((k) => sessionStorage.getItem(k), DRAFT_KEY);
  const onDevice = () => page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY);
  const what = page.getByLabel("What got in your way?");
  const next = page.getByRole("button", { name: "Next" });
  const back = page.getByRole("button", { name: "Back" });
  const where = page.getByRole("group", { name: "Where did it happen?" });
  const followUp = page.getByRole("group", { name: "How can we follow up?" });
  const byEmail = followUp.getByRole("radio", { name: "Email me, and let me check the fix" });
  const keep = page.getByLabel("Keep this draft on this device");
  const keptInTab = page.getByText("We kept what you wrote in this tab.");
  const keptOnDevice = page.getByText("We kept what you wrote on this device.");

  await gotoHydrated(page, `/o/${ORG}/report`);
  await expect(keptInTab).toHaveCount(0);
  await expect(keptOnDevice).toHaveCount(0);
  await expect(keep).not.toBeChecked();
  await what.fill(text);
  await next.click();
  await where.getByRole("radio", { name: "At a place" }).check();
  await page.getByLabel("Where exactly? (optional)").fill("Side door on Elm Street");
  await next.click();
  await byEmail.check();
  await page.getByLabel("Email address").fill("draft.person@example.com");
  await expect.poll(inTab).toContain('"followUp":"email"');
  expect(await onDevice(), "nothing on the device unless the person asks").toBeNull();
  const saved = (await inTab()) ?? "";
  expect(saved).toContain("Side door on Elm Street");
  expect(saved).not.toContain("draft.person"); // never the email address
  expect(saved).not.toContain("example.com");

  // After a reload in the same tab: the answers are back, starting on step 1 (no auto-advance), with a calm note.
  await reloadHydrated(page);
  await expect(keptInTab).toBeVisible();
  await expect(page.getByText("Step 1 of 4", { exact: true })).toBeVisible();
  await expect(what).toHaveValue(text);
  await expectNoAxeViolations(page, "report form with a restored draft (light)");
  await page.emulateMedia({ colorScheme: "dark" });
  // The theme switch starts the controls' colour transitions (.al-transition): let them finish before axe reads
  // the colours, or it may measure a half-way colour.
  await settle(page);
  await expectNoAxeViolations(page, "report form with a restored draft (dark)");
  await page.emulateMedia({ colorScheme: "light" });
  await next.click();
  await expect(where.getByRole("radio", { name: "At a place" })).toBeChecked();
  await expect(page.getByLabel("Where exactly? (optional)")).toHaveValue("Side door on Elm Street");
  await next.click();
  await expect(byEmail).toBeChecked();
  await expect(page.getByLabel("Email address")).toHaveValue(""); // it was never kept

  // "Keep this draft on this device": the draft moves to localStorage (and out of the tab's storage). Another tab
  // of this browser then finds it, with the box ticked.
  await keep.check();
  await expect.poll(onDevice).toContain('"followUp":"email"');
  expect(await inTab()).toBeNull();
  const other = await page.context().newPage();
  await gotoHydrated(other, `/o/${ORG}/report`);
  await expect(other.getByText("We kept what you wrote on this device.")).toBeVisible();
  await expect(other.getByLabel("What got in your way?")).toHaveValue(text);
  await expect(other.getByLabel("Keep this draft on this device")).toBeChecked();
  await other.close();

  // Start over: an empty form on step 1, nothing kept in the tab or on the device.
  await back.click();
  await back.click();
  await expect(page.getByRole("button", { name: "Start over" })).toBeVisible();
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "What got in your way?" })).toBeFocused();
  await expect(what).toHaveValue("");
  await expect(keptInTab).toHaveCount(0);
  await expect(page.getByRole("main").getByText("We cleared your answers.")).toBeVisible(); // shown, not only said
  await expect(page.getByRole("status")).toHaveText("We cleared your answers. You can start again.");
  await expect.poll(onDevice).toBeNull();
  expect(await inTab()).toBeNull();
  await expect(keep).not.toBeChecked();
  await reloadHydrated(page);
  await expect(keptInTab).toHaveCount(0);
  await expect(keptOnDevice).toHaveCount(0);
  await expect(what).toHaveValue("");

  // Send a report without AI (chosen on the review): the draft is cleared once it is sent.
  await what.fill(text);
  await next.click();
  await where.getByRole("radio", { name: "At a place" }).check();
  await next.click();
  await followUp.getByRole("radio", { name: "Don't contact me" }).check();
  await next.click();
  await expect(page.getByRole("heading", { level: 2, name: "Check your report" })).toBeFocused({ timeout: 15_000 });
  await expect(page.getByRole("region", { name: "We understood" })).toBeVisible();
  await page.getByLabel("Don't use AI on my report").check();
  await expect(page.getByText("You asked us not to use AI. A staff member will read your words.")).toBeVisible();
  await expect(page.getByRole("region", { name: "We understood" })).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("We won't use AI on your report. A staff member will read your words.");
  await expect.poll(inTab).toContain('"aiOptOut":true');
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "We got your report" })).toBeFocused();
  const ref = (await page.getByTestId("case-ref").innerText()).trim();
  await expect.poll(inTab).toBeNull();
  expect(await onDevice()).toBeNull();
  await gotoHydrated(page, `/o/${ORG}/report`);
  await expect(keptInTab).toHaveCount(0);
  await expect(what).toHaveValue("");
  await page.context().close();

  // The "Don't use AI" path (domain §4-§6): the summary made for the review is not used, so no ai_structured event
  // and no summary, and a person checks for names by hand.
  const f = await facts(ref);
  expect(f.aiOptOut).toBe(true);
  expect(f.needsManualRedaction).toBe(true);
  expect(f.summary).toBeNull();
  expect(f.summarySource).toBe("reporter_words");
  expect(f.events.map((e) => e.type)).not.toContain("ai_structured");
  expect(f.events.map((e) => e.type)).toEqual(expect.arrayContaining(["submitted", "redaction_proposed", "ack_recorded"]));
});

test("words typed before the page's JavaScript has run are kept when it takes over (a slow phone or connection)", async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  // Hold the page's scripts back for a moment, so the person types into the server's HTML before React hydrates it.
  await context.route(/\/_next\/static\/chunks\/.+\.js(\?|$)/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });
  const page = await context.newPage();
  await page.goto(`/o/${ORG}/report`, { waitUntil: "domcontentloaded" });
  const text = `The side door button is broken again (typed early ${Date.now().toString(36)}).`;
  await page.getByLabel("What got in your way?").fill(text);
  await hydrated(page, "#report-text");
  await expect(page.getByLabel("What got in your way?")).toHaveValue(text);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Where did it happen?" })).toBeFocused();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("What got in your way?")).toHaveValue(text);
  await context.close(); // nothing is sent
});

test("the review: turning AI off and on again brings the summary back; French words are marked lang=\"fr\"", async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  const page = await context.newPage();
  await gotoHydrated(page, `/o/${ORG}/report`);
  // Phase 7 T4.3: French text is read with a French voice (WCAG 3.1.2).
  const french = `Le bouton de la porte automatique est brisé depuis trois semaines, je ne peux pas entrer (${Date.now().toString(36)}).`;
  await page.getByLabel("What got in your way?").fill(french);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("group", { name: "Where did it happen?" }).getByRole("radio", { name: "At a place" }).check();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("group", { name: "How can we follow up?" }).getByRole("radio", { name: "Don't contact me" }).check();
  // Wave 4 item 1: where the words go when AI is on, said before Next sends them (this copy: simulated, this computer).
  const where = "In this copy the AI is simulated with ready-made answers, so your words don't leave this computer.";
  await expect(page.getByText(where)).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Check your report" })).toBeFocused({ timeout: 15_000 });
  const words = page.getByRole("region", { name: "Your words" });
  await expect(words.locator('p[lang="fr"]')).toHaveText(french);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  const optOut = page.getByLabel("Don't use AI on my report");
  // ...and again next to the AI opt-out, read with it (its description), before what ticking it does.
  await expect(optOut).toHaveAccessibleDescription(/don't leave this computer\.\s*We delete the AI summary/);
  await optOut.check();
  await expect(page.getByRole("region", { name: "We understood" })).toHaveCount(0);
  await optOut.uncheck();
  await expect(page.getByRole("region", { name: "We understood" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("We will use the AI summary. Check it under We understood.");
  await expectNoAxeViolations(page, "review with AI turned off and on again");
  await context.close(); // nothing is sent
});

test("the review step reflows at 320px with a long email and a long unbroken place detail (WCAG 1.4.10)", async ({ browser }) => {
  // Its own made-up address, so step 3's summary never spends the 127.0.0.1 bucket the rest of the suite uses.
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  const page = await context.newPage();
  const email = "firstname.lastname@mapleharbour.ca"; // 34 characters, no break opportunity at 20px type
  const detail = "Building_C_Level_2_North_Wing_Room_214B"; // one 39-character token
  await gotoHydrated(page, `/o/${ORG}/report`);
  await page.getByLabel("What got in your way?").fill(`The ramp at the side door is too steep for my chair (reflow ${Date.now()}).`);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("group", { name: "Where did it happen?" }).getByRole("radio", { name: "At a place" }).check();
  await page.getByLabel("Where exactly? (optional)").fill(detail);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("group", { name: "How can we follow up?" }).getByRole("radio", { name: "Email me, and let me check the fix" }).check();
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Check your report" })).toBeFocused({ timeout: 15_000 });
  await expect(page.getByRole("main")).toContainText(email);
  await expect(page.getByRole("main")).toContainText(/How we follow up\s*Email me, and let me check the fix/);
  await expect(page.getByRole("region", { name: "Your words" })).toContainText(detail);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, "step 4 page width at 320px").toBeLessThanOrEqual(320);
  await expectNoAxeViolations(page, "review step with a long email at 320px");
  await context.close(); // nothing is sent
});

/* ------------------------------------------------------------------ the receipt (Phase 7 T4.4, T3.10) */

test("the receipt shows the code once, in two groups of eight and spelled out, with print, a reminder and a copy", async ({ browser, browserName }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  // Chromium reads the real clipboard back. WebKit has no clipboard permission to grant, so there the page's
  // navigator.clipboard.writeText is replaced by one that keeps what the button hands it.
  const realClipboard = browserName === "chromium";
  if (realClipboard) await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  else {
    await context.addInitScript(() => {
      const writeText = async (text: string) => {
        (window as unknown as { __copied?: string }).__copied = text;
      };
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    });
  }
  const page = await context.newPage();
  await gotoHydrated(page, `/o/${ORG}/report`);
  await page.getByLabel("What got in your way?").fill(`The side door button is broken again (receipt ${Date.now().toString(36)}).`);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("group", { name: "Where did it happen?" }).getByRole("radio", { name: "At a place" }).check();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("group", { name: "How can we follow up?" }).getByRole("radio", { name: "Let me check the fix with my code" }).check();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Check your report" })).toBeFocused({ timeout: 15_000 });
  await page.getByRole("radio", { name: "Yes, that's right" }).check();
  const sent = page.waitForResponse((r) => r.request().method() === "POST" && "next-action" in r.request().headers());
  const seen = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/o/${ORG}/receipt/seen`));
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "We got your report" })).toBeFocused();
  // "Send report" set the cookie that carries the code for 2 minutes only (lib/intake/receipt-cookie.ts).
  const setCookie = (await (await sent).headerValue("set-cookie")) ?? "";
  expect(setCookie).toMatch(/al_receipt=[0-9A-Z-]+;/);
  expect(setCookie).toMatch(/Max-Age=120/);
  expect(setCookie).toMatch(/HttpOnly/i);

  // The code: its text is exactly the code, drawn on two lines (two groups of eight), spelled out under it.
  const codeEl = page.getByTestId("receipt-code");
  const code = (await codeEl.innerText()).trim();
  expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  const lines = await codeEl.evaluate((el) => new Set([...el.getClientRects()].map((r) => Math.round(r.top))).size);
  expect(lines, "the code sits on two lines").toBe(2);
  await expect(page.getByText("Spelled out:")).toBeVisible();
  await expect(page.getByRole("main")).toContainText(/Spelled out:\s*\S.*;\s*then \S/);

  // Copy code: the 16 letters and numbers, without hyphens.
  await page.getByRole("button", { name: "Copy code" }).click();
  await expect(page.getByRole("main").getByText("Code copied.")).toBeVisible();
  const copied = realClipboard
    ? await page.evaluate(() => navigator.clipboard.readText())
    : await page.evaluate(() => (window as unknown as { __copied?: string }).__copied);
  expect(copied).toBe(code.replace(/-/g, ""));

  // The text file has the code; the calendar reminder links to /check and never holds the code.
  const decode = async (name: string, mime: string) => {
    const href = (await page.getByRole("link", { name }).getAttribute("href")) ?? "";
    expect(href.startsWith(`data:${mime};charset=utf-8,`), name).toBe(true);
    return decodeURIComponent(href.slice(href.indexOf(",") + 1));
  };
  expect(await decode("Download as a text file", "text/plain")).toContain(code);
  const ics = (await decode("Add a reminder to my calendar", "text/calendar")).replace(/\r\n /g, "");
  expect(ics).toContain("BEGIN:VEVENT");
  expect(ics).toMatch(/\/check\?org=maple-harbour/);
  for (const form of [code, code.replace(/-/g, ""), code.slice(0, 4)]) expect(ics).not.toContain(form);
  await expect(page.getByRole("link", { name: "Add a reminder to my calendar" })).toHaveAttribute("download", /\.ics$/);
  await expect(page.getByRole("button", { name: "Print receipt" })).toBeVisible();
  await expectNoAxeViolations(page, "receipt with its safeguards");

  // Shown once: the page cleared the cookie as soon as it was on screen, so a reload shows no code.
  expect((await seen).status()).toBe(204);
  await expect.poll(async () => (await context.cookies()).some((c) => c.name === "al_receipt")).toBe(false);
  await reloadHydrated(page);
  await expect(page.getByRole("heading", { level: 1, name: "Your receipt" })).toBeVisible();
  await expect(page.getByTestId("receipt-code")).toHaveCount(0);
  expect(await page.content()).not.toContain(code);
  await context.close();
});

test("only this site's own pages can clear the receipt cookie, and only for its path", async ({ browser, request }) => {
  const { code } = await spareCase(browser);
  const cross = await request.post(`/o/${ORG}/receipt/seen`, { headers: { "sec-fetch-site": "cross-site", cookie: `al_receipt=${code}` } });
  expect(cross.status()).toBe(403);
  const own = await request.post(`/o/${ORG}/receipt/seen`, { headers: { "sec-fetch-site": "same-origin" } });
  expect(own.status()).toBe(204);
  const setCookie = own.headers()["set-cookie"] ?? "";
  expect(setCookie).toMatch(/al_receipt=;/);
  expect(setCookie).toMatch(/Path=\/o\/maple-harbour\/receipt/);
  expect(setCookie).toMatch(/Max-Age=0/);
  expect((await request.post("/o/Not_A_Slug/receipt/seen")).status()).toBe(404);
});

/* ------------------------------------------------------------------ other ways to reach the organization (T4.1) */

test("the organization's other ways to give feedback are on the form, the receipt page, /r, /check and /help", async ({ browser }) => {
  const { code } = await spareCase(browser);
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  const page = await context.newPage();
  const otherWays = page.getByRole("button", { name: /^Other ways to reach / });

  /** The disclosure opens on the organization's phone, email and mail, and its feedback page. */
  async function openOtherWays(label: string) {
    await expect(otherWays, label).toHaveCount(1);
    await expect(otherWays, label).toHaveAttribute("aria-expanded", "false");
    await otherWays.click();
    await expect(otherWays, label).toHaveAttribute("aria-expanded", "true");
    const panel = page.locator(`#${await otherWays.getAttribute("aria-controls")}`);
    await expect(panel.locator('a[href^="tel:"]'), label).toHaveCount(1);
    await expect(panel.locator('a[href^="mailto:"]'), label).toHaveCount(1);
    await expect(panel.getByText(/Ask for the /), label).toBeVisible();
    await expect(panel.locator(`a[href="/p/${ORG}"]`), label).toHaveCount(1);
  }

  // The form (the disclosure sits under every step; here step 1), and its footer links the organization's own page.
  await gotoHydrated(page, `/o/${ORG}/report`);
  await openOtherWays("report form");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: /: accessibility feedback$/ })).toHaveAttribute("href", `/p/${ORG}`);
  await expect(footer.getByRole("link", { name: "Check your report", exact: true })).toHaveAttribute("href", `/check?org=${ORG}`);
  await expect(page.getByRole("link", { name: "Get help", exact: true })).toHaveAttribute("href", `/help?org=${ORG}`);
  await expectNoAxeViolations(page, "report form, other ways open");

  // /help from there: the section names the organization and gives its details.
  await page.getByRole("link", { name: "Get help", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/help\\?org=${ORG}$`));
  const helpSection = page.getByRole("heading", { level: 2, name: /^Other ways to reach (?!the organization)/ });
  await expect(helpSection).toBeVisible();
  await expect(page.getByRole("main").locator('a[href^="tel:"]')).toHaveCount(1);
  await expectNoAxeViolations(page, "help for one organization");

  // /check for that organization, and the receipt page without a code.
  await gotoHydrated(page, `/check?org=${ORG}`);
  await openOtherWays("/check");
  await expectNoAxeViolations(page, "/check for one organization, other ways open");
  await gotoHydrated(page, `/o/${ORG}/receipt`);
  await expect(page.getByRole("heading", { level: 1, name: "Your receipt" })).toBeVisible();
  await openOtherWays("receipt without a code");

  // The reporter's own page /r/{code}: last on the page, after the question.
  await gotoHydrated(page, `/r/${code}`);
  await openOtherWays("/r");
  await expect(page.getByRole("contentinfo").getByRole("link", { name: /: accessibility feedback$/ })).toHaveAttribute("href", `/p/${ORG}`);
  await expectNoAxeViolations(page, "/r with other ways open");

  // Without an organization, /check and /help stay general (an unknown slug is ignored).
  await gotoHydrated(page, "/check?org=no-such-org");
  await expect(otherWays).toHaveCount(0);
  await gotoHydrated(page, "/help");
  await expect(page.getByRole("heading", { level: 2, name: "Other ways to reach the organization" })).toBeVisible();
  // Step 3 has no answer chosen for the person (Phase 7 T4.2), so /help must not say anonymity is pre-chosen.
  const anonymous = page.getByRole("region", { name: "You can stay anonymous" });
  await expect(anonymous).toContainText("On the follow-up question, the first two answers keep you anonymous.");
  await expect(anonymous).not.toContainText("already chosen");
  await context.close();
});

/* ------------------------------------------------------------------ rate limits (CLAUDE.md security rules, domain §9) */

const CALM = "Too many tries from this connection. Please wait a few minutes and try again.";
const WINDOW_MS = 10 * 60_000; // lib/rate-limit.ts: fixed 10-minute windows aligned to the epoch

/** A made-up client address in 127/8 (loopback: local sign-in refuses others): its own rate-limit bucket, so no other test shares it. */
const freshIp = () => ((b: Buffer) => `127.${1 + (b[0] % 255)}.${b[1]}.${b[2]}`)(randomBytes(3));

/** Start well inside a window, so a count can't be reset by a new window halfway through a test. */
async function awayFromWindowEdge() {
  const left = WINDOW_MS - (Date.now() % WINDOW_MS);
  if (left < 30_000) await new Promise((resolve) => setTimeout(resolve, left + 1_000));
}

test.describe("over the limit", () => {
  test("/r/[code] shows a calm page and never looks the code up", async ({ browser, request }) => {
    const { code, ref } = await spareCase(browser);
    await awayFromWindowEdge();
    const headers = { "x-forwarded-for": freshIp() };
    const unknown = unknownCode();
    for (let i = 0; i < 240; i += 24) {
      const statuses = await Promise.all(
        Array.from({ length: 24 }, () => request.get(`/r/${unknown}`, { headers }).then((r) => r.status())),
      );
      expect(statuses.every((s) => s === 404)).toBe(true);
    }
    const res = await request.get(`/r/${code}`, { headers });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("Please wait a few minutes");
    expect(body).toContain(CALM);
    expect(body).not.toContain(ref);
    expect(body).not.toContain("Where your report is now");
    // Another address is not affected.
    expect(await (await request.get(`/r/${code}`, { headers: { "x-forwarded-for": freshIp() } })).text()).toContain(ref);
  });

  test("the receipt page shows a calm page instead of the code, and says it can be reloaded", async ({ browser, request, baseURL }) => {
    const { code, ref } = await spareCase(browser);
    await awayFromWindowEdge();
    const ip = freshIp();
    // A forged, well-formed cookie is looked up (no receipt for it), so it is counted.
    const forged = { "x-forwarded-for": ip, cookie: `al_receipt=${unknownCode()}` };
    for (let i = 0; i < 120; i += 24) {
      const texts = await Promise.all(
        Array.from({ length: 24 }, () => request.get(`/o/${ORG}/receipt`, { headers: forged }).then((r) => r.text())),
      );
      expect(texts.every((t) => t.includes("This page shows your code right after you send a report."))).toBe(true);
    }
    const host = new URL(baseURL ?? "http://localhost:3000").hostname;
    for (const colorScheme of ["light", "dark"] as const) {
      const context = await browser.newContext({ colorScheme, extraHTTPHeaders: { "x-forwarded-for": ip } });
      await context.addCookies([{ name: "al_receipt", value: code, domain: host, path: `/o/${ORG}/receipt` }]);
      const page = await context.newPage();
      await gotoHydrated(page, `/o/${ORG}/receipt`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Please wait a few minutes");
      await expect(page.getByRole("main")).toContainText(CALM);
      await expect(page.getByRole("main")).toContainText("Try reloading this page in a minute to see your receipt code.");
      await expect(page.getByTestId("receipt-code")).toHaveCount(0);
      expect(await page.content()).not.toContain(code);
      expect(await page.content()).not.toContain(ref);
      await expectNoAxeViolations(page, `receipt page, over the limit (${colorScheme})`);
      await context.close();
    }
  });

  test("/check says so calmly, on a notice that takes focus", async ({ browser }) => {
    const { code } = await spareCase(browser);
    await awayFromWindowEdge();
    const page = await (await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } })).newPage();
    await gotoHydrated(page, "/check");
    const field = page.getByLabel("Your receipt code");
    const check = page.getByRole("button", { name: "Check", exact: true });
    // Every try counts, even a code that doesn't look right (counted before anything else).
    for (let i = 0; i < 30; i++) {
      await field.fill("1234");
      await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), check.click()]);
      // fill() moved focus to the field; the new result moves it to the error summary (the UI has settled).
      await expect(page.locator(":focus")).toContainText("That code doesn't look right.");
      // ...and the form's action has finished, with React's reset of the form (WebKit gets there a little later):
      // typing before that would be put back to the last answer.
      await expect(check).not.toHaveAttribute("aria-disabled", "true");
    }
    await field.fill(code);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), check.click()]);
    await expect(page.locator(":focus")).toContainText(CALM);
    await expect(page.locator(":focus")).toContainText("We could not check your code");
    await expect(page.getByRole("status")).toHaveText(CALM);
    await expect(page).toHaveURL(/\/check$/);
    await expect(field).toHaveValue(code); // what was typed stays
    await axeBothThemes(page, "/check, over the limit");
    await page.context().close();
  });
});

/* ------------------------------------------------------------------ cross-org (domain §9, Phase 2) */

test("a Maple Harbour receipt code in the Lakeview receipt context is a 404", async ({ browser, request }) => {
  // /r/[code] has no org in its URL (the code alone resolves the org); the org-scoped receipt context is
  // /o/[orgSlug]/receipt, where another org's code must never show.
  const { code, ref } = await spareCase(browser);
  const cookie = { cookie: `al_receipt=${code}` };
  const own = await request.get(`/o/${ORG}/receipt`, { headers: cookie });
  expect(own.status()).toBe(200);
  expect(await own.text()).toContain(ref);

  const foreign = await request.get(`/o/${LAKEVIEW}/receipt`, { headers: cookie });
  expect(foreign.status()).toBe(404);
  const body = await foreign.text();
  expect(body).not.toContain(ref);
  expect(body).not.toContain(code);

  expect((await request.get(`/r/${code}`)).status()).toBe(200);
});
