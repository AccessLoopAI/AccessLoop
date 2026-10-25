// E2E-only (never imported by the app): wait until React has hydrated the page before a test presses anything.
// Until then the report form's steps are plain <form method="post"> elements, so a click on "Next" right after the
// load event would send a native POST and reload an empty form. Chromium hydrates within a few milliseconds of the
// load event; WebKit (the "webkit" project, Phase 7 T4.7) takes tens of milliseconds more, so a spec that runs in
// both waits for it. React 19 keeps its props on every hydrated host node, server-rendered ones included, so the
// page's <main> carries them once the page is live (e2e/keyboard.spec.ts checks a form field the same way).
import type { Page, Response } from "@playwright/test";

export async function hydrated(page: Page, selector = "main"): Promise<void> {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  }, selector);
}

/** page.goto, then wait for hydration. */
export async function gotoHydrated(page: Page, url: string): Promise<Response | null> {
  const res = await page.goto(url);
  await hydrated(page);
  return res;
}

/** page.reload, then wait for hydration. */
export async function reloadHydrated(page: Page): Promise<Response | null> {
  const res = await page.reload();
  await hydrated(page);
  return res;
}
