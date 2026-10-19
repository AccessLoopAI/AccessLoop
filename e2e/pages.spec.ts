// Every Phase 1 page that e2e/demo.spec.ts does not already cover: axe (WCAG 2.0/2.1/2.2 A+AA) in light AND
// dark, plus the Phase 1 "done" sentence: a report sent through the public form shows in the lead's inbox as "New".
// Specs share one database and run in file order: never assume fixed counts (demo.spec adds cases every run).
import { test, expect, type Browser, type Page } from "@playwright/test";
import { expectNoAxeViolations, signInAs, signOut } from "./helpers";
import { casesOf, ownerSql, withSql } from "./db";

const ORG = "maple-harbour";
type Who = Parameters<typeof signInAs>[1];
type Scheme = "light" | "dark";

interface PageCheck {
  name: string;
  path: string | (() => Promise<string>);
  as?: Who;
  /** The page's one h1 (exact). */
  h1: string | RegExp;
  status?: number;
}

let seededRef: string | null = null;
async function aSeededRef(): Promise<string> {
  if (!seededRef) {
    const all = await withSql(ownerSql, (sql) => casesOf(sql, ORG));
    expect(all.length, "the seed gives Maple Harbour cases").toBeGreaterThan(0);
    seededRef = all[0].ref; // lowest seq: a seeded case, never one an e2e run just added
  }
  return seededRef;
}

const PAGES: PageCheck[] = [
  { name: "landing page", path: "/", h1: /./ },
  { name: "help", path: "/help", h1: /./ },
  { name: "sign-in", path: "/sign-in", h1: "Sign in" },
  { name: "dashboard (lead)", path: "/app/dashboard", as: "E2E_LEAD_EMAIL", h1: "Dashboard" },
  { name: "dashboard (Lakeview lead, a quieter org)", path: "/app/dashboard", as: "E2E_OTHER_LEAD_EMAIL", h1: "Dashboard" },
  { name: "inbox (lead)", path: "/app/inbox", as: "E2E_LEAD_EMAIL", h1: "Inbox" },
  { name: "inbox, empty (Lakeview lead)", path: "/app/inbox", as: "E2E_OTHER_LEAD_EMAIL", h1: "Inbox" },
  { name: "my work (owner)", path: "/app/my-work", as: "E2E_OWNER_EMAIL", h1: "My work" },
  { name: "case page (lead)", path: async () => `/app/cases/${await aSeededRef()}`, as: "E2E_LEAD_EMAIL", h1: /^BAR-\d{4}/ },
  { name: "design system (lead)", path: "/app/design", as: "E2E_LEAD_EMAIL", h1: /./ },
  { name: "receipt without a code", path: `/o/${ORG}/receipt`, h1: "Your receipt" },
  { name: "not found (public)", path: "/o/no-such-org/report", h1: /./, status: 404 },
  { name: "not found (staff, owner on the inbox)", path: "/app/inbox", as: "E2E_OWNER_EMAIL", h1: /./, status: 404 },
  // CLAUDE.md "Routes": owners are sent to /app/my-work from the dashboard (a redirect, so the page is My work).
  { name: "owner on the dashboard: sent to My work", path: "/app/dashboard", as: "E2E_OWNER_EMAIL", h1: "My work" },
];

/** axe in the light theme, then the dark theme, on the same page and state; back to light afterwards. */
async function axeBothThemes(page: Page, label: string) {
  const settle = () =>
    page.evaluate(async () => {
      await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
    });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await settle(); // a theme switch starts colour transitions: let them finish before axe reads the colours
    await expectNoAxeViolations(page, `${label} (${colorScheme})`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await settle();
}

async function open(browser: Browser, scheme: Scheme, check: PageCheck): Promise<Page> {
  const context = await browser.newContext({ colorScheme: scheme });
  const page = await context.newPage();
  if (check.as) await signInAs(page, check.as);
  const path = typeof check.path === "string" ? check.path : await check.path();
  const res = await page.goto(path);
  expect(res?.status(), `${check.name}: HTTP status`).toBe(check.status ?? 200);
  return page;
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe, ${scheme} theme`, () => {
    for (const check of PAGES) {
      test(check.name, async ({ browser }) => {
        const page = await open(browser, scheme, check);
        expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(scheme === "dark");
        const h1 = page.getByRole("heading", { level: 1 });
        await expect(h1).toHaveCount(1);
        await expect(h1).toHaveText(check.h1);
        await expect(page.getByRole("status")).toHaveCount(1); // the one live region, from the root layout
        await expect(page.getByRole("link", { name: "Get help" })).toHaveCount(1);
        await expectNoAxeViolations(page, `${check.name} (${scheme})`);
        await page.context().close();
      });
    }
  });
}

test("after signing in, focus is on the landing page's heading (a submit moves focus to the new heading)", async ({ browser }) => {
  test.skip(process.env.AUTH_MODE !== "local", "the local 'Sign in as' form is a server action that redirects");
  // Leads (and auditors) land on the dashboard from Phase 3 (domain §10); owners on My work.
  for (const [who, h1] of [["E2E_LEAD_EMAIL", "Dashboard"], ["E2E_OWNER_EMAIL", "My work"]] as const) {
    const page = await (await browser.newContext()).newPage();
    await signInAs(page, who);
    await expect(page.getByRole("heading", { level: 1, name: h1 }), who).toBeFocused();
    await page.context().close();
  }
});

test("a fixed case the reporter did not check shows its loop left open, with nothing in progress", async ({ browser }) => {
  const all = await withSql(ownerSql, (sql) => casesOf(sql, ORG));
  const unchecked = all.find((c) => c.status === "fixed_unverified");
  expect(unchecked, "the seed has fixed, unverified cases").toBeTruthy();
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, "E2E_LEAD_EMAIL");
  await page.goto(`/app/cases/${unchecked!.ref}`);
  await expect(page.getByTestId("case-status")).toHaveText("Fixed, not verified by reporter");
  const loop = page.getByRole("list").filter({ hasText: "Checked by reporter" });
  await expect(loop.locator('[aria-current="step"]')).toHaveCount(0);
  await expect(loop.getByRole("listitem").last()).toContainText("Not checked by the reporter");
  await expect(loop).not.toContainText("In progress");
  await page.context().close();
});

test("without JavaScript, the report page gives the organization's other ways to give feedback (ACR s.9(3))", async ({ request }) => {
  // The <noscript> block as the server sends it (Playwright's javaScriptEnabled: false still parses it as text).
  const res = await request.get(`/o/${ORG}/report`);
  expect(res.status()).toBe(200);
  const blocks = [...(await res.text()).matchAll(/<noscript>([\s\S]*?)<\/noscript>/g)].map((m) => m[1].replace(/<!-- -->/g, ""));
  const notice = blocks.find((b) => b.includes("This form needs JavaScript")) ?? "";
  expect(notice, "the no-JavaScript notice").not.toBe("");
  expect(notice).toMatch(/Ask for the [^<]+\./); // the designated person's title (ACR s.9(1))
  expect(notice).toMatch(/href="tel:\+?\d{7,}"/);
  expect(notice).toMatch(/href="mailto:[^"?&]+@[^"?&]+"/); // no query string
  expect(notice).toMatch(/<dt[^>]*>Mail<\/dt>\s*<dd[^>]*>[^<]{10,}<\/dd>/);
  expect(notice).not.toContain("Get help page explains");
});

test("Back, then Next keeps the review answer and the edited summary (WCAG 3.3.7)", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const review = page.getByRole("heading", { level: 2, name: "Check your report" });
  const next = page.getByRole("button", { name: "Next" });
  const back = page.getByRole("button", { name: "Back" });
  const changeIt = page.getByRole("radio", { name: "Change it" });
  const mine = "I can't pick a date on the booking page with my keyboard.";

  await page.goto(`/o/${ORG}/report`);
  await page.getByLabel("What got in your way?").fill("The date picker on the booking page does not work with my keyboard.");
  await next.click();
  await page.getByRole("group", { name: "Where did it happen?" }).getByRole("radio", { name: "On a website or app" }).check();
  await next.click();
  await page.getByRole("group", { name: "How can we follow up?" }).getByRole("radio", { name: "Don't contact me" }).check();
  await next.click();
  await expect(review).toBeFocused({ timeout: 15_000 });
  // Chosen with a click, "Change it" puts focus in the box it opens (Phase 7 T4.3).
  await changeIt.check();
  await expect(page.getByLabel("Your summary")).toBeFocused();
  await page.getByLabel("Your summary").fill(mine);

  // Nothing the summary depends on changed: the answer and the edit are still there.
  await back.click();
  await expect(page.getByRole("heading", { level: 2, name: "How can we follow up?" })).toBeFocused();
  await next.click();
  await expect(review).toBeFocused({ timeout: 15_000 });
  await expect(changeIt).toBeChecked();
  await expect(page.getByLabel("Your summary")).toHaveValue(mine);

  // A real change to the report makes a new summary, and the page says so.
  await back.click();
  await back.click();
  await back.click();
  await page.getByLabel("What got in your way?").fill("The date picker on the booking page skips my screen reader.");
  await next.click();
  await next.click();
  await next.click();
  await expect(review).toBeFocused({ timeout: 15_000 });
  await expect(page.getByText("You changed your report, so we wrote a new summary. Check it again.")).toBeVisible();
  await expect(changeIt).not.toBeChecked();
  await axeBothThemes(page, "report: review with a new summary");
  await page.context().close(); // nothing was sent
});

test("a report sent through the public form shows in the lead's inbox as New", async ({ browser }) => {
  const text =
    "Sam Example here. The date picker on the online booking page does not work with my keyboard, " +
    "so I could not book an appointment.";

  const reporter = await (await browser.newContext()).newPage();
  await reporter.goto(`/o/${ORG}/report`);
  await reporter.getByLabel("What got in your way?").fill(text);
  await reporter.getByRole("button", { name: "Next" }).click();
  await reporter.getByRole("group", { name: "Where did it happen?" }).getByRole("radio", { name: "On a website or app" }).check();
  await reporter.getByRole("button", { name: "Next" }).click();
  await reporter.getByRole("group", { name: "How can we follow up?" })
    .getByRole("radio", { name: "Don't contact me" }).check();
  await reporter.getByRole("button", { name: "Next" }).click();
  await expect(reporter.getByRole("heading", { level: 2, name: "Check your report" })).toBeFocused({ timeout: 15_000 });
  await expect(reporter.getByRole("region", { name: "We understood" })).toContainText("choose a date");
  await reporter.getByRole("radio", { name: "Keep my words only" }).check();
  await reporter.getByRole("button", { name: "Send report" }).click();
  await expect(reporter.getByRole("heading", { level: 1, name: "We got your report" })).toBeFocused();
  const caseRef = (await reporter.getByTestId("case-ref").innerText()).trim();
  expect(caseRef).toMatch(/^BAR-\d{4}$/);
  await reporter.context().close();

  const lead = await (await browser.newContext()).newPage();
  await signInAs(lead, "E2E_LEAD_EMAIL");
  await lead.goto("/app/inbox");
  const row = lead.getByRole("table", { name: "Cases received" }).getByRole("row").filter({ hasText: caseRef });
  await expect(row).toHaveCount(1);
  await expect(row.locator("[data-status]")).toHaveText("New"); // the row's StatusBadge, exactly the staff label
  // The reporter kept their own words: staff see them with the name removed.
  await expect(row).toContainText("[PERSON] here. The date picker");
  await expect(row).not.toContainText("Sam Example");
  await expect(row).toContainText("Website or app"); // the staff label of "On a website or app"

  // The case page opens from the inbox with the same status.
  await row.getByRole("link", { name: caseRef }).click();
  await expect(lead.getByRole("heading", { level: 1, name: new RegExp(`^${caseRef}`) })).toBeVisible();
  await expect(lead.getByTestId("case-status")).toHaveText("New");
  await signOut(lead);
  await expect(lead).toHaveURL(/\/sign-in$/);
  await lead.context().close();
});
