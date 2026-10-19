// Text spacing (WCAG 2.2 SC 1.4.12, AA; Phase 7 T4.7): a reader who sets line height 1.5, paragraph spacing 2,
// letter spacing 0.12 and word spacing 0.16 (a style sheet, a bookmarklet, a reading extension) loses no text: none
// is cut off by a box that hides overflow, no line runs into another, nothing scrolls sideways. Every key screen of
// e2e/key-pages.ts (the reporter's and the staff's) at 1280 px, in Chromium and in WebKit (playwright.config.ts runs
// this spec in both projects). The check itself is textSpacingProblems() in e2e/a11y-checks.ts; the first test proves
// it catches the two classic failures.
import { test, expect } from "@playwright/test";
import { expectTextSpacing, textSpacingProblems } from "./a11y-checks";
import { KEY_SCREENS, visitKeyPages } from "./key-pages";

test("the text-spacing check finds text cut off by a fixed-height box and text that runs into the next line", async ({ page }) => {
  await page.goto("/help");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const own = () => page.evaluate(() => getComputedStyle(document.querySelector("main h1")!).letterSpacing);
  const before = await own();
  expect((await textSpacingProblems(page)).problems, "the real page").toEqual([]);
  await page.evaluate(() => {
    const main = document.querySelector("main")!;
    const clipped = document.createElement("div");
    clipped.setAttribute("style", "width: 12rem; height: 1.6rem; overflow: hidden; line-height: 1.2");
    clipped.textContent = "A label in a box of fixed height that hides the rest";
    const fixed = document.createElement("div");
    fixed.setAttribute("style", "width: 12rem; height: 1.6rem; line-height: 1.2");
    fixed.textContent = "Another label in a box of fixed height that lets it spill";
    const next = document.createElement("p");
    next.setAttribute("style", "margin: 0");
    next.textContent = "The words right under it";
    main.prepend(clipped, fixed, next);
  });
  const r = await textSpacingProblems(page);
  expect(r.problems.some((p) => p.startsWith("text cut off by div") && p.includes("A label in a box")), r.problems.join("\n")).toBe(true);
  expect(r.problems.some((p) => p.startsWith("text overlaps:") && p.includes("Another label") && p.includes("The words right under it")), r.problems.join("\n")).toBe(true);
  // The spacing is taken away again afterwards: the page's own styles are back.
  expect(await own()).toBe(before);
});

test("every key screen keeps all its text with WCAG 1.4.12 text spacing", async ({ browser, browserName }) => {
  test.setTimeout(420_000);
  const visited = await visitKeyPages(browser, { viewport: { width: 1280, height: 800 } }, async (page, screen) => {
    await expectTextSpacing(page, `${screen} (${browserName})`);
  });
  expect(visited).toEqual([...KEY_SCREENS]);
});
