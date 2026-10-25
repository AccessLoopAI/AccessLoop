# AccessLoop Accessibility Conformance Report (self-assessed draft)

> **Self-assessed draft, October 21, 2026.** Written by the team that builds AccessLoop, from its own automated tests
> and code review. It is not an independent audit, and **nobody with a disability has tested AccessLoop with
> assistive technology yet**. Every criterion that needs that kind of testing says so: "Not yet tested with assistive
> technology by disabled testers". Tester sessions go into `docs/a11y-issues.md` (empty today), and this report is
> updated after them.
>
> Every claim below was checked against `main` once every Phase 7 track had been merged (the final docs pass).

## Product and scope

| | |
|---|---|
| Product | AccessLoop, the web app (local prototype; nothing is hosted yet) and the Expo reporter app in `mobile/` |
| Version | `main` after ae3bc60 (October 20, 2026): every Phase 7 Wave 1 track, the Expo app and the claude-cli fixes merged, plus the final docs pass |
| Pages covered | The reporter side (`/o/{org}/report`, the receipt, `/r/{code}`, `/r/t/{token}`, `/check`, `/help`), public pages (`/`, `/trust`, `/accessibility`, `/p/{org}`, published reports, `/verify`), the staff side (`/sign-in`, dashboard, inbox, case pages, Log feedback, reports, Outbox, eval, settings, My work) |
| Standards | WCAG 2.2 Levels A and AA; EN 301 549 V3.2.1 (2021-03), adopted in Canada as CAN/ASC-EN 301 549:2024, which references WCAG 2.1 for web content (clause 9) |
| Format | Modelled on the structure of an ITI VPAT (EN 301 549 edition): one row per criterion, a conformance level and remarks |
| Contact | <!-- TODO (team): an accessibility contact. --> The `/accessibility` page's "Tell us about a problem" link (into the demo organization's form for now) |

## How it was evaluated

| Method | What it covers | Where |
|---|---|---|
| axe-core, WCAG 2.0/2.1/2.2 A and AA rules (tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`) | Every page and every state the tests reach, in light and dark themes; a run with any violation fails | `e2e/helpers.ts` `expectNoAxeViolations`, used by 25 specs (for example `e2e/pages.spec.ts`, `e2e/demo.spec.ts`, `e2e/reporter.spec.ts`, `e2e/staff.spec.ts`, `e2e/dashboard.spec.ts`, `e2e/reports.spec.ts`, `e2e/verify.spec.ts`, `e2e/trust-accessibility.spec.ts`, `e2e/screenshots.spec.ts`) |
| Keyboard alone | The whole reporter flow and re-test, every missing answer, `/check` over its limit, the staff pages under the sticky header, a progress report written, signed off and published; Tab order, visible focus and focus never under the header at each stop | `e2e/keyboard.spec.ts`, checks in `e2e/a11y-checks.ts` |
| Reflow at 320 px | The 41 key screens of `e2e/key-pages.ts`, light and dark: no sideways page scroll; tables scroll inside their own region | `e2e/reflow.spec.ts` |
| Forced colours (simulated) | The same key screens with `forced-colors: active`: badges, marks, choice rows, footnotes, chart marks and focus keep an edge; axe again in that mode | `e2e/forced-colors.spec.ts` |
| Text spacing (WCAG 1.4.12) | Every key screen at 1280 px with the 1.4.12 spacing, in Chromium and WebKit: no text cut off or overlapping | `e2e/text-spacing.spec.ts` |
| WebKit (Safari's engine) | The reporter specs, the text-spacing check and the QR-poster link run a second time in WebKit | `playwright.config.ts` project `webkit` |
| Contrast | The token pairs in its table, both personalities and both themes: body text 7:1, other text 4.5:1, control boundaries and the focus ring 3:1; `npm test` fails below the minimum | `scripts/check-contrast.ts`, table in `components/ui/README.md` |
| Unit tests | Page rules (one h1, one "Get help", `lang="en"`, banned words) | `tests/public-info.test.ts`, `tests/error-pages.test.ts` |
| Expo app | Only the Expo **web** build, in a desktop browser at 320 and 375 px, light and dark, by hand and with a scripted Playwright + axe run | `mobile/A11Y-TESTING.md` |
| Code review by the build team | The criteria no tool checks (sequence, wording, sensory instructions) | The design-system rules in `components/ui/README.md` and `CLAUDE.md` "Accessibility contract" |

**Not done yet:** sessions with disabled testers; NVDA, JAWS, Narrator, VoiceOver and TalkBack; voice control
(Dragon, Voice Control, Voice Access); switch access; screen magnifiers; a real Windows contrast theme; browser and OS
zoom by a person; Firefox; Safari itself and any real phone or tablet. The CI workflow that runs the suite in
Chromium and WebKit (`.github/workflows/ci.yml`) has not run on GitHub yet; the results above come from local runs.

**Conformance levels used:** Supports; Partially Supports; Does Not Support; Not Applicable; Not Evaluated. "Supports"
here means "the automated and code evidence shows no failure", never that people have confirmed it.

## WCAG 2.2 Level A (EN 301 549 clause 9, same numbers)

| Criterion | Conformance | Evidence and remarks |
|---|---|---|
| 1.1.1 Non-text Content | Supports | axe; icons are `aria-hidden` next to visible text (`components/ui/Icon.tsx`); each chart is one `aria-hidden` SVG beside a real data table (`components/ui/charts/ChartFigure.tsx`, domain §10); the evidence chain drawing is `aria-hidden` and its table cell says the same in words (`components/ui/EvidenceChain.tsx`). Not yet tested with assistive technology by disabled testers. |
| 1.2.1 Audio-only and Video-only (Prerecorded) | Not Applicable | No audio or video content. |
| 1.2.2 Captions (Prerecorded) | Not Applicable | No video. |
| 1.2.3 Audio Description or Media Alternative (Prerecorded) | Not Applicable | No video. |
| 1.3.1 Info and Relationships | Supports | Native elements only: `<label for>`, `<fieldset>` + `<legend>` for radio and checkbox groups, `<table>` with `<caption>` and `<th scope>`, one h1 and h2 per section (`components/ui/RadioGroup.tsx`, `Table.tsx`, `Field.tsx`); axe. Not yet tested with assistive technology by disabled testers. |
| 1.3.2 Meaningful Sequence | Supports | DOM, Tab and visual order match, including the header on phones (`components/ui/README.md` "Layout"); Tab order asserted in `e2e/keyboard.spec.ts`. Not yet tested with assistive technology by disabled testers. |
| 1.3.3 Sensory Characteristics | Supports | Instructions name controls by their visible words, never by shape, colour or place (code review). Not yet tested with assistive technology by disabled testers. |
| 1.4.1 Use of Color | Supports | Status badges are words; redaction marks add a dashed underline and the `[TYPE]` text; chart marks repeat a table; forced-colours spec keeps every edge (`e2e/forced-colors.spec.ts`). Not yet tested with assistive technology by disabled testers. |
| 1.4.2 Audio Control | Not Applicable | No audio. |
| 2.1.1 Keyboard | Supports | `e2e/keyboard.spec.ts` (the reporter flow, re-test, staff pages, a whole progress report); native controls only; the one mouse-only shortcut (a click on a chart bar) repeats a link in the table. Not yet tested with assistive technology by disabled testers. |
| 2.1.2 No Keyboard Trap | Supports | No modals; the keyboard spec Tabs through to the last stop and back (`atLastTabStop` in `e2e/a11y-checks.ts`). |
| 2.1.4 Character Key Shortcuts | Not Applicable | No keyboard shortcuts: no key handlers in `app/` or `components/` (code search, October 20). |
| 2.2.1 Timing Adjustable | Partially Supports | Reporter side: no time limits; "Summarizing your report…" never times out; drafts are kept. Staff side: local sign-in ends 12 hours after signing in with no warning or way to extend (`lib/auth/local-session.ts`, frozen); forms say so and keep what was typed (`e2e/channels.spec.ts`, "a session that ended while typing"). The receipt page holds the code for at most 2 minutes and shows it once. Clerk session lengths are re-assessed at hosting. Not yet tested with assistive technology by disabled testers. |
| 2.2.2 Pause, Stop, Hide | Supports | Nothing moves or updates on its own; the one transition (the "Verified by reporter" moment) runs once, briefly, after the person acted, and not at all under reduced motion (`components/ui/StatusBadge.tsx`, `LoopTimeline`). |
| 2.3.1 Three Flashes or Below Threshold | Supports | Nothing flashes. |
| 2.4.1 Bypass Blocks | Supports | A skip link to `#main` on every shell (`components/ui/SkipLink.tsx`), checked in `e2e/keyboard.spec.ts`; header, nav, main and footer landmarks. |
| 2.4.2 Page Titled | Supports | Every page sets "{page} \| AccessLoop" (`app/layout.tsx` title template); axe `document-title`. |
| 2.4.3 Focus Order | Supports | Tab order asserted step by step in `e2e/keyboard.spec.ts`; after each step or submit, focus moves to the new heading (`components/ui/Heading.tsx`, `components/layout/RouteFocus.tsx`). Not yet tested with assistive technology by disabled testers. |
| 2.4.4 Link Purpose (In Context) | Supports | axe `link-name`; count links carry hidden words ("138 cases reported", `components/ui/charts/CountLink.tsx`); tile links name their tile; report footnotes are "Sources for this sentence (N records)". Not yet tested with assistive technology by disabled testers. |
| 2.5.1 Pointer Gestures | Supports | No multipoint or path gestures. |
| 2.5.2 Pointer Cancellation | Supports | Native buttons and links (activate on release); no pointer-down handlers (code search). |
| 2.5.3 Label in Name | Supports | Visible text is the accessible name or starts it; no `aria-label` where a visible label works (`CLAUDE.md` "Accessibility contract"). Voice control not tried. Not yet tested with assistive technology by disabled testers. |
| 2.5.4 Motion Actuation | Not Applicable | Nothing responds to device motion. |
| 3.1.1 Language of Page | Supports | `<html lang="en">` (`app/layout.tsx`, `app/global-error.tsx`; `tests/error-pages.test.ts`); axe `html-has-lang`. |
| 3.2.1 On Focus | Supports | Focus never submits, opens a window or navigates. |
| 3.2.2 On Input | Supports | No control submits or navigates when changed; the dashboard period applies with its button (`components/ui/SegmentedControl.tsx`). |
| 3.2.6 Consistent Help | Supports | "Get help" is the last item of the header's top row on every page (`components/layout/SiteHeader.tsx`); exactly one per page is asserted in `e2e/pages.spec.ts`, `e2e/trust-accessibility.spec.ts` and `tests/public-info.test.ts`. |
| 3.3.1 Error Identification | Supports | An error summary takes focus and links to each field; fields get `aria-invalid` and the error in `aria-describedby` (`components/ui/ErrorSummary.tsx`, `Field.tsx`); `e2e/keyboard.spec.ts` "a missing answer moves focus to it on every step". Not yet tested with assistive technology by disabled testers. |
| 3.3.2 Labels or Instructions | Supports | Visible labels and legends, hints joined by `aria-describedby`, no placeholder used as a label. Not yet tested with assistive technology by disabled testers. |
| 3.3.7 Redundant Entry | Supports | `e2e/pages.spec.ts` "Back, then Next keeps the review answer and the edited summary (WCAG 3.3.7)"; the form keeps its draft (`e2e/reporter.spec.ts`). |
| 4.1.1 Parsing | Supports | WCAG 2.2 removed this criterion (always met for HTML); listed because EN 301 549 V3.2.1 still has it. |
| 4.1.2 Name, Role, Value | Supports | Native elements; disclosures carry `aria-expanded` and `aria-controls`, toggles `aria-pressed` (`components/ui/Disclosure.tsx`, `Button.tsx`); axe. Not yet tested with assistive technology by disabled testers. |

## WCAG 2.2 Level AA

| Criterion | Conformance | Evidence and remarks |
|---|---|---|
| 1.2.4 Captions (Live) | Not Applicable | No live media. |
| 1.2.5 Audio Description (Prerecorded) | Not Applicable | No video. |
| 1.3.4 Orientation | Supports | No orientation lock; pages are checked at 390 px and 1440 px (`e2e/screenshots.spec.ts`). |
| 1.3.5 Identify Input Purpose | Supports | The reporter's email field has `autocomplete="email"` (`app/o/[orgSlug]/report/ReportFlow.tsx`); settings use `organization-title`, `street-address`, `tel`, `email` (`app/(staff)/app/settings/SettingsForm.tsx`); staff typing someone else's details get `autocomplete="off"`. Not yet tested with assistive technology by disabled testers. |
| 1.4.3 Contrast (Minimum) | Supports | `scripts/check-contrast.ts` (in `npm test`; body text 7:1) and axe `color-contrast` in light and dark. |
| 1.4.4 Resize Text | Supports | Type in `rem`; the 320 px reflow check stands in for 400% zoom. Checked by viewport emulation, not by a person zooming. Not yet tested with assistive technology by disabled testers. |
| 1.4.5 Images of Text | Supports | No images of text; all text is live text in local web fonts. |
| 1.4.10 Reflow | Supports | `e2e/reflow.spec.ts` over the 41 key screens at 320 px, light and dark; wide data tables scroll inside their own labelled region, as the criterion allows for tables. Not yet tested with assistive technology by disabled testers. |
| 1.4.11 Non-text Contrast | Supports | Control boundaries and the focus ring at 3:1 (`scripts/check-contrast.ts`); forced-colours spec keeps edges. |
| 1.4.12 Text Spacing | Supports | `e2e/text-spacing.spec.ts` in Chromium and WebKit over every key screen. Users' own style sheets and reading extensions not tried. Not yet tested with assistive technology by disabled testers. |
| 1.4.13 Content on Hover or Focus | Supports | No tooltips or hover pop-ups. On the staff dashboard (md and up) a chart's table is shown while keyboard focus is inside it, so a focused link is never invisible (`components/ui/charts/ChartFigure.tsx`); a person should confirm it hides nothing. Not yet tested with assistive technology by disabled testers. |
| 2.4.5 Multiple Ways | Supports | Header and footer links, `/help`, the staff navigation, dashboard numbers that open the filtered inbox, inbox filters. The four-step report form is a process (exempt). |
| 2.4.6 Headings and Labels | Supports | One h1 per page, an h2 per section or step, descriptive labels. "Step N of 4" inside the focused step heading. Not yet tested with assistive technology by disabled testers. |
| 2.4.7 Focus Visible | Supports | A designed focus ring; `focusState()` in `e2e/a11y-checks.ts` requires a visible indicator at every stop of the keyboard spec; in forced colours a chosen, pressed or open control with focus shows the full ring (`e2e/forced-colors.spec.ts`). |
| 2.4.11 Focus Not Obscured (Minimum) | Supports | `focusState()` fails when a sticky or fixed element covers the focused element; "staff pages with the sticky header: focus is never under it, going forward or back" (`e2e/keyboard.spec.ts`). |
| 2.5.7 Dragging Movements | Not Applicable | Nothing is dragged (no drag-and-drop anywhere, `CLAUDE.md`). |
| 2.5.8 Target Size (Minimum) | Supports | Controls are 44-52 px; axe `target-size`; stand-alone links measured at 44 px or more (`e2e/trust-accessibility.spec.ts`, `e2e/reports.spec.ts`); links inside sentences are exempt. |
| 3.1.2 Language of Parts | Partially Supports | French text a reporter typed is marked `lang="fr"` on the review step (`lib/intake/language.ts`, `e2e/reporter.spec.ts`); staff pages show reporter text without a `lang` mark yet. Not yet tested with assistive technology by disabled testers. |
| 3.2.3 Consistent Navigation | Supports | One header and one footer component on every page (`components/layout/`); the staff tab row is the same on every staff page. |
| 3.2.4 Consistent Identification | Supports | The same functions have the same names everywhere; footers asserted in `e2e/trust-accessibility.spec.ts` ("every footer links both pages by the same names"). |
| 3.3.3 Error Suggestion | Supports | Messages say how to fix the answer ("Enter an email address like name@example.com."). Not yet tested with assistive technology by disabled testers. |
| 3.3.4 Error Prevention (Legal, Financial, Data) | Partially Supports | The reporter checks everything on "Check your report" before "Send report". A re-test answer is one button with no undo by the reporter (a stale second answer changes nothing). Sign-off of a progress report states that it is final and needs every required check to pass, but has no separate confirmation step. |
| 3.3.8 Accessible Authentication (Minimum) | Supports | Reporters never sign in: the receipt code can be pasted, copied and downloaded; local staff sign-in is one button per person. Clerk's sign-in is re-assessed at hosting. |
| 4.1.3 Status Messages | Supports | One polite `role="status"` region on every page (`components/ui/StatusRegion.tsx`, mounted in `app/layout.tsx`), asserted by the page specs; AI output is never streamed into it. Not yet tested with assistive technology by disabled testers. |

Beyond AA, by design: body text at least 18 px with 7:1 contrast on the reporter side, one question per screen,
grade 6-8 reading level (not measured by a tool), and no CAPTCHA, modal, drag or timeout in the reporter flow.

## EN 301 549 clauses other than 9

| Clause | Conformance | Remarks |
|---|---|---|
| 4.2.1 Usage without vision | Partially Supports | Structure, names, focus and status messages as in clause 9. Not yet tested with assistive technology by disabled testers. |
| 4.2.2 Usage with limited vision | Partially Supports | Contrast, reflow, text spacing, forced colours as in clause 9. Not yet tested with assistive technology by disabled testers. |
| 4.2.3 Usage without perception of colour | Supports | 1.4.1 above. |
| 4.2.4 Usage without hearing / 4.2.5 Usage with limited hearing | Supports | No audio is needed anywhere. |
| 4.2.6 Usage with no or limited vocal capability | Supports | No voice input is needed; dictation is optional (the device's own). |
| 4.2.7 Usage with limited manipulation or strength | Partially Supports | Keyboard, 44 px targets, no gestures, drags or timeouts in the reporter flow. Not yet tested with assistive technology by disabled testers. |
| 4.2.8 Usage with limited reach | Not Applicable | No hardware. |
| 4.2.9 Minimize photosensitive seizure triggers | Supports | Nothing flashes. |
| 4.2.10 Usage with limited cognition, language or learning | Partially Supports | One question per screen, plain words, a review step, no time limits, drafts kept. English only (no French yet). Not yet tested with assistive technology by disabled testers. |
| 4.2.11 Privacy | Supports | No name or email is asked for: the follow-up question has no answer chosen for the person, and two of its three answers keep them anonymous (domain §4 step 3); the receipt code is the only thing to keep, and "My reports" in the app shows a code only after "Show my code". |
| 5 Generic requirements | Not Applicable, except 5.9 | No closed functionality, biometrics, physical keys or locking controls. 5.9 (simultaneous user actions): Supports, nothing needs two actions at once. |
| 6, 7, 8, 13 | Not Applicable | No two-way voice, video, hardware or relay services. |
| 10 Non-web documents | Partially Supports | Downloads are plain text (the receipt code, a report's plain-text export), JSON for software (the evidence bundle) and a calendar file without the code. Emails are plain paragraphs with full link text and a text version (`lib/email/templates.ts`); not tried in mail clients with a screen reader. Not yet tested with assistive technology by disabled testers. |
| 11 Software: the Expo app | Not Evaluated on iOS or Android | Native `TextInput`, so the system's own dictation can be used, `accessibilityRole`/`Label`/`Hint` on every control, focus moved to each step's heading, the system text size followed, 44 x 44 pt targets, Reduce Motion respected (`mobile/src/a11y.tsx`, `mobile/src/ui/`). Checked only on the Expo web build (axe clean on every screen and error state, 320 and 375 px). The VoiceOver and TalkBack script is `mobile/A11Y-TESTING.md`. Not yet tested with assistive technology by disabled testers. |
| 11.8 Authoring tools | Not Applicable | Staff text boxes produce plain text, not web content for others to author. |
| 12.1.1 Accessibility and compatibility features | Supports | `/accessibility` lists what is built in, how it is tested, what is not tested and the known problems (`app/accessibility/page.tsx`); `/help`. |
| 12.1.2 Accessible documentation | Supports | Those pages pass axe in light, dark and forced colours (`e2e/trust-accessibility.spec.ts`). The repository's Markdown docs are not evaluated. |
| 12.2 Support services | Not Applicable today | A prototype with no support desk. Reporters reach each organization through its own channels ("Other ways to reach {org}"). |

## Known problems that affect people

From `/accessibility` "Problems we know about" and `docs/decisions.md`: staff sign-in ends after 12 hours with no
warning (2.2.1); the receipt code can't be shown again later; with real AI the summary can take up to a minute
(nothing times out); some staff tables scroll sideways inside their own box on small screens; AccessLoop is in
English only. A progress report AccessLoop publishes must itself meet WCAG AA (ACR s.15(1)(a)): the published report
pages are inside the axe, keyboard, reflow and forced-colours checks above (`e2e/reports.spec.ts`,
`e2e/keyboard.spec.ts`), with the same "not yet tested with people" limit.
