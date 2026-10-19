// The Content-Security-Policy baseline (next.config.ts, Phase 7 T3 item 6) fits every page: the full policy is sent
// as Content-Security-Policy-Report-Only, so a page that broke it would still work and only report it. This walks
// every key screen (e2e/key-pages.ts, the same walk as the reflow and forced-colors checks, through the whole report
// flow, a re-test, the staff pages, a draft and /verify) and fails on ANY report: a `securitypolicyviolation` event
// in the page or a CSP line in the console. Green here is the evidence that enforcing the baseline would break no
// page (docs/decisions.md 2026-10-20). The reports are kept as directive + blocked kind only (never a document URL:
// one could hold a receipt code).
import { test, expect } from "@playwright/test";
import { KEY_SCREENS, visitKeyPages } from "./key-pages";

test("no key screen breaks the Content-Security-Policy baseline", async ({ browser }) => {
  test.setTimeout(360_000);
  const reports: string[] = [];
  let armed = false;
  const visited = await visitKeyPages(browser, {}, async (page, screen) => {
    if (!armed) {
      // The first screen: listen from now on in this context, then load it again so it is checked too.
      armed = true;
      const context = page.context();
      await context.exposeBinding("__accessloopCspReport", (_source, report: string) => {
        reports.push(report);
      });
      await context.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (e) => {
          const blocked = /^https?:/.test(e.blockedURI) ? new URL(e.blockedURI).origin : e.blockedURI;
          const send = (window as unknown as { __accessloopCspReport?: (r: string) => void }).__accessloopCspReport;
          send?.(`${e.disposition} ${e.effectiveDirective} blocked ${blocked || "(inline)"}`);
        });
      });
      context.on("console", (m) => {
        if (/content.security.policy/i.test(m.text())) reports.push(`console ${m.type()}: ${m.text().slice(0, 200)}`);
      });
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    expect(reports, `CSP reports up to "${screen}"`).toEqual([]);
  });
  expect(visited).toEqual([...KEY_SCREENS]);
  expect(reports).toEqual([]);
});
