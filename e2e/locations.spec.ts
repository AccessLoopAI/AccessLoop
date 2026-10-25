// Locations and QR posters (Phase 7 T4.5; D8 org_locations, N1 qrcode; docs/domain.md §4 and §9): the lead adds a
// location at /app/settings/locations, prints its poster (a server-drawn QR code and the address printed under it, one
// page in print), and the poster's link opens the report form with "Where did it happen?" filled in; the person can
// change it, and what they send is what the case keeps. Editing and retiring a location, and the walls around it:
// lead only (owners and auditors 404), never another org's (its lead 404s, its form ignores the id). axe in light and
// dark on every new page and state. The reporter side's edge cases run in both browsers in e2e/qr-prefill.spec.ts.
// Specs share one database and locations are never deleted: every name here is unique to its run.
import { randomBytes } from "node:crypto";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { expectNoAxeViolations, signInAs } from "./helpers";
import { appSql, casesOf, withSql } from "./db";
import { expectReflow } from "./a11y-checks";
import { addLocation } from "./fixtures/locations";
import { gotoHydrated } from "./hydration";

const ORG = "maple-harbour";
const LAKEVIEW = "lakeview-telecom";
const LOCAL = process.env.AUTH_MODE === "local";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const hex = () => randomBytes(2).toString("hex");
/** A made-up client address (IPv6 documentation range), with its own /64: its own rate-limit bucket. */
const freshIp = () => `2001:db8:${hex()}:${hex()}::${hex()}`;

let counter = 0;
// Base 36, so the stamp is never a long digit run (layer 1 would hide it as an account number).
const stamp = () => `${Date.now().toString(36)}-${++counter}`;

/**
 * Fonts and transitions done, then back to the top: the staff header is sticky from 64rem, and a link scrolled under
 * it reads to axe as an "obscured" target (content under a sticky header, not a real overlap; focus is kept clear by
 * scroll-padding), as in reports.spec and dashboard.spec. Scrolling never moves focus.
 */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
    window.scrollTo(0, 0);
  });
}

/** axe in the light theme, then the dark theme, on the same page and state; back to light afterwards. */
async function axeBothThemes(page: Page, label: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await settle(page);
    await expectNoAxeViolations(page, `${label} (${colorScheme})`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** Reflow (WCAG 1.4.10) at 320 CSS px, then back to the page's own size. */
async function reflowAt320(page: Page, label: string) {
  const size = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 800 });
  await settle(page);
  await expectReflow(page, label);
  if (size) await page.setViewportSize(size);
}

async function leadPage(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, "E2E_LEAD_EMAIL");
  return page;
}

/** A reporter's own browser, from a fresh address. */
async function reporterPage(browser: Browser): Promise<Page> {
  return (await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } })).newPage();
}

const where = (page: Page) => page.getByRole("group", { name: "Where did it happen?" });

/** The poster's printed address, as a path on this server (the base URL is the configured public one). */
function pathOf(url: string): string {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
}

test("a lead adds a location, prints its poster, and its link opens the form with the place filled in", async ({ browser }) => {
  test.setTimeout(240_000);
  const lead = await leadPage(browser);
  const name = `Front door ${stamp()}`;

  // The list (reached from Settings) and the add form, first with nothing filled in.
  await lead.goto("/app/settings");
  await lead.getByRole("link", { name: "Locations and posters" }).click();
  await expect(lead.getByRole("heading", { level: 1, name: "Locations and posters" })).toBeVisible();
  await expect(lead.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  await axeBothThemes(lead, "locations");
  await lead.getByRole("button", { name: "Add location" }).click();
  const problem = lead.getByRole("heading", { name: "There is a problem" });
  await expect(problem).toBeVisible();
  await expect(lead.getByLabel("Name on the poster")).toHaveAttribute("aria-invalid", "true");
  await expect(lead.getByLabel("Answer the form starts with")).toHaveAttribute("aria-invalid", "true");
  await axeBothThemes(lead, "locations: add with errors");

  await lead.getByLabel("Name on the poster").fill(name);
  await lead.getByLabel("Answer the form starts with").selectOption({ label: "At a place" });
  await lead.getByLabel("More detail (optional)").fill("the ramp by the parking lot");
  await lead.getByRole("button", { name: "Add location" }).click();
  const result = lead.getByTestId("locations-result");
  await expect(result).toContainText(`Location added: ${name}. Its poster is ready to print from the list.`);
  await expect(result).toBeFocused();
  await expect(lead.getByLabel("Name on the poster")).toHaveValue(""); // the form is ready for the next one
  const row = lead.getByRole("table", { name: "Locations" }).getByRole("row").filter({ has: lead.getByRole("rowheader", { name: new RegExp(name) }) });
  await expect(row).toContainText("At a place");
  await expect(row).toContainText("In use");
  await axeBothThemes(lead, "locations: added");
  await reflowAt320(lead, "locations");

  // A second location of the same name in use is refused, in place.
  await lead.getByLabel("Name on the poster").fill(name.toUpperCase());
  await lead.getByLabel("Answer the form starts with").selectOption({ label: "At a place" });
  await lead.getByRole("button", { name: "Add location" }).click();
  await expect(lead.getByLabel("Name on the poster")).toHaveAttribute("aria-invalid", "true");
  await expect(problem).toBeVisible();
  await expect(lead.getByRole("rowheader", { name: new RegExp(name, "i") })).toHaveCount(1);

  // Its poster: the QR code (an image with a name) holds exactly the address printed under it.
  await row.getByRole("link", { name: `Poster for ${name}` }).click();
  await expect(lead).toHaveURL(new RegExp(`/app/settings/locations/${UUID}/poster$`));
  await expect(lead.getByRole("heading", { level: 1, name: `Poster for ${name}` })).toBeVisible();
  const poster = lead.getByTestId("poster");
  await expect(poster.getByRole("heading", { level: 2, name: "Did something here get in your way?" })).toBeVisible();
  await expect(poster).toContainText(name);
  await expect(poster).toContainText("the ramp by the parking lot");
  const qr = poster.getByRole("img", { name: new RegExp(`^QR code: opens .+'s report form for ${name}$`) });
  await expect(qr).toBeVisible();
  const url = (await poster.getByTestId("poster-url").textContent())!.trim();
  const locationId = new RegExp(`/app/settings/locations/(${UUID})/poster$`).exec(new URL(lead.url()).pathname)![1];
  expect(url).toMatch(new RegExp(`^https?://[^/]+/o/${ORG}/report\\?loc=${locationId}$`));
  await expect(qr).toHaveAttribute("data-qr-text", url);
  // Run on this computer, the code opens localhost: the lead is told phones can't open it (only on screen).
  if (/^https?:\/\/(localhost|127\.)/.test(url)) await expect(lead.getByText("Phones can't open this code yet")).toBeVisible();
  await axeBothThemes(lead, "poster");
  await reflowAt320(lead, "poster");

  // Printed: the poster alone (no header, page heading or buttons), on ONE page.
  await lead.emulateMedia({ media: "print" });
  await expect(lead.getByRole("banner")).toBeHidden();
  await expect(lead.getByRole("heading", { level: 1 })).toBeHidden();
  await expect(lead.getByRole("button", { name: "Print poster" })).toBeHidden();
  await expect(poster).toBeVisible();
  await expect(qr).toBeVisible();
  for (const format of ["Letter", "A4"] as const) {
    const pdf = (await lead.pdf({ format })).toString("latin1");
    expect(pdf.match(/\/Type\s*\/Page(?!s)/g)?.length, `poster pages on ${format}`).toBe(1);
  }
  await lead.emulateMedia({ media: "screen" });

  // The reporter follows the code: step 1 says where they came from, step 2 is filled in.
  const reporter = await reporterPage(browser);
  await gotoHydrated(reporter, pathOf(url));
  await expect(reporter.getByRole("heading", { level: 1, name: "Report a barrier" })).toBeVisible();
  await expect(reporter.getByText(`You came from the poster for ${name}, so step 2 already says where it happened. You can change it.`)).toBeVisible();
  await expectNoAxeViolations(reporter, "report step 1 (from a poster)");
  const text = `The ramp by the parking lot is too steep for my wheelchair (poster ${stamp()}).`;
  await reporter.getByLabel("What got in your way?").fill(text);
  await reporter.getByRole("button", { name: "Next", exact: true }).click();
  await expect(reporter.getByRole("heading", { level: 2, name: "Where did it happen?" })).toBeFocused();
  await expect(where(reporter).getByRole("radio", { name: "At a place" })).toBeChecked();
  await expect(where(reporter)).toHaveAccessibleDescription(`We filled this in from the poster for ${name}. You can change it.`);
  await expect(reporter.getByLabel("Where exactly? (optional)")).toHaveValue(`${name}, the ramp by the parking lot`);
  await expectNoAxeViolations(reporter, "report step 2 (from a poster)");

  // They keep it and send: the case says where, as the poster filled it in.
  await reporter.getByRole("button", { name: "Next", exact: true }).click();
  await reporter.getByRole("group", { name: "How can we follow up?" }).getByRole("radio", { name: "Don't contact me" }).check();
  await reporter.getByRole("button", { name: "Next", exact: true }).click();
  await expect(reporter.getByRole("heading", { level: 2, name: "Check your report" })).toBeFocused({ timeout: 15_000 });
  await expect(reporter.getByRole("region", { name: "Your words" })).toContainText(`At a place: ${name}, the ramp by the parking lot`);
  const summary = reporter.getByRole("radio", { name: "Keep my words only" });
  if (await summary.count()) await summary.check();
  await reporter.getByRole("button", { name: "Send report" }).click();
  await expect(reporter.getByRole("heading", { level: 1, name: "We got your report" })).toBeFocused({ timeout: 15_000 });
  const ref = (await reporter.getByTestId("case-ref").textContent())!.match(/BAR-\d{4}/)![0];
  const sent = await withSql(appSql, async (sql) => (await casesOf(sql, ORG)).find((c) => c.ref === ref));
  expect(sent?.locationDetail).toBe(`${name}, the ramp by the parking lot`);

  await reporter.context().close();
  await lead.context().close();
});

test("the reporter can change what the poster filled in, and the review shows their answer", async ({ browser }) => {
  const name = `Washrooms ${stamp()}`;
  const id = await addLocation(ORG, { name, kind: "place", detail: "2nd floor" });
  const reporter = await reporterPage(browser);
  await gotoHydrated(reporter, `/o/${ORG}/report?loc=${id}`);
  await reporter.getByLabel("What got in your way?").fill(`The sign on the door is too small to read (change ${stamp()}).`);
  await reporter.getByRole("button", { name: "Next", exact: true }).click();
  await expect(where(reporter).getByRole("radio", { name: "At a place" })).toBeChecked();
  await where(reporter).getByRole("radio", { name: "In a document" }).check();
  await reporter.getByLabel("Where exactly? (optional)").fill("The visitor form");
  await reporter.getByRole("button", { name: "Next", exact: true }).click();
  await reporter.getByRole("group", { name: "How can we follow up?" }).getByRole("radio", { name: "Don't contact me" }).check();
  await reporter.getByRole("button", { name: "Next", exact: true }).click();
  await expect(reporter.getByRole("heading", { level: 2, name: "Check your report" })).toBeFocused({ timeout: 15_000 });
  await expect(reporter.getByRole("region", { name: "Your words" })).toContainText("In a document: The visitor form");
  await expect(reporter.getByRole("region", { name: "Your words" })).not.toContainText(name);
  // Back on step 2, their own answer is still there (the poster never fills in over it).
  await reporter.getByRole("button", { name: "Back" }).click();
  await reporter.getByRole("button", { name: "Back" }).click();
  await expect(where(reporter).getByRole("radio", { name: "In a document" })).toBeChecked();
  await expect(reporter.getByLabel("Where exactly? (optional)")).toHaveValue("The visitor form");
  await reporter.context().close();
});

test("editing and retiring a location: its posters then open the form without the place", async ({ browser }) => {
  const name = `Service counter ${stamp()}`;
  const id = await addLocation(ORG, { name, kind: "phone_or_service", detail: null });
  const lead = await leadPage(browser);
  await lead.goto("/app/settings/locations");
  await lead.getByRole("link", { name: `Edit ${name}` }).click();
  await expect(lead).toHaveURL(new RegExp(`/app/settings/locations/${id}$`));
  await expect(lead.getByRole("heading", { level: 1, name: `Edit ${name}` })).toBeVisible();
  await expect(lead.getByLabel("Name on the poster")).toHaveValue(name);
  await expect(lead.getByLabel("Answer the form starts with")).toHaveValue("phone_or_service");
  await expect(lead.getByRole("group", { name: "Is this location in use?" }).getByRole("radio", { name: "In use" })).toBeChecked();
  await expect(lead.getByRole("region", { name: "What the form fills in" })).toContainText(name);
  await axeBothThemes(lead, "edit location");

  // An empty name is refused in place; nothing changes.
  await lead.getByLabel("Name on the poster").fill("");
  await lead.getByRole("button", { name: "Save location" }).click();
  await expect(lead.getByLabel("Name on the poster")).toHaveAttribute("aria-invalid", "true");
  await axeBothThemes(lead, "edit location with errors");

  const renamed = `${name} (main floor)`;
  await lead.getByLabel("Name on the poster").fill(renamed);
  await lead.getByLabel("More detail (optional)").fill("by the elevators");
  await lead.getByRole("button", { name: "Save location" }).click();
  const result = lead.getByTestId("locations-result");
  await expect(result).toContainText(`Location saved: ${renamed}. Its posters fill in the new details from now on.`);
  await expect(result).toBeFocused();
  await expect(lead.getByRole("region", { name: "What the form fills in" })).toContainText(`${renamed}, by the elevators`);

  // The same printed code now fills in the new name.
  const reporter = await reporterPage(browser);
  await gotoHydrated(reporter, `/o/${ORG}/report?loc=${id}`);
  await reporter.getByLabel("What got in your way?").fill(`Nobody could help me in sign language (renamed ${stamp()}).`);
  await reporter.getByRole("button", { name: "Next", exact: true }).click();
  await expect(where(reporter).getByRole("radio", { name: "On the phone or at a service" })).toBeChecked();
  await expect(reporter.getByLabel("Where exactly? (optional)")).toHaveValue(`${renamed}, by the elevators`);

  // Retired: the poster page says so, the list marks it, and the code opens an empty form.
  await lead.getByRole("group", { name: "Is this location in use?" }).getByRole("radio", { name: "Retired" }).check();
  await lead.getByRole("button", { name: "Save location" }).click();
  await expect(result).toContainText(`Location saved and retired: ${renamed}. Its posters now open the form without the place filled in.`);
  await lead.getByRole("link", { name: "Open its poster" }).click();
  await expect(lead.getByText("This location is retired")).toBeVisible();
  await axeBothThemes(lead, "poster (retired)");
  await lead.goto("/app/settings/locations");
  await expect(lead.getByRole("row").filter({ has: lead.getByRole("rowheader", { name: new RegExp(renamed.replace(/[()]/g, "\\$&")) }) })).toContainText("Retired");

  // (A new visitor: the first one's tab keeps their own answers as a draft, which the form rightly brings back.)
  await reporter.context().close();
  const next = await reporterPage(browser);
  await gotoHydrated(next, `/o/${ORG}/report?loc=${id}`);
  await expect(next.getByText(/You came from the poster/)).toHaveCount(0);
  await next.getByLabel("What got in your way?").fill(`The counter is too high (retired ${stamp()}).`);
  await next.getByRole("button", { name: "Next", exact: true }).click();
  for (const radio of await where(next).getByRole("radio").all()) await expect(radio).not.toBeChecked();
  await expect(next.getByLabel("Where exactly? (optional)")).toHaveValue("");
  await next.context().close();
  await lead.context().close();
});

test("a location stays inside its org: other roles and other orgs get 404, and another org's form ignores it", async ({ browser }) => {
  test.skip(!LOCAL, "switches sessions through the local 'Sign in as' page");
  const name = `Elevator ${stamp()}`;
  const id = await addLocation(ORG, { name, kind: "place", detail: "lobby" });
  const pages = [`/app/settings/locations`, `/app/settings/locations/${id}`, `/app/settings/locations/${id}/poster`];

  // Owners and auditors: no such pages.
  for (const who of ["owner", "auditor"] as const) {
    const page = await (await browser.newContext()).newPage();
    if (who === "owner") await signInAs(page, "E2E_OWNER_EMAIL");
    else {
      await page.goto("/sign-in");
      await page.getByRole("button", { name: /^Sign in as Internal audit .*Maple Harbour/ }).click();
      await page.waitForURL(/\/app\//);
    }
    for (const path of pages) {
      const res = await page.goto(path);
      expect(res?.status(), `${who} ${path}`).toBe(404);
      await expect(page.getByRole("main")).not.toContainText(name);
    }
    await page.context().close();
  }

  // The other org's lead: Maple Harbour's location is not theirs (the same 404 as an unknown id).
  const other = await (await browser.newContext()).newPage();
  await signInAs(other, "E2E_OTHER_LEAD_EMAIL");
  for (const path of pages.slice(1)) {
    const res = await other.goto(path);
    expect(res?.status(), `other org's lead ${path}`).toBe(404);
    await expect(other.getByRole("main")).not.toContainText(name);
  }
  await other.goto("/app/settings/locations");
  await expect(other.getByRole("heading", { level: 1, name: "Locations and posters" })).toBeVisible();
  await expect(other.getByRole("main")).not.toContainText(name);
  for (const path of ["/app/settings/locations/not-a-uuid", "/app/settings/locations/00000000-0000-4000-8000-000000000000/poster"]) {
    expect((await other.goto(path))?.status(), path).toBe(404);
  }
  await other.context().close();

  // Lakeview's report form with Maple Harbour's location id: an empty form, and nothing about the other org.
  const reporter = await reporterPage(browser);
  const res = await gotoHydrated(reporter, `/o/${LAKEVIEW}/report?loc=${id}`);
  expect(res?.status()).toBe(200);
  await expect(reporter.getByRole("main")).not.toContainText(name);
  await reporter.getByLabel("What got in your way?").fill(`The phone menu is too fast (cross-org ${stamp()}).`);
  await reporter.getByRole("button", { name: "Next", exact: true }).click();
  for (const radio of await where(reporter).getByRole("radio").all()) await expect(radio).not.toBeChecked();
  await expect(reporter.getByLabel("Where exactly? (optional)")).toHaveValue("");
  await reporter.context().close();
});
