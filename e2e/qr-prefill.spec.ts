// A location poster's link on the reporter's side (Phase 7 T4.5; docs/domain.md §4 and §4.1), in Chromium AND WebKit
// (playwright.config.ts REPORTER_SPECS): /o/{slug}/report?loc={id} fills in "Where did it happen?" and "Where
// exactly?" only where the person has not answered, says so, and can be changed; "Start over" keeps the poster's
// place; an id that is not a location in use of this org changes nothing and says nothing; the API's ?loc= gives the
// same place. The staff side (adding a location, its poster, editing, retiring) is e2e/locations.spec.ts.
// Specs share one database and locations are never deleted: every name here is unique to its run.
import { randomBytes } from "node:crypto";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers";
import { addLocation } from "./fixtures/locations";
import { gotoHydrated, reloadHydrated } from "./hydration";

const ORG = "maple-harbour";
const LAKEVIEW = "lakeview-telecom";

const hex = () => randomBytes(2).toString("hex");
/** A made-up client address (IPv6 documentation range), with its own /64: its own rate-limit bucket. */
const freshIp = () => `2001:db8:${hex()}:${hex()}::${hex()}`;

let counter = 0;
const stamp = () => `${Date.now().toString(36)}-${++counter}`;

async function reporterPage(browser: Browser): Promise<Page> {
  return (await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } })).newPage();
}

const where = (page: Page) => page.getByRole("group", { name: "Where did it happen?" });
const next = (page: Page) => page.getByRole("button", { name: "Next", exact: true });

/** Type step 1 and go to step 2. */
async function toStep2(page: Page, text: string) {
  await page.getByLabel("What got in your way?").fill(text);
  await next(page).click();
  await expect(page.getByRole("heading", { level: 2, name: "Where did it happen?" })).toBeFocused();
}

async function expectStep2Empty(page: Page, label: string) {
  for (const radio of await where(page).getByRole("radio").all()) await expect(radio, label).not.toBeChecked();
  await expect(page.getByLabel("Where exactly? (optional)"), label).toHaveValue("");
  await expect(where(page), label).not.toHaveAccessibleDescription(/poster/);
}

test("a poster's link fills in step 2, the person can change it, and Start over keeps the poster's place", async ({ browser }) => {
  const name = `Main entrance ${stamp()}`;
  const id = await addLocation(ORG, { name, kind: "place", detail: "the automatic door" });
  const page = await reporterPage(browser);
  await gotoHydrated(page, `/o/${ORG}/report?loc=${id}`);
  await expect(page.getByText(`You came from the poster for ${name}, so step 2 already says where it happened. You can change it.`)).toBeVisible();
  await toStep2(page, `The door button does nothing (prefill ${stamp()}).`);
  await expect(where(page).getByRole("radio", { name: "At a place" })).toBeChecked();
  await expect(where(page)).toHaveAccessibleDescription(`We filled this in from the poster for ${name}. You can change it.`);
  await expect(page.getByLabel("Where exactly? (optional)")).toHaveValue(`${name}, the automatic door`);
  await expectNoAxeViolations(page, "report step 2 (from a poster)");

  // Changed by the person: kept through a reload (the draft), not filled in again over it.
  await where(page).getByRole("radio", { name: "Somewhere else" }).check();
  await page.getByLabel("Where exactly? (optional)").fill("the way staff spoke to me");
  await page.waitForTimeout(500); // the autosave pause (300 ms)
  await reloadHydrated(page);
  await next(page).click();
  await expect(where(page).getByRole("radio", { name: "Somewhere else" })).toBeChecked();
  await expect(page.getByLabel("Where exactly? (optional)")).toHaveValue("the way staff spoke to me");

  // "Start over" clears the person's answers; the poster's place is filled in again (the link still names it).
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByText("We cleared your answers. This device doesn’t keep them any more.")).toBeVisible();
  await expect(page.getByLabel("What got in your way?")).toHaveValue("");
  await toStep2(page, `The door is heavy (start over ${stamp()}).`);
  await expect(where(page).getByRole("radio", { name: "At a place" })).toBeChecked();
  await expect(page.getByLabel("Where exactly? (optional)")).toHaveValue(`${name}, the automatic door`);
  await page.context().close();
});

test("an answer the person already gave (a kept draft) wins over a poster", async ({ browser }) => {
  const id = await addLocation(ORG, { name: `Drive-through ${stamp()}`, kind: "place", detail: null });
  const page = await reporterPage(browser);
  await gotoHydrated(page, `/o/${ORG}/report`);
  await toStep2(page, `The banking app times out (kept ${stamp()}).`);
  await where(page).getByRole("radio", { name: "On a website or app" }).check();
  await page.waitForTimeout(500);
  await gotoHydrated(page, `/o/${ORG}/report?loc=${id}`);
  await expect(page.getByRole("button", { name: "Start over" })).toBeVisible();
  // The poster's place was not used, so the form must not say it was (review finding, docs/decisions.md 2026-10-21).
  await expect(page.getByText(/You came from the poster/)).toHaveCount(0);
  await next(page).click();
  await expect(where(page).getByRole("radio", { name: "On a website or app" })).toBeChecked();
  await expect(page.getByLabel("Where exactly? (optional)")).toHaveValue("");
  await expect(where(page)).not.toHaveAccessibleDescription(/poster/);
  await page.context().close();
});

test("an id that is not a location in use of this org changes nothing and says nothing", async ({ browser }) => {
  const retired = await addLocation(ORG, { name: `Old branch ${stamp()}`, kind: "place", detail: null, active: false });
  const lakeview = await addLocation(LAKEVIEW, { name: `Lakeview store ${stamp()}`, kind: "place", detail: null });
  const page = await reporterPage(browser);
  const queries = [
    "loc=abc",
    `loc=${encodeURIComponent("' or '1'='1")}`,
    "loc=00000000-0000-4000-8000-000000000000", // no such location
    `loc=${retired}`, // retired
    `loc=${lakeview}`, // another org's
    `loc=${lakeview}&loc=${retired}`, // more than one
  ];
  for (const loc of queries) {
    const res = await gotoHydrated(page, `/o/${ORG}/report?${loc}`);
    expect(res?.status(), loc).toBe(200);
    await expect(page.getByText(/You came from the poster/), loc).toHaveCount(0);
    await toStep2(page, `The phone line hangs up (ignored ${stamp()}).`);
    await expectStep2Empty(page, loc);
    await page.evaluate(() => window.sessionStorage.clear()); // the next id starts from an empty form
  }
  await page.context().close();
});

test("the API's ?loc= gives the same place, and none for another org's slug", async ({ request }) => {
  const name = `Accessible ATM ${stamp()}`;
  const id = await addLocation(ORG, { name, kind: "place", detail: "Quay Street" });
  const headers = { "x-forwarded-for": freshIp() };
  const res = await request.get(`/api/v1/orgs/${ORG}?loc=${id}`, { headers });
  expect(res.status()).toBe(200);
  expect((await res.json()).place).toEqual({ name, locationKind: "place", locationDetail: `${name}, Quay Street` });
  expect((await (await request.get(`/api/v1/orgs/${LAKEVIEW}?loc=${id}`, { headers })).json()).place).toBeNull();
  expect((await (await request.get(`/api/v1/orgs/${ORG}`, { headers })).json()).place).toBeNull();
});
