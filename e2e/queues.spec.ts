// Phase 7 T2 items 5, 6 and 7 (docs/phase7-prompt.md): the staff queues.
// 5. The inbox's native GET form: search (reference, public summary), selects for status, area, assigned to, channel
//    and age, sort by received date, age or due date, 50 cases to a page; the dashboard's links keep working (a
//    search narrows the cases a number opened); axe in both themes, keyboard alone, no sideways scroll at 320 px.
// 6. Due dates (decision D8): set on assign on the case page, shown in the inbox and My work, "Overdue" once past.
// 7. "A barrier was assigned to you": logged to the Outbox (FAKE_EMAIL=1), no report text, a link to the case.
// Specs share one database: never assume fixed counts. Every case here is fresh (e2e/fixtures/*).
import { test, expect, type Browser, type Page } from "@playwright/test";
import { expectNoAxeViolations, signInAs } from "./helpers";
import { press, tabTo } from "./a11y-checks";
import { casesOf, ownerSql, withSql } from "./db";
import { fileReport, moveCase } from "./fixtures/cases";
import { messagesOf } from "./fixtures/messages";
import { assignDue, memberId, triageWith } from "./fixtures/queues";
import { refsOnPage } from "./inbox-pages";
import { zonedDate, zonedNoon } from "@/lib/dates";
import { formatDate, formatDateLong } from "@/lib/format";
import { addDays, inboxHref, thisYear } from "@/lib/metrics";

const ORG = "maple-harbour";
const OWNER = "Facilities team";

let counter = 0;
const stamp = () => `${Date.now().toString(36)}${++counter}`;
const today = () => zonedDate(new Date());

async function staffPage(browser: Browser, role: "lead" | "owner" | "auditor", viewport = { width: 1440, height: 900 }) {
  const page = await (await browser.newContext({ viewport })).newPage();
  if (role === "auditor") {
    // The local "Sign in as" page (e2e/helpers.ts has no auditor; e2e/security.spec.ts signs in the same way).
    await page.goto("/sign-in");
    await page.getByRole("button", { name: /^Sign in as Internal audit .*Maple Harbour/ }).click();
    await page.waitForURL(/\/app\//);
    return page;
  }
  await signInAs(page, role === "lead" ? "E2E_LEAD_EMAIL" : "E2E_OWNER_EMAIL");
  return page;
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
}

async function axeBothThemes(page: Page, label: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await settle(page);
    await expectNoAxeViolations(page, `${label} (${colorScheme})`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

async function noSideScroll(page: Page, width: number, label: string) {
  const size = page.viewportSize();
  await page.setViewportSize({ width, height: 800 });
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways, `${label}: no sideways page scroll at ${width}px`).toBeLessThanOrEqual(0);
  if (size) await page.setViewportSize(size);
}

const h1 = (page: Page) => page.getByRole("heading", { level: 1, name: "Inbox" });
const form = (page: Page) => page.getByRole("search", { name: "Find cases" });
const filters = (page: Page) => page.getByRole("region", { name: "Filters" });
const result = (page: Page) => page.getByTestId("case-action-result");

/** Open an inbox URL and wait until its form is hydrated (next/form then searches without a page load). */
async function openInbox(page: Page, url = "/app/inbox") {
  await page.goto(url);
  await page.waitForFunction(() => {
    const el = document.querySelector("form[role=search]");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  });
}

/** Press "Show cases"; the h1 takes focus on the new list. */
async function show(page: Page) {
  await form(page).getByRole("button", { name: "Show cases" }).click();
  await expect(h1(page)).toBeFocused();
}

/** Two fresh cases with public summaries of their own: A triaged (built environment), B assigned (ICT). */
async function twoCases(tag: string) {
  const a = await fileReport(ORG, { text: `The ramp at the side entrance is too steep for my chair (queues ${tag} a).` });
  const b = await fileReport(ORG, { text: `The online form times out before I can finish it (queues ${tag} b).`, where: "digital" });
  await moveCase(ORG, a.ref, "approved");
  await triageWith(ORG, a.ref, `Queue check ${tag}: the ramp at a side entrance was too steep.`);
  await moveCase(ORG, b.ref, "approved");
  await triageWith(ORG, b.ref, `Queue check ${tag}: an online form timed out.`, "ict");
  await assignDue(ORG, b.ref, OWNER, null);
  return { a: a.ref, b: b.ref };
}

test.describe.configure({ mode: "serial" });

test("the inbox's GET form searches by reference and summary, filters with five selects and sorts", async ({ browser }) => {
  const tag = stamp();
  const { a, b } = await twoCases(tag);
  const page = await staffPage(browser, "lead");
  await openInbox(page);
  await expect(form(page)).toBeVisible();
  await expect(filters(page)).toHaveCount(0);

  // A reference.
  await form(page).getByLabel("Search").fill(a);
  await show(page);
  await expect(page).toHaveURL(new RegExp(`[?&]q=${a}(&|$)`));
  expect(await refsOnPage(page)).toEqual([a]);
  await expect(filters(page)).toContainText(`Search: “${a}”`);
  await expect(filters(page)).toContainText("1 of ");
  // The row shows the new columns: area, who it is assigned to, and the age.
  const rowA = page.getByRole("table", { name: /^Cases received/ }).getByRole("row").filter({ hasText: a });
  await expect(rowA).toContainText("The built environment");
  await expect(rowA).toContainText("No one yet");
  await expect(rowA).toContainText("Today");

  // Words from the public summary, in any case: both, newest first; then oldest first.
  await form(page).getByLabel("Search").fill(`QUEUE CHECK ${tag}`);
  await show(page);
  expect(await refsOnPage(page)).toEqual([b, a]);
  await form(page).getByLabel("Sort by").selectOption({ label: "Age, oldest first" });
  await show(page);
  expect(await refsOnPage(page)).toEqual([a, b]);
  await expect(page).toHaveURL(/[?&]sort=age(&|$)/);

  // Status, assigned to, area, channel and age, each with the search.
  const pick = async (label: string, option: string) => form(page).getByLabel(label, { exact: true }).selectOption({ label: option });
  await pick("Status", "Assigned");
  await show(page);
  expect(await refsOnPage(page)).toEqual([b]);
  await expect(filters(page)).toContainText("Status: Assigned");
  await pick("Status", "Any status");
  await pick("Assigned to", "No one yet");
  await show(page);
  expect(await refsOnPage(page)).toEqual([a]);
  await expect(filters(page)).toContainText("Assigned to: no one yet");
  await pick("Assigned to", OWNER);
  await show(page);
  expect(await refsOnPage(page)).toEqual([b]);
  await expect(page).toHaveURL(new RegExp(`[?&]assignee=${await memberId(ORG, OWNER)}(&|$)`));
  await pick("Assigned to", "Anyone");
  await pick("Area", "Information and communication technologies");
  await show(page);
  expect(await refsOnPage(page)).toEqual([b]);
  await pick("Area", "Any area");
  await pick("Came in by", "Phone");
  await show(page);
  await expect(page.getByRole("heading", { level: 2, name: "No cases match these filters" })).toBeVisible();
  await pick("Came in by", "Web form");
  await pick("Age", "Under 7 days");
  await show(page);
  expect(await refsOnPage(page)).toEqual([a, b]);
  await expect(filters(page)).toContainText("Received less than 7 days ago");
  await pick("Age", "90 days or more");
  await show(page);
  await expect(page.getByRole("heading", { level: 2, name: "No cases match these filters" })).toBeVisible();
  await axeBothThemes(page, "inbox: a search with no match");

  // "Clear filters" empties the form too (it keeps no stale words).
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/app\/inbox$/);
  await expect(h1(page)).toBeFocused();
  await expect(form(page).getByLabel("Search")).toHaveValue("");
  await expect(form(page).getByLabel("Age", { exact: true })).toHaveValue("");
  await expect(filters(page)).toHaveCount(0);
  await page.context().close();
});

test("a dashboard number's inbox keeps its filter when the lead searches inside it", async ({ browser }) => {
  const tag = stamp();
  const { a, b } = await twoCases(tag);
  const page = await staffPage(browser, "lead");
  const period = thisYear(new Date());

  // The funnel's "triaged" stage (no field in the form): a search narrows those cases and keeps the period and stage.
  await openInbox(page, inboxHref({ from: period.start, to: period.end, stage: "triaged" }));
  await expect(filters(page)).toContainText("Got as far as triage");
  await form(page).getByLabel("Search").fill(`queue check ${tag}`);
  await show(page);
  for (const part of [`from=${period.start}`, `to=${period.end}`, "stage=triaged", "q=queue"]) await expect(page).toHaveURL(new RegExp(part));
  expect(await refsOnPage(page)).toEqual([b, a]);
  await expect(filters(page)).toContainText("Got as far as triage");
  await expect(filters(page)).toContainText(`Search: “queue check ${tag}”`);

  // "Open barriers" chooses four statuses at once: the select shows that choice, and the search keeps it.
  await openInbox(page, inboxHref({ status: ["new", "triaged", "assigned", "retest_open"] }));
  const status = form(page).getByLabel("Status", { exact: true });
  await expect(status.locator("option:checked")).toHaveText("New, Triaged, Assigned or Waiting for the reporter to check");
  await form(page).getByLabel("Search").fill(`queue check ${tag}`);
  await show(page);
  expect(await refsOnPage(page)).toEqual([b, a]);
  await expect(filters(page)).toContainText("Status: New, Triaged, Assigned or Waiting for the reporter to check");
  await page.context().close();
});

test("the inbox shows 50 cases to a page, with Previous and Next page links", async ({ browser }) => {
  test.setTimeout(180_000);
  let total = (await withSql(ownerSql, (sql) => casesOf(sql, ORG))).length;
  for (; total <= 55; total++) await fileReport(ORG, { text: `The lift button at the back is too high to reach (queues paging ${stamp()}).` });
  const pages = Math.ceil(total / 50);

  const page = await staffPage(browser, "lead");
  await openInbox(page);
  const first = await refsOnPage(page);
  expect(first).toHaveLength(50);
  const nav = page.getByRole("navigation", { name: new RegExp(`^Page 1 of ${pages}`) });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Previous page" })).toHaveCount(0);
  await expect(page.getByRole("table", { name: /^Cases received/ })).toContainText(`${total} cases, 1 to 50 on this page`);
  await axeBothThemes(page, "inbox: page 1 of several");

  await nav.getByRole("link", { name: "Next page" }).click();
  await expect(h1(page)).toBeFocused();
  await expect(page).toHaveURL(/[?&]page=2(&|$)/);
  const second = await refsOnPage(page);
  expect(second).toHaveLength(Math.min(50, total - 50));
  expect(second.filter((r) => first.includes(r))).toEqual([]);
  await expect(page.getByRole("navigation", { name: new RegExp(`^Page 2 of ${pages}`) }).getByRole("link", { name: "Previous page" })).toBeVisible();

  // A page past the end shows the last one.
  await page.goto("/app/inbox?page=999");
  await expect(page.getByRole("navigation", { name: new RegExp(`^Page ${pages} of ${pages}`) })).toBeVisible();
  expect(await refsOnPage(page)).toHaveLength(total - 50 * (pages - 1));
  await page.context().close();
});

test("the inbox form works with the keyboard alone, passes axe and reflows at 320 px", async ({ browser }) => {
  const tag = stamp();
  const { a } = await twoCases(tag);
  const page = await staffPage(browser, "lead", { width: 1280, height: 720 });
  await openInbox(page);
  await expect(form(page)).toBeVisible();
  await axeBothThemes(page, "inbox with its search form");

  // From the h1 (where focus lands after every search), Tab reaches the search field first; Enter submits.
  await h1(page).focus();
  const search = form(page).getByLabel("Search");
  await tabTo(page, search, "inbox: to the search field", { max: 3 });
  await page.keyboard.type(a);
  await page.keyboard.press("Enter");
  await expect(h1(page)).toBeFocused();
  expect(await refsOnPage(page)).toEqual([a]);
  // Every field, then "Show cases", in order; a select changes nothing until the button is pressed (WCAG 3.2.2).
  await press(page, "Tab", "inbox: to the search field again");
  await expect(search).toBeFocused();
  for (const label of ["Status", "Area", "Assigned to", "Came in by", "Age", "Sort by"]) {
    await press(page, "Tab", `inbox: to ${label}`);
    await expect(form(page).getByLabel(label, { exact: true })).toBeFocused();
  }
  // Choosing an option submits nothing (WCAG 3.2.2): only the button does.
  await form(page).getByLabel("Sort by").selectOption({ label: "Age, oldest first" });
  await expect(form(page).getByLabel("Sort by")).toBeFocused();
  await page.waitForTimeout(300); // a change event that navigated would have done so by now
  await expect(page).not.toHaveURL(/sort=age/);
  await press(page, "Tab", "inbox: to Show cases");
  await expect(form(page).getByRole("button", { name: "Show cases" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(h1(page)).toBeFocused();
  await expect(page).toHaveURL(/[?&]sort=age(&|$)/);
  await axeBothThemes(page, "inbox: searched, with the filter summary");
  await noSideScroll(page, 320, "inbox with its search form");
  await noSideScroll(page, 390, "inbox with its search form");
  await page.context().close();

  // An auditor has the same form (read-only page). Local sign-in only, like e2e/security.spec.ts.
  if (process.env.AUTH_MODE !== "local") return;
  const auditor = await staffPage(browser, "auditor");
  await auditor.goto(`/app/inbox?q=${a}`);
  expect(await refsOnPage(auditor)).toEqual([a]);
  await expectNoAxeViolations(auditor, "inbox (auditor), searched");
  await auditor.context().close();
});

test("a due date set on assign shows in the inbox and My work, Overdue once it has passed; the owner is emailed", async ({ browser }) => {
  const tag = stamp();
  const filed = await fileReport(ORG, { text: `The door to the accessible washroom is too heavy to open (queues ${tag} due).` });
  await moveCase(ORG, filed.ref, "approved");
  await triageWith(ORG, filed.ref, `Due check ${tag}: a washroom door was too heavy.`);
  const ref = filed.ref;
  const lead = await staffPage(browser, "lead");
  await lead.goto(`/app/cases/${ref}`);
  await expect(lead.getByTestId("case-status")).toHaveText("Triaged");

  // A date in the past is refused with the reason on the field, and nothing changes.
  await lead.getByLabel("Assign to").selectOption({ label: OWNER });
  const due = lead.getByLabel("Due date (optional)");
  await due.fill(addDays(today(), -1));
  await lead.getByRole("button", { name: "Assign" }).click();
  await expect(lead.locator(":focus")).toContainText("Choose today or a later date for the due date.");
  await expect(lead.getByTestId("case-status")).toHaveText("Triaged");
  await axeBothThemes(lead, "case: assign with a due date error");

  // A week ahead: assigned, with the date in the answer, the details and the History; the email is logged.
  const week = addDays(today(), 7);
  await due.fill(week);
  await lead.getByRole("button", { name: "Assign" }).click();
  await expect(lead.getByTestId("case-status")).toHaveText("Assigned");
  await expect(result(lead)).toContainText(`Assigned to ${OWNER}, due ${formatDateLong(zonedNoon(week))}. Status: Assigned.`);
  await expect(result(lead)).toContainText(
    `The email telling ${OWNER} was logged, not sent (email is simulated in this prototype; the Outbox shows it).`,
  );
  await expect(lead.getByRole("main")).toContainText(`Due ${formatDate(zonedNoon(week))}`);
  await expect(lead.getByRole("region", { name: "History" })).toContainText(`Due date: ${formatDateLong(zonedNoon(week))}`);
  await expect(lead.getByRole("region", { name: "History" })).toContainText("Email logged, not sent (simulated): assignment email to the owner");
  await expect(lead.getByLabel("Due date (optional)")).toHaveValue(week);
  await axeBothThemes(lead, "case: assigned with a due date");

  // Only the date changes (same person): said plainly, and no second email.
  const twoWeeks = addDays(today(), 14);
  await lead.getByLabel("Due date (optional)").fill(twoWeeks);
  await lead.getByRole("button", { name: "Assign" }).click();
  await expect(result(lead)).toContainText(`Due date set to ${formatDateLong(zonedNoon(twoWeeks))}. Still assigned to ${OWNER}.`);
  expect((await messagesOf(ORG, ref)).map((m) => [m.template, m.status])).toEqual([["owner_assigned", "skipped_fake"]]);

  // Another case, past its due date (set three days ago by the fixture): Overdue in the inbox, first by due date.
  const late = await fileReport(ORG, { text: `The braille sign on the meeting room is missing (queues ${tag} late).` });
  await moveCase(ORG, late.ref, "approved");
  await triageWith(ORG, late.ref, `Due check ${tag}: a braille sign was missing.`);
  await assignDue(ORG, late.ref, OWNER, addDays(today(), -3));
  await lead.goto(`/app/inbox?q=${encodeURIComponent(`due check ${tag}`)}&sort=due`);
  expect(await refsOnPage(lead)).toEqual([late.ref, ref]);
  const table = lead.getByRole("table", { name: /^Cases received/ });
  const lateRow = table.getByRole("row").filter({ hasText: late.ref });
  await expect(lateRow).toContainText(OWNER);
  await expect(lateRow).toContainText("Overdue");
  await expect(lateRow).toContainText(`Was due ${formatDate(zonedNoon(addDays(today(), -3)))} (3 days ago)`);
  const dueRow = table.getByRole("row").filter({ hasText: ref });
  await expect(dueRow).toContainText(`Due ${formatDate(zonedNoon(twoWeeks))}`);
  await expect(dueRow).not.toContainText("Overdue");
  await axeBothThemes(lead, "inbox: an overdue case");

  // The Outbox: the owner's email, its link to the case, no report text, and who it went to.
  await lead.goto("/app/outbox");
  const emailRow = lead.getByRole("row").filter({ hasText: ref }).filter({ has: lead.getByRole("cell", { name: "Assignment email to the owner", exact: true }) });
  await expect(emailRow).toHaveCount(1);
  await emailRow.getByRole("button", { name: /^Show the email/ }).click();
  await expect(emailRow).toContainText(`A barrier was assigned to you: ${ref}`);
  await expect(emailRow).toContainText("To: The assigned owner’s email (never shown)");
  await expect(emailRow).toContainText(`/app/cases/${ref}`);
  await expect(emailRow).not.toContainText("washroom");
  await axeBothThemes(lead, "outbox: the owner's assignment email open");
  await lead.context().close();

  // My work: the owner sees both, the overdue one marked, the soonest due first among them.
  const owner = await staffPage(browser, "owner");
  await owner.goto("/app/my-work");
  const mine = owner.getByRole("table", { name: /^Cases assigned to you/ });
  await expect(mine).toContainText("overdue");
  await expect(mine.getByRole("row").filter({ hasText: late.ref })).toContainText("Overdue");
  const mineDue = mine.getByRole("row").filter({ hasText: ref });
  await expect(mineDue).toContainText(`Due ${formatDate(zonedNoon(twoWeeks))}`);
  await expect(mineDue).toContainText("In 14 days");
  const order = (await mine.locator("tbody tr th a").allInnerTexts()).map((t) => t.trim());
  expect(order.indexOf(late.ref)).toBeLessThan(order.indexOf(ref));
  await axeBothThemes(owner, "my work: due and overdue cases");
  await noSideScroll(owner, 320, "my work with a Due column");
  await owner.goto(`/app/cases/${late.ref}`);
  await expect(owner.getByRole("main")).toContainText("Overdue");
  await owner.context().close();

  // The lead hands the overdue case to another team: its date (in the past) stays unless they change it.
  const lead2 = await staffPage(browser, "lead");
  await lead2.goto(`/app/cases/${late.ref}`);
  await expect(lead2.getByLabel("Due date (optional)")).toHaveValue(addDays(today(), -3));
  await lead2.getByLabel("Assign to").selectOption({ label: "Web team" });
  await lead2.getByRole("button", { name: "Assign" }).click();
  await expect(result(lead2)).toContainText(`Assigned to Web team, due ${formatDateLong(zonedNoon(addDays(today(), -3)))}. Status: Assigned.`);
  await expect(lead2.getByRole("main")).toContainText("Overdue");
  expect((await messagesOf(ORG, late.ref)).map((m) => m.template)).toEqual(["owner_assigned"]);
  await lead2.context().close();
});
