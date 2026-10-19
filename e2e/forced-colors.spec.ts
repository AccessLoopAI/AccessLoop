// Forced colors (Windows contrast themes; CLAUDE.md "works in forced-colors mode"; components/ui/README.md "Focus,
// forced colours, reflow"): every key screen in a context with forcedColors "active". Backgrounds, tints and
// box-shadows are gone there, so each screen must still render its one h1, its status badges must keep their text
// and a border, redaction marks their text and dashed underline, choice rows their border (and a frame when
// chosen), pressed answers a frame, buttons their border, a report's footnote buttons their border (and a frame
// with their "Sources" card's border when open), hash and filter chips their border, the dashboard's period segments
// their frame (the chosen one its Highlight fill) and its chart marks their colours (the verified series apart), the
// staff header's current tab its bar, and focus must show as an outline (the halo is a box-shadow and disappears).
// Plus axe on every screen (e2e/a11y-checks.ts says why text contrast is left to the system's own colours there).
// The screens and their states are in e2e/key-pages.ts, the checks in e2e/a11y-checks.ts. The last test checks that a
// chosen option, a pressed toggle and an open footnote that have focus show the focus ring, not only their frame
// (both are Highlight in this mode).
import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import { signInAs } from "./helpers";
import { makeReport } from "./fixtures/reports";
import { atLastTabStop, expectNoAxeViolationsInForcedColors, expectVisibleFocus, forcedColorsProblems, tabTo } from "./a11y-checks";
import { KEY_SCREENS, visitKeyPages, type KeyScreen } from "./key-pages";

/** A made-up client address in 127/8 (loopback: local sign-in refuses others): its own rate-limit bucket, never the suite's 127.0.0.1. */
const freshIp = () => ((b: Buffer) => `127.${1 + (b[0] % 255)}.${b[1]}.${b[2]}`)(randomBytes(3));

type Kind = "badges" | "marks" | "choices" | "pressed" | "buttons" | "navCurrent" | "footnotes" | "chips" | "segments" | "charts";

/** What each screen must show at least one of (so the checks never pass on an empty page). */
const EXPECT: Partial<Record<KeyScreen, Kind[]>> = {
  accessibility: ["buttons"],
  "report step 1": ["buttons"],
  "report step 2": ["choices", "buttons"],
  "report step 3 with errors": ["choices", "buttons"],
  "report step 3": ["choices", "buttons"],
  "report review (Change it)": ["choices", "buttons"],
  "report review": ["choices", "buttons"],
  receipt: ["buttons"],
  "re-test open": ["badges", "choices", "buttons"],
  "re-test verified": ["badges"],
  check: ["buttons"],
  "check with an error": ["buttons"],
  "public org page": ["buttons"],
  "published report (sources open)": ["footnotes", "chips", "buttons"],
  "evidence check": ["badges", "chips", "buttons"],
  "sign-in": ["buttons"],
  dashboard: ["segments", "charts", "buttons", "navCurrent"],
  "dashboard (charts as tables)": ["segments", "pressed", "buttons", "navCurrent"],
  inbox: ["badges", "buttons", "navCurrent"],
  "inbox (filtered)": ["badges", "chips", "buttons", "navCurrent"],
  "case page (lead, redaction review)": ["badges", "marks", "buttons", "navCurrent"],
  "case page (lead, triaged)": ["badges", "buttons", "navCurrent"],
  "case page (lead, assigned)": ["badges", "buttons", "navCurrent"],
  "case page (lead, verified)": ["badges", "buttons", "navCurrent"],
  "log feedback": ["choices", "buttons", "navCurrent"],
  "log feedback (code shown)": ["buttons", "navCurrent"],
  reports: ["badges", "buttons", "navCurrent"],
  "new report": ["buttons", "navCurrent"],
  "report draft (sources open)": ["badges", "footnotes", "chips", "buttons", "navCurrent"],
  "evidence check (tampered)": ["badges", "chips", "buttons", "navCurrent"],
  "published report (staff)": ["badges", "footnotes", "chips", "buttons", "navCurrent"],
  outbox: ["buttons", "navCurrent"],
  eval: ["buttons", "navCurrent"],
  settings: ["choices", "buttons", "navCurrent"],
  locations: ["buttons", "navCurrent"],
  "location poster": ["buttons", "navCurrent"],
  "my work": ["badges", "buttons", "navCurrent"],
  "case page (owner, assigned)": ["badges", "buttons", "navCurrent"],
};

for (const colorScheme of ["light", "dark"] as const) {
  test(`every key screen works in forced-colors mode (${colorScheme})`, async ({ browser }) => {
    test.setTimeout(360_000);
    const visited = await visitKeyPages(browser, { forcedColors: "active", colorScheme }, async (page, screen) => {
      const label = `${screen} (forced colors, ${colorScheme})`;
      await expect(page.getByRole("heading", { level: 1 }), label).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 }), label).toBeVisible();
      await expect(page.getByRole("status"), label).toHaveCount(1);
      await expect(page.getByRole("link", { name: "Get help" }), label).toHaveCount(1);

      const fc = await forcedColorsProblems(page);
      expect(fc.active, `${label}: forced-colors mode is on`).toBe(true);
      expect(fc.problems, `${label}: badges, marks, choices and pressed answers`).toEqual([]);
      for (const kind of EXPECT[screen] ?? []) {
        expect(fc.counts[kind], `${label}: at least one of ${kind}`).toBeGreaterThan(0);
      }
      await expectNoAxeViolationsInForcedColors(page, label);

      // Focus: up to three Tab stops from wherever focus is (never past the end of the page), each with a visible
      // outline (the halo is a box-shadow, which this mode removes).
      for (let i = 1; i <= 3 && !(await atLastTabStop(page)); i++) {
        await page.keyboard.press("Tab");
        const f = await expectVisibleFocus(page, `${label}: Tab ${i}`);
        expect(f.indicator, `${label}: Tab ${i} on ${f.what} is an outline`).toMatch(/^outline /);
      }
    });
    expect(visited).toEqual([...KEY_SCREENS]);
  });
}

// A chosen option, a pressed toggle and an open footnote that have focus: in this mode their frame and the focus ring
// are both drawn in Highlight, so the focused one must show the full focus ring (3px, 2px off it), not only the frame
// it has anyway. A reporter radio row (chosen with the arrow keys, so it is focused and chosen at once), the
// dashboard's chosen period segment (filled with Highlight; the ring sits around it), a "Show as table" toggle pressed
// with Enter and a report footnote opened with Enter (focus stays on both).
test("in forced-colors mode, a chosen, pressed or open control that has focus shows the focus ring, not only its frame", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ forcedColors: "active", reducedMotion: "reduce", extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  const page = await context.newPage();
  await page.goto("/o/maple-harbour/report");
  // React has hydrated the form (until then Next would send a plain POST; e2e/keyboard.spec.ts waits the same way).
  await page.waitForFunction(() => {
    const el = document.querySelector("#report-text");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  });
  await page.getByLabel("What got in your way?").fill(`The ramp at the side entrance is too steep (forced colors ${Date.now().toString(36)}).`);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Where did it happen?" })).toBeFocused();
  const where = page.getByRole("group", { name: "Where did it happen?" });
  await tabTo(page, where.getByRole("radio", { name: "On a website or app" }), "report step 2: into the group", { max: 3 });
  await page.keyboard.press("ArrowDown");
  const atAPlace = where.getByRole("radio", { name: "At a place" });
  await expect(atAPlace).toBeFocused();
  await expect(atAPlace).toBeChecked();
  // (A `has:` locator is matched inside each row, so it names the radio without the group around it.)
  const row = page.locator(".al-choice", { has: page.getByRole("radio", { name: "At a place" }) });
  // Two frames first: under reduced motion every change is a 0.01 ms transition (as in focusState()).
  const outline = () => row.evaluate(async (e) => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const cs = getComputedStyle(e);
    return `${cs.outlineStyle} ${cs.outlineWidth} offset ${cs.outlineOffset}`;
  });
  const focused = await expectVisibleFocus(page, "chosen option with focus");
  expect(focused.indicator, "the chosen row with focus wears the focus ring").toBe("outline 3px");
  const ring = await outline();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Where exactly? (optional)")).toBeFocused();
  const frame = await outline();
  expect(frame, "the chosen row keeps a frame without focus").toMatch(/^solid /);
  expect(ring, "focused and unfocused chosen rows differ").not.toBe(frame);

  await signInAs(page, "E2E_LEAD_EMAIL");
  await page.goto("/app/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  const chosen = page.getByRole("group", { name: "Period", exact: true }).getByRole("radio", { checked: true });
  await expect(chosen).toHaveCount(1);
  await tabTo(page, chosen, "dashboard: to the chosen period", { max: 40 });
  const seg = await expectVisibleFocus(page, "chosen period segment with focus");
  expect(seg.indicator, "the chosen segment with focus wears the focus ring").toBe("outline 3px");

  // A pressed toggle ("Show as table") keeps focus after Enter: the ring, not only the pressed frame.
  const toggle = page.getByRole("button", { name: /^Show as table \(/ }).first();
  await tabTo(page, toggle, "dashboard: to the first Show as table", { max: 40 });
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toBeFocused();
  const pressed = await expectVisibleFocus(page, "pressed toggle with focus");
  expect(pressed.indicator, "the pressed toggle with focus wears the focus ring").toBe("outline 3px");

  // An open "Sources for this sentence" footnote keeps focus after Enter: the ring, not only the open frame.
  const report = await makeReport("maple-harbour");
  await page.goto(`/app/reports/${report.id}`);
  const sources = page.getByRole("button", { name: /^Sources for this sentence \(\d+ records?\)$/ }).first();
  await tabTo(page, sources, "report: to the first footnote", { max: 40 });
  await page.keyboard.press("Enter");
  await expect(sources).toHaveAttribute("aria-expanded", "true");
  await expect(sources).toBeFocused();
  const open = await expectVisibleFocus(page, "open footnote with focus");
  expect(open.indicator, "the open footnote with focus wears the focus ring").toBe("outline 3px");
  await context.close();
});
