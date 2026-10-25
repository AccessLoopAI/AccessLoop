// One-round re-test links /r/t/{token} (Phase 7 T3 item 11; lib/retest-link.ts; docs/decisions.md 2026-10-20),
// against the production build. The test makes its own tokens with the same secret the server uses (lib/env.ts
// derives RETEST_LINK_SECRET from SESSION_SECRET in local mode; playwright.config.ts loads .env.local), exactly as a
// re-test email would carry them. It checks: the link opens that round's question and answers it (the verified
// moment), with no "Stop contact" form and no receipt code on the page; a made-up or altered token is a 404; an
// expired link and a link of an earlier round open a calm page that points to the receipt code; a page left open
// while a newer round started can't answer it. /r/{code} and /check are untouched (e2e/demo.spec.ts, reporter.spec).
// Cases come from the app's own intake code (e2e/fixtures/cases.ts); the reporter's answers are given on the pages.
import { randomBytes } from "node:crypto";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { cases, orgMembers, orgs } from "@/db/schema";
import { withOrg } from "@/db/tenant";
import { retestLinkSecret, signRetestLink } from "@/lib/retest-link";
import { transition } from "@/lib/state-machine";
import { expectReflow } from "./a11y-checks";
import { expectNoAxeViolations } from "./helpers";
import { caseFacts, fileReport, moveCase, type Filed } from "./fixtures/cases";

const ORG = "maple-harbour";
const QUESTION = "Does it work for you now?";
const DAY = 86_400_000;

/** A made-up client address in 127/8: its own rate-limit bucket, never the suite's 127.0.0.1. */
const freshIp = () => ((b: Buffer) => `127.${1 + (b[0] % 255)}.${b[1]}.${b[2]}`)(randomBytes(3));
let counter = 0;
const stamp = () => `${Date.now().toString(36)}-${++counter}`;

async function idsOf(ref: string): Promise<{ orgId: string; caseId: string }> {
  const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, ORG)).limit(1);
  const [c] = await withOrg({ orgId: org.id, role: "system" }, (tx) =>
    tx.select({ id: cases.id }).from(cases).where(and(eq(cases.orgId, org.id), eq(cases.ref, ref))).limit(1),
  );
  return { orgId: org.id, caseId: c.id };
}

/** The token a re-test email for this round would carry (30 days from now unless said otherwise). */
async function linkFor(ref: string, round: number, expiresAt = new Date(Date.now() + 30 * DAY)): Promise<string> {
  return signRetestLink({ ...(await idsOf(ref)), round, expiresAt }, retestLinkSecret());
}

/** A web report with an email, moved to "Waiting for the reporter to check" (round 1). */
async function waitingCase(): Promise<Filed> {
  const filed = await fileReport(ORG, {
    text: `The automatic door button at the side entrance is broken (re-test link ${stamp()}).`,
    wantsRetest: true,
    email: `link.${stamp()}@example.com`,
  });
  await moveCase(ORG, filed.ref, "fixed");
  return filed;
}

/** Staff log another fix (the owner, through the frozen state machine): the next round opens. */
async function logAnotherFix(ref: string) {
  const { orgId, caseId } = await idsOf(ref);
  await withOrg({ orgId, role: "system" }, async (tx) => {
    const [owner] = await tx.select().from(orgMembers).where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.displayName, "Facilities team")));
    await transition(tx, orgId, caseId, { kind: "log_fix", description: "Adjusted the door sensor again." }, { kind: "staff", memberId: owner.id, role: "owner" });
  });
}

async function reporterPage(browser: Browser): Promise<Page> {
  return (await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } })).newPage();
}

/** Every running transition or animation finished (a theme switch starts colour transitions). */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
}

/** Full-page pictures for humans (e2e/screenshots/, not committed), at 1440 and 390 px, light and dark. */
async function shoot(page: Page, name: string) {
  const size = page.viewportSize();
  for (const [label, width] of [["desktop", 1440], ["mobile", 390]] as const) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await settle(page);
      await page.screenshot({ path: `e2e/screenshots/${name}-${label}-${colorScheme}.png`, fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await settle(page);
  if (size) await page.setViewportSize(size);
}

/** axe in both themes on the same page and state. */
async function axeBothThemes(page: Page, label: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await settle(page);
    await expectNoAxeViolations(page, `${label} (${colorScheme})`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await settle(page);
}

test.describe("one-round re-test links (/r/t/{token})", () => {
  test("the link opens this round's question and answers it; then it shows where the report is", async ({ browser }) => {
    const filed = await waitingCase();
    const token = await linkFor(filed.ref, 1);
    const page = await reporterPage(browser);
    const res = await page.goto(`/r/t/${token}`);
    expect(res?.status()).toBe(200);
    expect(res?.headers()["referrer-policy"]).toBe("same-origin");
    await expect(page.getByRole("heading", { level: 1, name: "Your report" })).toBeVisible();
    await expect(page.getByTestId("report-status")).toHaveText("Please tell us if it works now");
    await expect(page.getByRole("main")).toContainText(filed.ref);
    await expect(page.getByRole("main")).not.toContainText(filed.code); // the link never shows the receipt code
    await expect(page.locator('input[name="code"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Stop contact about this report" })).toHaveCount(0);
    const question = page.getByRole("group", { name: QUESTION });
    await expect(question.getByRole("radio")).toHaveCount(5);
    await axeBothThemes(page, "re-test link: question");
    await shoot(page, "reporter-retest-link");

    // Nothing changed by opening it (GET only renders: email link scanners open links).
    expect((await caseFacts(ORG, filed.ref)).status).toBe("retest_open");

    await question.getByRole("radio", { name: "Yes, it works now" }).check();
    await page.getByRole("button", { name: "Send answer" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Your answer is saved" })).toBeFocused();
    await expect(page.getByRole("status")).toContainText("fixed and confirmed by you");
    await expect(page.getByTestId("report-status")).toHaveText("Fixed and confirmed by you");
    await axeBothThemes(page, "re-test link: answered");
    const facts = await caseFacts(ORG, filed.ref);
    expect(facts.status).toBe("verified");
    expect(facts.events.find((e) => e.type === "retest_verdict")).toMatchObject({ actorKind: "reporter", payload: { verdict: "fixed", round: 1 } });

    // Opened again: where the report is, and no question (the round is answered).
    await page.reload();
    await expect(page.getByTestId("report-status")).toHaveText("Fixed and confirmed by you");
    await expect(page.getByRole("group", { name: QUESTION })).toHaveCount(0);
    await page.setViewportSize({ width: 320, height: 800 });
    await expectReflow(page, "re-test link: verified");
    await page.context().close();
  });

  test("a made-up or altered token is a 404; an expired link explains itself and changes nothing", async ({ browser }) => {
    const filed = await waitingCase();
    const token = await linkFor(filed.ref, 1);
    const page = await reporterPage(browser);
    const flipped = `${token.slice(0, 10)}${token[10] === "A" ? "B" : "A"}${token.slice(11)}`;
    for (const bad of [flipped, "A".repeat(token.length), token.slice(0, -2), "not-a-token"]) {
      const res = await page.goto(`/r/t/${bad}`);
      expect(res?.status(), bad.slice(0, 12)).toBe(404);
      await expect(page.getByRole("group", { name: QUESTION })).toHaveCount(0);
    }

    const expired = await linkFor(filed.ref, 1, new Date(Date.now() - 60_000));
    const res = await page.goto(`/r/t/${expired}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "This link no longer works" })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("works for 30 days at most");
    await expect(page.getByRole("main")).not.toContainText(filed.ref); // an expired link says nothing about the report
    // Every page about one organization offers its other ways to reach it (domain §4, ACR s.9(3)): the link's org.
    await expect(page.getByRole("link", { name: "Check your report with your code" })).toHaveAttribute("href", `/check?org=${ORG}`);
    await expect(page.getByRole("button", { name: /^Other ways to reach / })).toBeVisible();
    await expect(page.getByRole("contentinfo").getByRole("link", { name: /: accessibility feedback$/ })).toHaveAttribute("href", `/p/${ORG}`);
    await axeBothThemes(page, "re-test link: expired");
    await shoot(page, "reporter-retest-link-ended");
    expect((await caseFacts(ORG, filed.ref)).status).toBe("retest_open");
    await page.context().close();
  });

  test("a link answers its own round only: after 'Partly' and a new fix, the round 1 link no longer answers", async ({ browser }) => {
    const filed = await waitingCase();
    const round1 = await linkFor(filed.ref, 1);
    const page = await reporterPage(browser);
    await page.goto(`/r/t/${round1}`);
    await page.getByRole("group", { name: QUESTION }).getByRole("radio", { name: "Partly" }).check();
    await page.getByRole("button", { name: "Send answer" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Your answer is saved" })).toBeFocused();
    await expect(page.getByTestId("report-status")).toHaveText("Someone is working on a fix");
    // In "assigned", the link page offers no "Stop contact" (that needs the code) and says a new link will come.
    await expect(page.getByRole("button", { name: "Stop contact about this report" })).toHaveCount(0);
    await expect(page.getByRole("main")).toContainText("we will email you a new link");

    // A page with round 1's question left open while round 2 starts can't answer round 2.
    const stale = await reporterPage(browser);
    const second = await waitingCase();
    const secondRound1 = await linkFor(second.ref, 1);
    await stale.goto(`/r/t/${secondRound1}`);
    await expect(stale.getByRole("group", { name: QUESTION })).toBeVisible();
    // Meanwhile the reporter answers round 1 with the receipt code, and the team logs another fix.
    const byCode = await reporterPage(browser);
    await byCode.goto(`/r/${second.code}`);
    await byCode.getByRole("group", { name: QUESTION }).getByRole("radio", { name: "No, still a barrier" }).check();
    await byCode.getByRole("button", { name: "Send answer" }).click();
    await expect(byCode.getByRole("heading", { level: 2, name: "Your answer is saved" })).toBeFocused();
    await byCode.context().close();
    await logAnotherFix(second.ref);
    expect((await caseFacts(ORG, second.ref)).status).toBe("retest_open");

    await stale.getByRole("group", { name: QUESTION }).getByRole("radio", { name: "Yes, it works now" }).check();
    await stale.getByRole("button", { name: "Send answer" }).click();
    await expect(stale.getByRole("heading", { level: 2, name: "This link no longer works" })).toBeFocused();
    await expect(stale.getByRole("status")).toContainText("works for one check only");
    let facts = await caseFacts(ORG, second.ref);
    expect(facts.status).toBe("retest_open"); // round 2 is still waiting for the reporter's own answer
    expect(facts.events.filter((e) => e.type === "retest_verdict")).toHaveLength(1);
    await stale.context().close();

    // Opened fresh, round 1's link says so; round 2's link opens round 2.
    await page.goto(`/r/t/${secondRound1}`);
    await expect(page.getByRole("heading", { level: 1, name: "This link no longer works" })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("This link was for an earlier check of the fix.");
    await expect(page.getByRole("button", { name: /^Other ways to reach / })).toBeVisible();
    await expect(page.getByRole("link", { name: "Check your report with your code" })).toHaveAttribute("href", `/check?org=${ORG}`);
    await axeBothThemes(page, "re-test link: earlier round");
    await page.goto(`/r/t/${await linkFor(second.ref, 2)}`);
    await page.getByRole("group", { name: QUESTION }).getByRole("radio", { name: "Yes, it works now" }).check();
    await page.getByRole("button", { name: "Send answer" }).click();
    await expect(page.getByTestId("report-status")).toHaveText("Fixed and confirmed by you");
    facts = await caseFacts(ORG, second.ref);
    expect(facts.status).toBe("verified");
    expect(facts.events.filter((e) => e.type === "retest_verdict").map((e) => e.payload.round)).toEqual([1, 2]);
    await page.context().close();
  });
});
