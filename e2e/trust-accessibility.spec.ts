// /trust and /accessibility (handoff Phase 5 item 3; CLAUDE.md routes): axe in light AND dark, plus simulated
// forced colours, one h1, the one status region and the one "Get help"; reflow at 320 px; the links that lead here
// (every footer, /help); the contents links; the "About this copy" box under Playwright's forced fakes; and the
// feedback link into the demo organization's form (opened, never sent). Nothing here writes to the database.
import { test, expect, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers";

const PAGES = [
  { path: "/trust", h1: "How AccessLoop handles your report" },
  { path: "/accessibility", h1: "Accessibility of AccessLoop" },
] as const;

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
}

for (const scheme of ["light", "dark"] as const) {
  for (const { path, h1 } of PAGES) {
    test(`${path}: axe, ${scheme} theme`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(scheme === "dark");
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
      await expect(page.getByRole("status")).toHaveCount(1);
      await expect(page.getByRole("link", { name: "Get help" })).toHaveCount(1);
      await settle(page);
      await expectNoAxeViolations(page, `${path} (${scheme})`);
      await context.close();
    });
  }
}

for (const { path } of PAGES) {
  test(`${path}: forced colours, and no sideways scroll at 320px (WCAG 1.4.10)`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 800 } });
    const page = await context.newPage();
    await page.goto(path);
    await settle(page);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, `${path}: page width at 320px`).toBeLessThanOrEqual(320);
    await page.emulateMedia({ forcedColors: "active" });
    expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
    await settle(page);
    await expectNoAxeViolations(page, `${path} (forced colours, 320px)`);
    await context.close();
  });
}

// Links that stand on their own (not inside a sentence) are 44px tall (CLAUDE.md: 44x44 targets; inline text links
// are exempt): the contents, the source of the quoted law, the demo-form button, the footer's links and, on /trust,
// the list of the services' own pages we read (each link alone in its list item).
for (const { path } of PAGES) {
  test(`${path}: links that stand on their own are at least 44px tall`, async ({ page }) => {
    await page.goto(path);
    const links = [
      page.getByRole("navigation", { name: "On this page" }).getByRole("link"),
      page.getByRole("contentinfo").getByRole("link"),
      path === "/trust"
        ? page.getByRole("link", { name: "Accessible Canada Regulations, section 19" })
        : page.getByRole("link", { name: "Report a problem on the demo form" }),
    ];
    if (path === "/trust") {
      links.push(
        page.getByRole("link", {
          name: /^(Vercel: global network and regions|Supabase: available regions|Anthropic: data residency|Resend: choosing a region|Clerk: security)$/,
        }),
      );
    }
    for (const group of links) {
      const count = await group.count();
      expect(count, `${path}: links in the group`).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const box = await group.nth(i).boundingBox();
        expect(box?.height ?? 0, `${path}: "${await group.nth(i).innerText()}" height`).toBeGreaterThanOrEqual(44);
      }
    }
  });
}

test("every footer links both pages by the same names, and /help links them too", async ({ page }) => {
  for (const path of ["/", "/check", "/sign-in"]) {
    await page.goto(path);
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: "Privacy and AI", exact: true }), path).toHaveAttribute("href", "/trust");
    await expect(footer.getByRole("link", { name: "Accessibility", exact: true }), path).toHaveAttribute("href", "/accessibility");
  }

  await page.goto("/help");
  const main = page.getByRole("main");
  await main.getByRole("link", { name: "Privacy and AI", exact: true }).click();
  await expect(page).toHaveURL(/\/trust$/);
  await expect(page.getByRole("heading", { level: 1, name: "How AccessLoop handles your report" })).toBeFocused();

  await page.goto("/help");
  await main.getByRole("link", { name: "Accessibility", exact: true }).click();
  await expect(page).toHaveURL(/\/accessibility$/);
  await expect(page.getByRole("heading", { level: 1, name: "Accessibility of AccessLoop" })).toBeFocused();
});

test("/trust: the contents, the box about this copy, and the law quoted", async ({ page }) => {
  await page.goto("/trust");
  const contents = page.getByRole("navigation", { name: "On this page" });
  await expect(contents.getByRole("link")).toHaveCount(13);
  await contents.getByRole("link", { name: "Your receipt code" }).click();
  await expect(page).toHaveURL(/#receipt-code$/);
  await expect(page.getByRole("heading", { level: 2, name: "Your receipt code" })).toBeInViewport();

  // Playwright's server always forces FAKE_LLM=1 and FAKE_EMAIL=1 (playwright.config.ts).
  const box = page.locator(".al-notice").filter({ hasText: "About this copy of AccessLoop" });
  await expect(box).toContainText("The AI is simulated.");
  await expect(box).toContainText("Emails are not sent.");
  await expect(page.getByRole("main")).not.toContainText("This copy uses real AI");

  await expect(page.locator("blockquote")).toContainText(
    "A regulated entity must retain an electronic copy or print copy of any feedback it receives under section 9 for a period of seven years beginning on the day on which it is received.",
  );
  await expect(page.getByRole("link", { name: "Accessible Canada Regulations, section 19" })).toHaveAttribute(
    "href",
    "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2021-241/FullText.html",
  );

  // The planned services (docs/archive/phase7-prompt.md Wave 4 item 1): one table, labelled as planned, the five companies as
  // row headers; its scroll region is reachable by keyboard (Table's tabIndex 0) and named by the caption.
  const services = page.getByRole("region", { name: /^Planned when hosted/ });
  await expect(services).toHaveCount(1);
  await expect(services.getByRole("rowheader")).toHaveCount(5);
  for (const company of ["Vercel", "Supabase", "Anthropic", "Resend", "Clerk"]) {
    await expect(services.getByRole("rowheader", { name: new RegExp(`^${company}`) })).toHaveCount(1);
  }
  await expect(page.getByRole("main")).not.toContainText("We never store your IP address");

  await page.getByRole("main").getByRole("link", { name: "Tell us about a problem with AccessLoop" }).click();
  await expect(page).toHaveURL(/\/accessibility#tell-us$/);
});

test("/accessibility: the feedback link opens the demo organization's form (nothing is sent)", async ({ page }) => {
  await page.goto("/accessibility");
  await expect(page.getByRole("navigation", { name: "On this page" }).getByRole("link")).toHaveCount(7);
  await expect(page.locator("#tell-us")).toContainText("Maple Harbour Bank");
  await page.getByRole("link", { name: "Report a problem on the demo form" }).click();
  await expect(page).toHaveURL(/\/o\/maple-harbour\/report$/);
  await expect(page.getByRole("heading", { level: 1, name: /report a barrier/i })).toBeVisible();
});

// Review finding (docs/decisions.md 2026-10-21): two "Problems we know about" were fixed in Phase 7 but still showed,
// one of them telling reporters a reload brings the receipt code back (the cookie now lives 2 minutes and is cleared
// as soon as the receipt shows).
test("/accessibility: the known problems match the product (the code is shown once; the form lists other ways to reach the org)", async ({ page }) => {
  await page.goto("/accessibility");
  const known = page.locator("#known-problems");
  await expect(known).toContainText("The receipt page shows the code once.");
  await expect(known).not.toContainText("within 15 minutes");
  await expect(known).not.toContainText("does not show the organization");
});
