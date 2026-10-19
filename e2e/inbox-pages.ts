// E2E helper (no database): the inbox shows 50 cases to a page (Phase 7 T2 item 5), so a spec that compares "the
// cases the inbox lists" with lib/metrics walks every page with "Next page", as a person would.
import { expect, type Page } from "@playwright/test";

/** The references on the inbox page that is open now, in table order ([] when there is no table). */
export async function refsOnPage(page: Page): Promise<string[]> {
  const table = page.getByRole("table", { name: /^Cases received/ });
  if ((await table.count()) === 0) return [];
  return (await table.locator("tbody tr th a").allInnerTexts()).map((t) => t.trim());
}

/** Every reference the open inbox lists, on all its pages, in table order. Leaves the last page open. */
export async function allInboxRefs(page: Page): Promise<string[]> {
  const refs = await refsOnPage(page);
  for (let n = 2; ; n++) {
    const next = page.getByRole("link", { name: "Next page" });
    if ((await next.count()) === 0) return refs;
    await next.click();
    await expect(page.locator("#inbox-pages-title")).toContainText(`Page ${n} of`);
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeFocused();
    refs.push(...(await refsOnPage(page)));
  }
}
