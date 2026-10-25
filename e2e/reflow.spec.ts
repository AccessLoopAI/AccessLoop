// Reflow (WCAG 1.4.10; CLAUDE.md "The layout reflows at 320 px and 400% zoom"): every key screen at 320 CSS px
// wide (what a 1280 px window shows at 400% zoom). The page itself never scrolls sideways
// (document.scrollingElement.scrollWidth <= 320), no visible element sticks out of the screen or is cut off, and
// only tables scroll sideways, inside their own labelled, focusable region (components/ui/Table.tsx). The checks
// are in e2e/a11y-checks.ts; the screens and their states in e2e/key-pages.ts. Light and dark both, because a
// theme can change borders and so widths.
import { test, expect } from "@playwright/test";
import { expectReflow } from "./a11y-checks";
import { KEY_SCREENS, visitKeyPages } from "./key-pages";

for (const colorScheme of ["light", "dark"] as const) {
  test(`every key screen reflows at 320 px (${colorScheme})`, async ({ browser }) => {
    test.setTimeout(360_000);
    const visited = await visitKeyPages(browser, { viewport: { width: 320, height: 800 }, colorScheme }, async (page, screen) => {
      const label = `${screen} (${colorScheme})`;
      await expect(page.getByRole("heading", { level: 1 }), label).toHaveCount(1);
      await expect(page.getByRole("link", { name: "Get help" }), label).toHaveCount(1);
      await expectReflow(page, label);
    });
    expect(visited).toEqual([...KEY_SCREENS]);
  });
}
