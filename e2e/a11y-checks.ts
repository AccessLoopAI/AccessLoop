// E2E-only checks shared by e2e/keyboard.spec.ts, e2e/reflow.spec.ts and e2e/forced-colors.spec.ts (never imported
// by the app). They read the live DOM and computed styles, so they test what a person actually gets:
// - focusState(): the focused element shows a visible indicator (WCAG 2.4.7) and no sticky or fixed element covers
//   it (2.4.11 Focus Not Obscured);
// - reflowProblems(): at the current viewport nothing scrolls the page sideways, nothing sticks out of the screen or
//   is cut off, and anything wider than its box scrolls only inside a labelled, focusable region (1.4.10 Reflow);
// - forcedColorsProblems(): in forced-colors mode, badges, redaction marks, choice rows, pressed answers, buttons,
//   report footnotes (and the Sources card an open one shows) and hash and filter chips keep their text and a visible
//   edge once the system replaces every colour; the dashboard's period segments keep their frame and the chosen one
//   its fill, its chart marks stay drawn (the verified series apart); the staff header's current tab keeps its bar;
// - expectNoAxeViolationsInForcedColors(): axe for forced-colors mode (see its note on colour contrast);
// - textSpacingProblems(): with WCAG 1.4.12's text spacing applied over the page's own styles, no text is cut off by
//   a box that hides overflow, no line of text runs into another and the page does not scroll sideways
//   (e2e/text-spacing.spec.ts, in Chromium and WebKit).
import { expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export interface FocusState {
  /** A short, text-free description of the focused element (tag, id, role, name attribute). */
  what: string;
  /** The element matches :focus-visible (the browser shows its focus indicator for it). */
  focusVisible: boolean;
  /** The visible indicator found ("outline 3px", "ring 7px"), or "none". */
  indicator: string;
  /** A sticky or fixed element that covers part of the focused element, or null. */
  coveredBy: string | null;
  /** At least part of the focused element is inside the viewport. */
  inViewport: boolean;
}

/** The focused element's indicator and whether anything sticky covers it; null when nothing has focus. */
export async function focusState(page: Page): Promise<FocusState | null> {
  return page.evaluate(async () => {
    // Two frames first: under reduced motion every property change is a 0.01 ms transition (app/globals.css), so a
    // style read in the same frame as the key press still sees the old value (the skip link above the page).
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el === document.documentElement) return null;
    const describe = (e: Element) => {
      const bits = [e.tagName.toLowerCase()];
      if (e.id) bits.push(`#${e.id}`);
      const role = e.getAttribute("role");
      if (role) bits.push(`[role=${role}]`);
      const type = e.getAttribute("type");
      if (type) bits.push(`[type=${type}]`);
      const name = e.getAttribute("name");
      if (name) bits.push(`[name=${name}]`);
      const href = e.getAttribute("href");
      if (href && !href.startsWith("data:") && !href.startsWith("/r/")) bits.push(`[href=${href}]`); // never a code
      return bits.join("");
    };
    // Radios and checkboxes draw their ring on the whole row (.al-choice), not on the native input; a segment's radio
    // (SegmentedControl, the dashboard's period) is invisible (opacity 0) and its label wears the ring.
    const ringOn =
      (el.matches('input[type="radio"], input[type="checkbox"]')
        ? (el.closest(".al-choice") ?? el.closest(".al-segment")?.querySelector(".al-segment-label"))
        : null) ?? el;
    const cs = getComputedStyle(ringOn);
    let indicator = "none";
    const outlineWidth = parseFloat(cs.outlineWidth) || 0;
    const transparent = (c: string) => c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c);
    if (cs.outlineStyle !== "none" && outlineWidth >= 2 && !transparent(cs.outlineColor)) {
      indicator = `outline ${outlineWidth}px`;
    } else if (cs.boxShadow && cs.boxShadow !== "none") {
      // A ring is an outer box-shadow with no offset and no blur and a spread of 2px or more.
      for (const layer of cs.boxShadow.split(/,(?![^(]*\))/)) {
        if (/\binset\b/.test(layer)) continue;
        const color = layer.match(/rgba?\([^)]*\)/)?.[0] ?? "";
        const lengths = layer.replace(/rgba?\([^)]*\)/, "").trim().split(/\s+/).map((v) => parseFloat(v));
        const [x, y, blur, spread] = lengths;
        if (x === 0 && y === 0 && (blur ?? 0) === 0 && (spread ?? 0) >= 2 && !transparent(color)) {
          indicator = `ring ${spread}px`;
          break;
        }
      }
    }
    const r = ringOn.getBoundingClientRect();
    // Covered = at one of five points of the focused box (the centre and the corners), the element on top belongs
    // to a sticky or fixed box that does not hold the focused element (focus inside the sticky header is fine; the
    // skip link, drawn over the header, is not covered by it).
    const pinned = (e: Element | null): Element | null => {
      for (let p = e; p && p !== document.body; p = p.parentElement) {
        const position = getComputedStyle(p).position;
        if (position === "sticky" || position === "fixed") return p;
      }
      return null;
    };
    let coveredBy: string | null = null;
    const clampX = (x: number) => Math.min(Math.max(x, 0), window.innerWidth - 1);
    const clampY = (y: number) => Math.min(Math.max(y, 0), window.innerHeight - 1);
    // Inset from the corners, so a rounded corner (hit testing follows border-radius) never counts as "covered".
    const d = Math.max(1, Math.min(12, r.width / 2 - 1, r.height / 2 - 1));
    const points = [
      [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
      [r.left + d, r.top + d],
      [r.right - d, r.top + d],
      [r.left + d, r.bottom - d],
      [r.right - d, r.bottom - d],
    ].filter(([x, y]) => x >= 0 && x < window.innerWidth && y >= 0 && y < window.innerHeight);
    const inside = (hit: Element | null) => !hit || ringOn.contains(hit) || hit.contains(ringOn);
    for (const [x, y] of points) {
      const hit = document.elementFromPoint(clampX(x), clampY(y));
      if (inside(hit)) continue;
      const box = pinned(hit);
      if (box && !box.contains(el)) {
        // A box taller than the room below the sticky header (the inbox's table region, a whole long table) can
        // never show whole there. Shift+Tab onto it from its first row can leave its top under the header: Chrome
        // does not scroll an element that already fills the view. WCAG 2.4.11 asks that it is not ENTIRELY hidden,
        // so for such a box its part below the header must show (hit-tested in the middle of that part). Anything
        // that fits below the header keeps the strict rule: no part of it under the header.
        const b = box.getBoundingClientRect();
        const top = Math.max(r.top, b.bottom);
        const bottom = Math.min(r.bottom, window.innerHeight);
        if (r.height > window.innerHeight - b.bottom && bottom - top >= 2 * d) {
          if (inside(document.elementFromPoint(clampX((r.left + r.right) / 2), clampY((top + bottom) / 2)))) continue;
        }
        coveredBy = describe(box);
        break;
      }
    }
    return {
      what: describe(el),
      // A date input's own calendar button (inside the input) has focus: the input matches :focus-within only.
      focusVisible: el.matches(":focus-visible") || (el.matches("input") && !el.matches(":focus") && el.matches(":focus-within")),
      indicator,
      coveredBy,
      inViewport: r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth,
    };
  });
}

/** Something has focus, it shows a visible indicator, and nothing sticky covers it. */
export async function expectVisibleFocus(page: Page, label: string): Promise<FocusState> {
  const f = await focusState(page);
  expect(f, `${label}: something has focus`).not.toBeNull();
  const s = f as FocusState;
  expect(s.focusVisible, `${label}: ${s.what} matches :focus-visible`).toBe(true);
  expect(s.indicator, `${label}: ${s.what} shows a focus indicator (outline or ring)`).not.toBe("none");
  expect(s.coveredBy, `${label}: ${s.what} is not covered by a sticky element`).toBeNull();
  expect(s.inViewport, `${label}: ${s.what} is scrolled into view`).toBe(true);
  return s;
}

/** True when `target` is the focused element. */
export async function isFocused(target: Locator): Promise<boolean> {
  return target.evaluate((el) => el === document.activeElement);
}

/**
 * Press Tab (or Shift+Tab) until `target` has focus, checking the focus indicator at every stop. Fails if the
 * target is not reached within `max` presses. Returns the number of presses (0 when it already has focus).
 */
export async function tabTo(page: Page, target: Locator, label: string, { max = 20, back = false } = {}): Promise<number> {
  await expect(target, `${label}: the target is on the page`).toBeVisible();
  if (await isFocused(target)) return 0;
  const stops: string[] = [];
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
    const f = await expectVisibleFocus(page, `${label} (${back ? "Shift+Tab" : "Tab"} ${i})`);
    stops.push(f.what);
    if (await isFocused(target)) return i;
  }
  throw new Error(`${label}: not reached after ${max} presses. Stops: ${stops.join(" > ")}`);
}

/** The focused element is the last stop in the Tab order (one more Tab would leave the page). */
export async function atLastTabStop(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const stops = [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")].filter(
      (e) => e.tabIndex >= 0 && !e.matches(":disabled") && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden",
    );
    return stops.at(-1) === document.activeElement;
  });
}

/** Press a key on the focused element and check that focus is still visible afterwards. */
export async function press(page: Page, key: string, label: string): Promise<void> {
  await page.keyboard.press(key);
  await expectVisibleFocus(page, `${label} (${key})`);
}

export interface ReflowReport {
  viewport: number;
  scrollWidth: number;
  problems: string[];
}

/**
 * Reflow at the current viewport width: the page itself never scrolls sideways, no visible element sticks out of
 * the screen or is cut off by an overflow-hidden box, and anything that scrolls sideways is a labelled, focusable
 * region (the Table component's wrapper). Screen-reader-only text and form controls (which scroll their own text)
 * are left out.
 */
export async function reflowProblems(page: Page): Promise<ReflowReport> {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const scrollWidth = document.scrollingElement?.scrollWidth ?? document.documentElement.scrollWidth;
    const problems: string[] = [];
    const describe = (e: Element) => {
      const bits = [e.tagName.toLowerCase()];
      if (e.id) bits.push(`#${e.id}`);
      const cls = (e.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 4).join(".");
      if (cls) bits.push(`.${cls}`);
      return bits.join("");
    };
    const isControl = (e: Element) => e.matches("input, textarea, select");
    const scroller = (e: Element): Element | null => {
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll") return p;
      }
      return null;
    };
    const isLabelledRegion = (e: Element) =>
      e.getAttribute("role") === "region" &&
      (e.hasAttribute("aria-labelledby") || e.hasAttribute("aria-label")) &&
      (e as HTMLElement).tabIndex === 0;
    for (const e of document.body.querySelectorAll("*")) {
      // .al-code-joint: the receipt code's middle hyphen, kept in the text but clipped out of sight in a 1px box.
      if (e.closest(".sr-only, .al-skip, .al-code-joint, [hidden], template, script, style, noscript")) continue;
      if (e.closest("svg") && e.tagName.toLowerCase() !== "svg") continue;
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const inScroller = scroller(e);
      if ((r.right > viewport + 1 || r.left < -1) && !(inScroller && isLabelledRegion(inScroller))) {
        problems.push(`sticks out of the screen: ${describe(e)} (${Math.round(r.left)} to ${Math.round(r.right)}px)`);
      }
      if (isControl(e)) continue;
      const overX = e.scrollWidth > e.clientWidth + 1;
      if (!overX) continue;
      if (cs.overflowX === "hidden" || cs.overflowX === "clip") {
        problems.push(`cuts off its content: ${describe(e)} (${e.scrollWidth}px in ${e.clientWidth}px)`);
      } else if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && !isLabelledRegion(e)) {
        problems.push(`scrolls sideways outside a labelled region: ${describe(e)}`);
      }
    }
    return { viewport, scrollWidth, problems: [...new Set(problems)].slice(0, 15) };
  });
}

/** The page reflows at its current width (see reflowProblems). */
export async function expectReflow(page: Page, label: string): Promise<void> {
  const r = await reflowProblems(page);
  expect(r.scrollWidth, `${label}: page width at ${r.viewport}px`).toBeLessThanOrEqual(r.viewport);
  expect(r.problems, `${label}: reflow at ${r.viewport}px`).toEqual([]);
}

/**
 * Forced colors: every status badge, redaction mark, choice row (radio, checkbox), pressed answer, button, report
 * footnote and chip keeps its text and a visible edge (a border, an outline or an underline), because backgrounds and
 * tints are gone; an open footnote and the "Sources" card it opened stay framed; a segmented control keeps its frame
 * and its chosen segment a fill of its own; every chart mark is still drawn, the verified series in its own colour;
 * the staff header's current tab keeps its bar (a system colour, not Canvas).
 */
export async function forcedColorsProblems(page: Page): Promise<{ active: boolean; counts: Record<string, number>; problems: string[] }> {
  return page.evaluate(() => {
    const active = matchMedia("(forced-colors: active)").matches;
    const problems: string[] = [];
    const counts: Record<string, number> = {
      badges: 0, marks: 0, choices: 0, pressed: 0, buttons: 0, navCurrent: 0, footnotes: 0, chips: 0, segments: 0, charts: 0,
    };
    const clear = (c: string) => c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c);
    /** The first opaque background behind `e` (itself included). */
    const backdrop = (e: Element) => {
      for (let p: Element | null = e; p; p = p.parentElement) {
        const c = getComputedStyle(p).backgroundColor;
        if (!clear(c)) return c;
      }
      return "";
    };
    const visible = (e: Element) => {
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
    };
    const edge = (e: Element, sides: ("Top" | "Right" | "Bottom" | "Left")[] = ["Top", "Right", "Bottom", "Left"]) => {
      const cs = getComputedStyle(e) as unknown as Record<string, string>;
      const border = sides.some((s) => cs[`border${s}Style`] !== "none" && parseFloat(cs[`border${s}Width`]) >= 1);
      const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 1;
      return border || outline;
    };
    const text = (e: Element) => (e.textContent ?? "").trim().length > 0;
    // Status badges (StatusBadge). The History's decorative dots share the class for their border but are hidden.
    for (const b of document.querySelectorAll('.al-badge:not([aria-hidden="true"])')) {
      if (!visible(b)) continue;
      counts.badges++;
      if (!text(b)) problems.push("a status badge has no text");
      if (!edge(b)) problems.push(`status badge "${(b.textContent ?? "").trim()}" has no border`);
    }
    for (const m of document.querySelectorAll("mark.al-redact, .al-redact")) {
      if (!visible(m)) continue;
      counts.marks++;
      if (!text(m)) problems.push("a redaction mark has no text");
      if (!edge(m, ["Bottom"])) problems.push(`redaction mark "${(m.textContent ?? "").trim()}" has no underline`);
    }
    for (const c of document.querySelectorAll(".al-choice")) {
      if (!visible(c)) continue;
      counts.choices++;
      const label = c.querySelector("label");
      if (!label || !text(label)) problems.push("a choice row has no label text");
      if (!edge(c)) problems.push(`choice "${(label?.textContent ?? "").trim()}" has no border`);
      const input = c.querySelector("input");
      if (input?.checked) {
        const cs = getComputedStyle(c);
        if (cs.outlineStyle === "none" || parseFloat(cs.outlineWidth) < 1) {
          problems.push(`checked choice "${(label?.textContent ?? "").trim()}" is not framed`);
        }
      }
    }
    for (const p of document.querySelectorAll('[aria-pressed="true"]')) {
      if (!visible(p)) continue;
      counts.pressed++;
      if (!text(p)) problems.push("a pressed button has no text");
      const cs = getComputedStyle(p);
      if (cs.outlineStyle === "none" || parseFloat(cs.outlineWidth) < 1) {
        problems.push(`pressed answer "${(p.textContent ?? "").trim()}" is not framed`);
      }
    }
    // Buttons and button-styled links (Button, ButtonLink): their filled background is gone, so only the border
    // still shows where the button is.
    for (const b of document.querySelectorAll(".al-btn")) {
      if (!visible(b)) continue;
      counts.buttons++;
      if (!edge(b)) problems.push(`button "${(b.textContent ?? "").trim()}" has no border`);
    }
    // A report's footnote buttons ("Sources for this sentence (N records)", SourceNote) keep their border; an open
    // one keeps a frame (its tint is gone), and the "Sources" card it opened keeps its border.
    for (const f of document.querySelectorAll(".al-footnote")) {
      if (!visible(f)) continue;
      counts.footnotes++;
      const name = (f.textContent ?? "").trim();
      if (!name) problems.push("a footnote button has no text");
      if (!edge(f)) problems.push(`footnote "${name}" has no border`);
      if (f.getAttribute("aria-expanded") === "true") {
        const cs = getComputedStyle(f);
        if (cs.outlineStyle === "none" || parseFloat(cs.outlineWidth) < 1) problems.push(`open footnote "${name}" is not framed`);
        const card = document.getElementById(f.getAttribute("aria-controls") ?? "");
        if (!card || !visible(card) || !edge(card)) problems.push(`the Sources card of open footnote "${name}" has no border`);
      }
    }
    // Hash chips (HashChip: the evidence chain, a report's fingerprint) and filter chips keep their text and border.
    for (const c of document.querySelectorAll(".al-chip")) {
      if (!visible(c)) continue;
      counts.chips++;
      if (!text(c)) problems.push("a chip has no text");
      if (!edge(c)) problems.push(`chip "${(c.textContent ?? "").trim()}" has no border`);
    }
    // A segmented control (SegmentedControl, the dashboard's period): the row keeps its border, every segment its
    // words, and the chosen segment stays filled (Highlight) where the system would otherwise paint it like the rest.
    for (const g of document.querySelectorAll(".al-segments")) {
      if (!visible(g)) continue;
      counts.segments++;
      if (!edge(g)) problems.push("a segmented control has no border");
      for (const s of g.querySelectorAll(".al-segment")) {
        const label = s.querySelector(".al-segment-label");
        const name = (label?.textContent ?? "").trim();
        if (!label || !name) problems.push("a segment has no label text");
        if (label && s.querySelector<HTMLInputElement>(".al-segment-input")?.checked) {
          const bg = getComputedStyle(label).backgroundColor;
          if (clear(bg) || bg === backdrop(g)) problems.push(`chosen segment "${name}" is not marked`);
        }
      }
    }
    // Dashboard charts (hand-built SVG): every mark is still drawn (a fill that is neither none nor the card behind
    // it), and the "verified by the reporter" series keeps a colour of its own next to "received".
    const fills: Record<"verified" | "other", Set<string>> = { verified: new Set(), other: new Set() };
    for (const m of document.querySelectorAll(".al-chart-svg .al-mark")) {
      if (!visible(m)) continue;
      counts.charts++;
      const fill = getComputedStyle(m).fill;
      if (!fill || fill === "none" || clear(fill) || fill === backdrop(m.closest("svg") ?? m)) problems.push("a chart mark is not drawn");
      fills[m.getAttribute("data-tone") === "verified" ? "verified" : "other"].add(fill);
    }
    for (const f of fills.verified) if (fills.other.has(f)) problems.push("the verified series is drawn like the others");
    // The staff header's current tab: its bar is a background on ::after, which this mode would turn into Canvas,
    // the same colour as the header behind it. So the bar must differ from the first opaque background behind it.
    for (const a of document.querySelectorAll(".al-staff-nav a[aria-current]")) {
      if (!visible(a)) continue;
      counts.navCurrent++;
      const bar = getComputedStyle(a, "::after");
      if (bar.content === "none" || clear(bar.backgroundColor) || bar.backgroundColor === backdrop(a) || parseFloat(bar.height) < 2) {
        problems.push(`current tab "${(a.textContent ?? "").trim()}" has no visible bar`);
      }
    }
    return { active, counts, problems };
  });
}

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * axe in forced-colors mode: every WCAG 2.0/2.1/2.2 A and AA rule, as e2e/helpers.ts runs it, except colour contrast
 * on text whose colours the system forces. There the user's contrast theme sets both colours, and Chrome still
 * reports the AUTHOR colour in -webkit-text-fill-color, which axe reads first: the light staff-header text came out
 * as "light on the forced white background" although it is drawn in the system's text colour. Contrast is checked
 * on every page in the light and dark themes by the other specs, and here on the one element that opts out of
 * forcing (redaction marks: forced-color-adjust none, Highlight/HighlightText).
 */
export async function expectNoAxeViolationsInForcedColors(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).disableRules(["color-contrast"]).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s)`);
  expect(summary, `axe violations on ${label}`).toEqual([]);
  if (await page.locator(".al-redact").count()) {
    const marks = await new AxeBuilder({ page }).include(".al-redact").withRules(["color-contrast"]).analyze();
    const markSummary = marks.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s)`);
    expect(markSummary, `colour contrast of the redaction marks on ${label}`).toEqual([]);
  }
}

/**
 * WCAG 2.2 SC 1.4.12 Text Spacing: the four values the success criterion names, applied over the page's own styles
 * the way a reader's style sheet or bookmarklet does (`!important` on every element): line height 1.5 times the font
 * size, 2 times the font size after paragraphs, letter spacing 0.12 and word spacing 0.16 times the font size.
 */
export const TEXT_SPACING_CSS =
  "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } " +
  "p { margin-bottom: 2em !important; }";

export interface TextSpacingReport {
  viewport: number;
  scrollWidth: number;
  /** Text lines measured (a sanity check: a page with none was not measured at all). */
  lines: number;
  problems: string[];
}

/**
 * With TEXT_SPACING_CSS applied (and taken away again afterwards), "no loss of content or functionality": no visible
 * text is cut off by an ancestor that hides overflow (a fixed-height button, a clipped badge, an ellipsis), no line of
 * text overlaps a line of other text in the same layer (sticky and fixed parts, like the staff header, are their own
 * layer), and the page does not scroll sideways. Visually hidden text (sr-only, the skip link, the receipt code's
 * zero-width hyphen), form controls (which scroll their own text) and SVG labels (charts are aria-hidden pictures of
 * a table that is checked) are left out; a scroll container's content can be scrolled to, so it is not "cut off".
 */
export async function textSpacingProblems(page: Page): Promise<TextSpacingReport> {
  const style = await page.addStyleTag({ content: TEXT_SPACING_CSS });
  try {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
    });
    return await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      const scrollWidth = document.scrollingElement?.scrollWidth ?? document.documentElement.scrollWidth;
      const problems: string[] = [];
      const describe = (e: Element) => {
        const bits = [e.tagName.toLowerCase()];
        if (e.id) bits.push(`#${e.id}`);
        const cls = (e.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
        if (cls) bits.push(`.${cls}`);
        return bits.join("");
      };
      const snippet = (t: string) => {
        const s = t.replace(/\s+/g, " ").trim();
        return s.length > 40 ? `${s.slice(0, 40)}...` : s;
      };

      const hiddenMemo = new Map<Element, boolean>();
      const hidden = (el: Element | null): boolean => {
        if (!el || el === document.body || el === document.documentElement) return false;
        const known = hiddenMemo.get(el);
        if (known !== undefined) return known;
        let result: boolean;
        if (el.matches(".sr-only, .al-skip, [hidden], template, script, style, noscript, svg, input, textarea, select, option")) {
          result = true;
        } else {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const clipsSelf = cs.overflowX !== "visible" || cs.overflowY !== "visible";
          if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") result = true;
          else if (cs.clip === "rect(0px, 0px, 0px, 0px)" || /inset\(50%\)/.test(cs.clipPath)) result = true;
          else if (clipsSelf && (r.width <= 1 || r.height <= 1)) result = true; // sr-only patterns, zero-width joints
          else result = hidden(el.parentElement);
        }
        hiddenMemo.set(el, result);
        return result;
      };
      const layerOf = (el: Element): Element | null => {
        for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
          const pos = getComputedStyle(p).position;
          if (pos === "fixed" || pos === "sticky") return p;
        }
        return null;
      };

      /** The part of a line that can be seen: clipped to every ancestor that hides or scrolls its overflow. */
      const visiblePart = (el: Element, r: DOMRect): { left: number; right: number; top: number; bottom: number } | null => {
        let { left, right, top, bottom } = r;
        for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
          const b = p.getBoundingClientRect();
          const bl = b.left + p.clientLeft;
          const bt = b.top + p.clientTop;
          if (cs.overflowX !== "visible") {
            left = Math.max(left, bl);
            right = Math.min(right, bl + p.clientWidth);
          }
          if (cs.overflowY !== "visible") {
            top = Math.max(top, bt);
            bottom = Math.min(bottom, bt + p.clientHeight);
          }
        }
        return right - left > 0.5 && bottom - top > 0.5 ? { left, right, top, bottom } : null;
      };

      interface Line { node: Text; el: Element; layer: Element | null; r: DOMRect; v: ReturnType<typeof visiblePart> }
      const lines: Line[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const node = n as Text;
        if (!node.data.trim()) continue;
        const el = node.parentElement;
        if (!el || hidden(el)) continue;
        range.selectNodeContents(node);
        const layer = layerOf(el);
        for (const r of range.getClientRects()) if (r.width > 0.5 && r.height > 0.5) lines.push({ node, el, layer, r, v: visiblePart(el, r) });
      }

      // 1. Cut off: a line outside the client box of an ancestor that hides overflow, up to the first scroll container.
      for (const line of lines) {
        for (let p: Element | null = line.el; p && p !== document.body; p = p.parentElement) {
          const cs = getComputedStyle(p);
          const ox = cs.overflowX;
          const oy = cs.overflowY;
          if (ox === "auto" || ox === "scroll" || oy === "auto" || oy === "scroll") break;
          const clipX = ox === "hidden" || ox === "clip";
          const clipY = oy === "hidden" || oy === "clip";
          if (!clipX && !clipY) continue;
          const b = p.getBoundingClientRect();
          const left = b.left + p.clientLeft;
          const top = b.top + p.clientTop;
          const outX = clipX && (line.r.left < left - 1 || line.r.right > left + p.clientWidth + 1);
          const outY = clipY && (line.r.top < top - 1 || line.r.bottom > top + p.clientHeight + 1);
          if (outX || outY) {
            problems.push(`text cut off by ${describe(p)}: "${snippet(line.node.data)}"`);
            break;
          }
        }
      }

      // 2. Overlap: two lines of different text, in the same layer, drawn over each other (only the parts that can be
      // seen: a line scrolled out of a scroll container's view is not drawn there).
      const seen = lines.filter((l) => l.v);
      for (let i = 0; i < seen.length; i++) {
        const a = seen[i];
        const av = a.v!;
        for (let j = i + 1; j < seen.length; j++) {
          const b = seen[j];
          const bv = b.v!;
          if (a.node === b.node || a.layer !== b.layer) continue;
          const ix = Math.min(av.right, bv.right) - Math.max(av.left, bv.left);
          if (ix <= 2) continue;
          const iy = Math.min(av.bottom, bv.bottom) - Math.max(av.top, bv.top);
          if (iy <= Math.max(2, Math.min(av.bottom - av.top, bv.bottom - bv.top) * 0.25)) continue;
          problems.push(`text overlaps: "${snippet(a.node.data)}" (${describe(a.el)}) and "${snippet(b.node.data)}" (${describe(b.el)})`);
        }
      }

      if (scrollWidth > viewport) problems.push(`the page scrolls sideways (${scrollWidth}px in ${viewport}px)`);
      return { viewport, scrollWidth, lines: lines.length, problems: [...new Set(problems)].slice(0, 15) };
    });
  } finally {
    await style.evaluate((el) => (el as Element).remove()).catch(() => {});
  }
}

/** The page keeps all its text with WCAG 1.4.12 text spacing (see textSpacingProblems). */
export async function expectTextSpacing(page: Page, label: string): Promise<void> {
  const r = await textSpacingProblems(page);
  expect(r.lines, `${label}: text measured`).toBeGreaterThan(0);
  expect(r.problems, `${label}: text spacing (WCAG 1.4.12) at ${r.viewport}px`).toEqual([]);
}
