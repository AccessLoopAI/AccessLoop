# AccessLoop design system

Every page is built from `components/ui/*` (primitives) and `components/layout/*` (shells). All visual
decisions live in **`app/globals.css`**, so a design change is a one-file change. See every component in
every state at **`/app/design`** (hidden staff page, not linked from navigation).

## Concept: the loop that closes

One ring recurs everywhere. An **open** ring (with a gap) means the loop is still open; a **closed** ring
means the person who reported the barrier confirmed the fix. Only that person closes it.

- Brand mark (`LoopMark`): a ring with a gap and an amber dot (the reporter) waiting in it.
- Case timeline (`LoopTimeline`): five ring segments that mirror the five stages; on "Verified by reporter" the gaps close into one green ring with a check (drawn once with `animateClose`; static under reduced motion).
- Dashboard tiles (`Stat` + `ProgressRing`): a fraction as a ring; a full ring becomes the closed loop.
- Status icons: `LoopClosedIcon` = "Verified by reporter", `LoopOpenIcon` = "Fixed, not verified by reporter".

Rings are always decorative (`aria-hidden`): the same facts are in text next to them.

## Two personalities, one system

| | Reporter (default, `:root`, `ReporterShell`) | Staff (`data-personality="staff"`, `StaffShell`) |
|---|---|---|
| Feel | Calm, warm paper, one centred column (about 62ch) | Command centre: ink top bar, wide grid, crisp tables |
| Body | 18px (the floor), line-height 1.6; hints 16px; h1 30-42px | 16px, line-height 1.5, small text 14px; h1 24-30px |
| Controls | 48px tall (large 52px), 24px radios/checkboxes | 44px tall (large 48px) |
| Motion | Nothing moves unless the person acted | Same rule; the verified moment is the one flourish |

Personality tokens (`--body-size`, `--control-h`, `--measure`, `--stack`, `--card-pad`, ...) switch with the
attribute, so the same component is bigger on the reporter side without any prop. A `data-personality="reporter"`
panel can be nested inside a staff page (the design page does this).

## Tokens (CSS variables, mapped to Tailwind utilities with `@theme`)

Tailwind's default palette, fonts, text sizes, radii and shadows are **reset**: only token utilities exist.

- **Colour** (`bg-*`, `text-*`, `border-*`): `bg`, `surface`, `surface-raised`, `surface-sunken`, `ink`, `ink-muted`, `border` (decorative hairline), `border-strong` (control edges, at least 3:1), `primary` / `primary-hover` / `on-primary` / `primary-soft`, `link` / `link-hover`, `accent` (decorative amber) / `accent-soft` / `accent-ink` (amber text), `chart-1` / `chart-verified` (dashboard chart marks only, never text: lighter than `primary` / `success` so they pass the dataviz lightness band and colour-blind separation checks, and 3:1 on cards), `info|success|warning|danger` each with `-bg` and `-border`, `danger-hover` / `on-danger`, `focus` / `focus-halo`, `redact-bg|ink|border`, `selection`, `chrome-bg|ink|muted|border|focus|focus-halo` (header), and one pair per case status: `status-{new,triaged,assigned,retest-open,verified,fixed-unverified,closed}-{fg,bg}`.
- **Type**: `font-sans` (Atkinson Hyperlegible Next), `font-display` (Besley), `font-mono` (Atkinson Hyperlegible Mono). Sizes `text-small`, `text-body`, `text-lead`, `text-h4..text-h1` (personality-aware), `text-card-title` (a Card's h2: the h3 size for reporters, 18px for staff, so it sits a step above the 16px bold field labels), `text-display`, `text-stat`, `text-code` (fluid; `text-code-narrow` below sm, so the receipt code stays on one line on a 360px+ phone), and `text-ui-sm|ui|ui-lg` (fixed, for the header). h1/h2 default to Besley, h3/h4 to Atkinson bold. `.al-subhead` is the staff sub-heading inside a card (the task in "Next step", the parts of the report and of the redaction review, "Other ways to reach you" in Settings): small caps (glyphs only, so screen readers get the words as written), bold, muted. `.al-question` (`--question-size`: 20px reporter, 16px staff) is a question that is not the step's heading: Field labels and RadioGroup/CheckboxGroup legends, so "Is this right?" reads a step above its bold answer rows.
- **Radius**: `rounded-xs|sm|md|lg|xl|pill` (controls `md`, cards `lg`, the receipt ticket `xl`, badges `pill`).
- **Elevation**: `shadow-1|2|3`, tinted with the ink colour. Use `shadow-2` for the one thing that matters in a view, not on every card.
- **Motion**: `--dur-instant|quick|moderate|slow|loop`, `--ease-out|in-out|loop`. All motion is declared under `prefers-reduced-motion: no-preference`, and a global reduce rule stops anything left over.
- **Publication** (Phase 4 report): `--report-measure`, `--report-body-size`, `--report-body-leading`, `--report-h1-size`, `--report-h2-size`; a minimal `@media print` base is in place.

Themes follow the system (`prefers-color-scheme`); there is no toggle (docs/decisions.md).

## Focus, forced colours, reflow

- Focus ring: a 3px ring in `--focus`, 2px off the element, wrapped in a contrasting `--focus-halo` (indigo on amber in light, amber on ink in dark) on every link, button (all variants, pressed answers included), text input, textarea, select and choice row; radio and checkbox rows show it on the whole row. The halo is a box-shadow, so anything that sets its own box-shadow must re-add it: `.al-control:focus-visible` does in `app/globals.css`, and buttons carry it as a ring utility (`button-styles.ts`), which Tailwind composes with `shadow-*`.
- Programmatic focus targets (`tabindex="-1"`): h1-h3 (page and step headings) get a 2px ring offset 6px and no halo, and always carry `padding-bottom: 0.15em` so Besley's descenders sit inside the ring (it ran through the "y" of "We got your report"); `main` (the skip link's target) shows no ring; `ErrorSummary` keeps the full 3px ring, and so does any focus target whose child is a `Notice` (`[tabindex="-1"]:has(> .al-notice)`: /check's "We could not check your code", the report form's preview and send errors, `ActionFeedback`'s result line). To move focus to a message, wrap the `Notice` in a `div tabIndex={-1}` and the ring comes with it.
- Date inputs (`type="date"`) keep the ring through `:focus-within`: the calendar button is a Tab stop inside the input (the browser's own shadow DOM), and while it has focus the input no longer matches `:focus-visible`.
- Checked by `e2e/keyboard.spec.ts` (the whole reporter flow and re-test by keyboard alone, with the Tab order, step titles and kept answers; every missing answer on the form, the review, /check and the re-test, where focus must land on the field, first option or error summary; /check over its limit, where focus lands on a notice with the ring; the skip link; and the staff pages under the sticky header, forward and back, up to "Generate draft" and a draft's "Sources for this sentence" footnote; then a report written part by part, signed off and published, a footnote on its public page, and its /verify as the lead and as anyone), `e2e/reflow.spec.ts` (320px) and `e2e/forced-colors.spec.ts` (badges, marks, choice rows, pressed answers, buttons, report footnotes, hash and filter chips keep an edge; an open footnote and its Sources card stay framed; the period segments keep their frame and the chosen one its fill; chart marks stay drawn, the verified series apart; the staff nav's current-tab bar stays visible; focus is an outline, and on a chosen, pressed or open control the full ring, not only its frame), with the checks in `e2e/a11y-checks.ts`. The last two walk the screens listed in `e2e/key-pages.ts` (every screen `e2e/screenshots.spec.ts` shoots except /app/design, plus step 3 with its errors, the review with "Change it" open, a filtered inbox, a draft and a published report with a footnote open, and /verify intact and tampered among them): add a new key screen there.
- Text spacing (WCAG 1.4.12): `e2e/text-spacing.spec.ts` sets line height 1.5, paragraph spacing 2, letter spacing 0.12 and word spacing 0.16 (with `!important`, as a reader's style sheet does) over every key screen at 1280px, in Chromium and WebKit, and fails on text cut off by a box that hides overflow, a line of text drawn over another, or a sideways scroll (`textSpacingProblems()` in `e2e/a11y-checks.ts`). So text boxes take `min-height`, never a fixed `height`, and `overflow: hidden` is only for visually hidden text or boxes whose text can't grow out of them.
- `scroll-padding-top` keeps focus clear of the staff header, which is sticky only from 64rem up (never at high zoom). It uses `--header-h`: `StickyHeaderOffset` (components/layout) sets it to the header's measured height, so a long name that wraps the header never hides focus; the CSS fallback is the two-row staff header (6.625rem).
- `@media (forced-colors: active)`: borders, badges, chips, rings and the focus ring switch to system colours (CanvasText, Highlight, ButtonText); icons use `currentColor`; no state depends on background colour alone. A state drawn as a Highlight frame (a chosen choice row, a pressed button, an open footnote) would hide the focus ring, which is Highlight too: the 3px ring 2px off is restated for those states with focus (the frame's selectors are the more specific ones, or come first).
- Reflow: nothing scrolls the page sideways at 320px; tables scroll inside their own focusable, labelled region, with a soft shadow on the side where more columns are. Text that can hold a long unbroken token (an email, a file name, a link) uses `wrap-anywhere`, not `break-words`: `overflow-wrap: break-word` does not lower an element's min-content width, so in a grid or table track the token still widens the page (`RedactedText` and the case page's details already do this). A column of sentences (a summary, an email) is `min-w-[min(15rem,calc(100vw_-_9.25rem))] sm:min-w-[18rem]`: below sm it takes what is left beside a reference-wide row header (`BAR-0012`), so it sits beside it on a 390px phone and still at 320px, and only the short columns need a sideways scroll; put the column a person acts on ("Show the email") right after the row header. The case tables (Inbox, My work) show the status at the top of the Summary cell below sm (a `StatusBadge copy`, with the Status column `hidden sm:table-cell`; under the reference it stacked word by word) and their rows are top-aligned there. The caption's lines wrap within the visible part of the region.

## Components

| Component | Use it for | Accessibility notes |
|---|---|---|
| `Button` (client) | Every `<button>`. Variants `primary`, `secondary`, `quiet`, `danger`, `chrome` (on the header's own background: "Sign out"); sizes `md`, `lg`; `iconStart`/`iconEnd` | `type` defaults to `"button"`. `pending` (or `useFormStatus` for `type="submit"` in a `<form action={fn}>`) keeps the label and name, shows a spinner, sets `aria-disabled` and swallows further clicks. Prefer errors after submit over `disabled`. Toggle buttons pass `aria-pressed` ("Show as table"); forced-colors mode frames the pressed one. A single choice between answers is a `RadioGroup`, never pressed buttons (the reporter review's "Is this right?" since Phase 7) |
| `ButtonLink` | A link styled as a button (navigation, `download` links) | Navigates only. `download` or `plain` renders a plain `<a>` |
| `Field`, `TextField`, `TextareaField`, `TextInput`, `Textarea` | Text inputs with label, hint, error | Visible `<label for>`; hint and error joined in `aria-describedby`; `aria-invalid` on error; `required` sets `aria-required` (no native bubbles). `labelHeading` puts the label in an h2/h3 when the field is the step's question; `headingPrefix` adds text inside that heading but outside the `<label>` (the report form's visually hidden "Step 1 of 4: "), so the heading says it and the field's name stays the question |
| `Checkbox` | One checkbox as a whole clickable row | Native input with `accent-color`; hint outside the label (name stays exact); `stretch` fills its grid row (CheckboxGroup's two columns), so tiles side by side end on one line |
| `CheckboxGroup` | Several checkboxes answering one question ("Areas in your accessibility plan") | `<fieldset>` + `<legend>` (the group's name); one shared `name`, so `FormData.getAll(name)` lists the ticked values; hint and error on the fieldset (`aria-describedby`); option ids `${id}-${i}` (link an ErrorSummary line to `${id}-0`); `columns="two"` from `md` |
| `RadioGroup` | Radio questions | `<fieldset>` + `<legend>` (its name for `getByRole("group")`); `legendHeading` for the step's h2, otherwise the legend is `.al-question`; `headingPrefix` (with `legendHeading`) adds text the heading reads before the question ("Step 2 of 4: ") while the group is named by the question alone (`aria-labelledby`); option `hint`s via `aria-describedby` (the group's `hint` can hold a second block, like /r/'s offer line under the question); option `conditional` content shows under the selected option (CSS only); `layout` `stacked` (default; options with hints or conditional content), `inline` (Yes / No side by side from sm) or `grid` (one-word options, two to a row from sm, three from lg: Log feedback's channel); controlled (`value`/`onChange`) or uncontrolled (`defaultValue`) |
| `Select`, `SelectField` | Native `<select>` | Chevron is an aria-hidden icon; `placeholderOption` adds an empty first option |
| `Table`, `THead`, `TBody`, `Tr`, `Th`, `Td` | Every data table (inboxes, queues, the Outbox, chart data) | Required `id` and `caption`; wrapped in `role="region"`, `tabIndex=0`, labelled by the caption; `Th scope="col"` or `"row"`; `numeric` right-aligns with tabular numerals; a link alone in a cell gets a 44px target. The `<table>` is `position: relative`, so VisuallyHidden text in a cell stays inside the scroll region (it once widened the page at 390px). The caption wraps at `100vw - 5rem` (the visible part on a phone) |
| `StatusBadge` | Case status | `wording="staff"` or `"reporter"`, `closedReason` for "Closed: {reason}". Text content is exactly the label, so put `data-testid="case-status"` on it or its parent. `celebrate` plays the arrival once. `md` stays on one line from sm (a table column grows to fit "Waiting for the reporter to check"); below sm it may wrap, as a soft rectangle (`rounded-lg`, a pill on one line) with balanced lines and the icon on the first. `size="lg"` wraps below sm the same way (never smaller text). `copy` drops `data-status` from a second copy shown at another width (hide one of the two at every width) |
| `Card` | Grouped content | With `as="section"`, `id` and `title`, it is a named region (e.g. "Your words", "History") |
| `PageHeader` | The page's h1 with eyebrow, description, meta, actions | Always level 1 on pages; `focusOnMount` for pages reached by a submit (receipt) |
| `Heading` (client) | A heading that takes focus | `focusOnMount`, `focusKey` (refocus when it changes, e.g. the step number), `focusable`; never in the Tab order |
| `Disclosure` (client) | "What is this?", "Sources for this sentence (N records)", FAQ rows | `<button aria-expanded aria-controls>`; closed content is `hidden`. `variant="footnote"` keeps a 44px hit area. The footnote wrapper is a `<span>`: put sentences with list panels in a `<div>`, not a `<p>` |
| `SourceNote`, `SourcesProvider` (client) | Every generated report sentence (the staff draft and the public report): the sentence, then its footnote button and "Sources" card | The button's visible text IS its name, exactly "Sources for this sentence (N records)" ("1 record"; "0 records" opens a line saying there is nothing to list); `aria-expanded` + `aria-controls`; the card is `hidden` while closed and its list (`aria-labelledby` a "Sources" label) is only rendered when open, so a sentence citing hundreds of cases costs nothing until asked. `SourcesProvider` holds the report's records once (`linkBase` on staff pages: each ref is a link "Open BAR-0012"; public pages: plain text). Wide report column (container query on `.al-report`, 50rem): button and card sit in the margin beside the sentence with a dotted thread; narrow: under it. A list over 8 records scrolls inside the card (focusable when it has no links). Print shows "Sources: BAR-..." instead |
| `CheckRing` | The state of a check in "Report checks" (and the reports list) | Decorative SVG (`aria-hidden`), always next to the state in words: closed ring + tick = passed, ring + cross = missing, open ring with the amber dot = still to write (the loop motif). On a just-built draft (`[data-building]`) the ring and tick draw themselves with their row's `--i` (never under reduced motion) |
| `LoopTimeline` | The five-stage loop of a case | Ordered list; state in text (", done", ", in progress", ", not yet") and `aria-current="step"`; the decorative ring always sits beside the list (56px in a narrow container, 88px from `@sm`), never alone above it; ring segments: done = thick primary, in progress = amber, not yet = a thin solid grey arc (a dotted one read as a loading spinner); `closed` + `animateClose` for the verified moment; `unchecked` for a fix the reporter did not check (stages 1-4 done, the last one says "not checked by the reporter" / "not checked by you", nothing in progress). Never pick `current` by hand: spread `loopState(status, wording)`, the one mapping. Staff (the stage the case is at): new 0, triaged 1, assigned 2, retest_open 4, fixed_unverified 4 unchecked, verified closed. Reporter (the step being worked on; their own step is done once sent): new 1, triaged 2, assigned 2, retest_open 4, fixed_unverified 4 unchecked, verified closed. Closed cases have no loop (`null`). Reporter stage names are tense-neutral ("A team reads it") so they read right in every state |
| `HistoryTimeline` | A case's event history | Ordered list with `<time dateTime>`; every event is a filled 12px dot on one thread (all of them happened: a hollow ring read as "not done"), coloured only by `tone` for the events worth spotting; wrap in `<Card as="section" id="history" title="History">` |
| `FilterSummary` | The filters a list is narrowed by (the inbox reached from a dashboard number), as text chips, with one "Clear filters" link | A `<section>` named by its heading (default "Filters", `titleLevel` 2 or 3); the summary line and chips are plain text, not a live region (a new filter is a new page load, and focus goes to the h1); chips wrap anywhere at 320px and keep a border in forced-colors mode (`al-chip`) |
| `DueDate` | A case's due date in a queue (the inbox's "Assigned to" cell, My work's "Due" column) and on the case page (decision D8) | The state in words with a decorative icon, never colour alone: "Overdue" (bold, `text-danger`) with "Was due … (N days ago)" under it, "Due today" (bold), "Due Nov 3, 2026" with "In N days"; the date is a `<time dateTime>`. Pass `dueState(status, dueAt, now)` from lib/metrics/queue.ts: only an assigned case has one, and `{ kind: "none" }` renders nothing |
| `Stat` | Dashboard metric tiles | Heading + text, never an image. "What is this?" carries the tile name for screen readers; the link names its tile too ("See the cases for {title}"). `unit` follows the value after a real space ("16 of 22", "14 days"); the value uses proportional figures. `children` holds a breakdown list with its own links; `testId` names the tile for e2e |
| `SegmentedControl` | A short single choice drawn as one row of segments (the dashboard's period) | Native radios in a `<fieldset>` + visible `<legend>`; arrow keys move; nothing submits on change (the form's button does, WCAG 3.2.2). The input covers its segment (opacity 0), the label shows the state: filled AND framed when chosen; focus ring on the segment; 44px targets; forced-colors uses Highlight. One option may `reveals` extra content (the custom dates), shown with `:has()` while chosen, so it works without JavaScript. Colours live in CSS (`.al-segment-label`), not utilities, so the chosen state wins |
| `DeadlineBanner` | The dashboard's next-deliverable line (domain §1.5) | One `<p>`: "{what}: {when}" (the colon is visually hidden, the layout shows the gap), so it reads as domain §10's sentence. Not a Notice and not a live region. `urgency` soon/past turns the icon disc to the warning tone; the words say it too |
| `charts/ChartFigure` (client) | The frame of every dashboard chart: the ONLY chart pattern (domain §10) | h2 title, description, a "Show as table" toggle (`aria-pressed`; accessible name "Show as table ({title})"), the picture, the table, an optional `aside` (the takeaway in words). The picture is ONE `<svg aria-hidden="true">` with no links, tabindex, `<title>` or `<desc>`. The table is always in the DOM: from md up it is visually hidden until the toggle is pressed **or keyboard focus enters it** (so a focused link is never invisible); below md (phones, 200%+ zoom) the table is shown and the picture and toggle are not |
| `charts/FunnelChart`, `charts/MonthlyChart`, `charts/BarChart` (client) | The loop funnel (columns joined by bands), received vs verified per month (paired columns on ONE count axis, legend inside the SVG), horizontal bars (label above each bar, count at the tip, zero as a stub, `tone="muted"` for "Not classified yet") | Marks wear `--chart-1` / `--chart-verified` / `--border-strong`; text wears ink tokens; 4px rounded data end, square baseline, 2px gap between paired columns; solid hairline grid. Each SVG has a fixed `viewBox` and `max-width` equal to it, so text never scales up. A click on a bar is a plain `onClick` that repeats the table link (`router.push`). Values come in as `ChartValue { count, href, sr }` built from lib/metrics CaseSets |
| `charts/CountLink` | A count in a chart table | The number, a link to `href` (44 x 44 px, right-aligned), with hidden words after it ("138 cases reported") so a link list makes sense; a zero is plain text (nothing to open) |
| `EmptyState` | Empty lists | Say what will appear and offer one action |
| `Notice` | Inline info/success/warning/danger messages | **Not** a live region. Title is a `<p>` unless `titleAs` gives a level; without a title a hidden "Warning:" style prefix is read |
| `OnThisPage` | The contents of a long reading page (/trust, /accessibility) | A `<nav>` named by its visible h2 "On this page"; one `#id` link per section in reading order, each a 44px row (not an inline link); two columns from sm. Never a "Get help" link |
| `StepList`, `StepListItem` | A real sequence the reader follows (the path a report takes on /trust) | Ordered list; the number is drawn in a decorative disc and read as "Step N:" at the start of each step's h3 (a styled list can lose its numbering for screen readers). Not for content that isn't a sequence |
| `MarkedList` | A list whose marker says what kind of items it holds: `done`, `not-yet`, `known-issue` (/accessibility) | The icon is decorative and the same for every item; the list's heading says what the items are, never the icon or its colour alone |
| `ReadingSection` | One part of a long reading page (/trust, /accessibility): `<section id>` + its h2, the target of an `OnThisPage` link | Not a named region (no `aria-labelledby`), so a dozen sections add no landmark noise and never collide with an e2e name; the h2 is the way in |
| `BulletList` | Plain bulleted points in reading text | Native `<ul>` with CSS discs (still announced as a list); children are `<li>`. Use `MarkedList` when the marker means something, `StepList` for a sequence |
| `Quote` | Words quoted from a source, set apart (the ACR s.19 rule on /trust) | `<figure>` + `<blockquote cite>` + `<figcaption>` with the source link (a 44px target: it is not inside a sentence); curly quotation marks around the words, so the quote is marked in text and not by the rule alone. Legal text is copied from docs/domain.md §1, never paraphrased |
| `TextSpecimen` | A made-up report text at one stage, with a caption ("After the rules"; /trust's worked example) | `RedactedText` inside, so `[TYPE]` labels look as staff see them. Never real report text |
| `ActionFeedbackProvider`, `useFormAction()`, `fieldErrorItems()` (client) | Staff forms that call a server action without a page load (case steps, Settings, Log feedback, a report's text boxes and sign-off) | One result line per page where the provider sits (put it right under the page header): shown, focused and announced; `placement="after"` + `focusResult={false}` for a small form inside a long document (a report section's text box: the line appears under its button and focus stays on the button); `testId` names it (`case-action-result`, `settings-result`, `intake-result`). Field errors come back to the form (ErrorSummary + fields, nothing typed is lost); `quietSuccess` when the form shows its own success view (Log feedback's confirmation; it also clears an earlier failure line). A session that ended says so (`lib/auth/signed-out.ts`: proxy.ts answers a server action with no session in words) and keeps what was typed. The case page uses it through `CaseFeedback.tsx` |
| `StatusRegionProvider`, `useAnnounce()`, `Announce` (client) | Announcing changes | The ONLY `role="status"` on any page (mounted in `app/layout.tsx`). Visually hidden, so show the message visibly as well. `<Announce message>` announces a server-rendered result after a POST. Never stream AI output into it |
| `ErrorSummary` (client) | Top-of-form errors after submit | Takes focus when errors appear (it can stay rendered with an empty list) and again whenever `focusKey` changes: pass the action state's `at`, so a second failed submit refocuses it. Links focus the field (link to the first radio's id, `${groupId}-0`, for radio groups) |
| `StepIndicator` | "Step 2 of 4" | Real text; the bar is decorative. `inHeading` hides it from screen readers when each step's heading already starts with a visually hidden "Step N of 4: " (the report form), so it is read once |
| `CodeDisplay` | The receipt code | Put `data-testid="receipt-code"` on it: its text is exactly the code (no spaces); one line from about 360px (`text-code-narrow` below sm), wraps at hyphens below that. `codeId` sets the id of the code element (the receipt's "Copy code" fallback selects it). `halves`: two groups of eight on two lines at every size (the receipt and /help's example); the middle hyphen stays in the text as screen-reader text and the break is CSS (`.al-code-break`), so the text is still exactly the code. `reading` is a line under it (the spelled-out code). The actions row is never printed (`data-print-hide`) |
| `QrCode` | A QR code drawn on the server (`lib/locations/qr.ts` `qrDrawing(text)`, the `qrcode` package): the location posters (Phase 7 T4.5) | `<svg role="img" aria-label>` with ONE `<path>` (no injected markup); black on white with the quiet zone in every theme and in forced-colors mode (`.al-qr`: `forced-color-adjust: none`, a reader needs dark on light). Never a link or a button; always print the address it opens next to it as text, for people who can't scan |
| `HashChip` | Short hashes in the evidence chain | Shows the first 8 characters (`length`); screen readers get "label: full hash"; `tone="danger"` for a broken link, `"muted"` (dashed) for a record nobody can vouch for or one written later; `decorative` drops the screen-reader text inside a drawing that is aria-hidden as a whole |
| `EvidenceChain` | One case history on /verify (signature moment 3): a genesis dot, then one 6-character chip per record, each joined to the one before it | The whole `<ol>` is `aria-hidden`: the "Records" table cell beside it says the same in words (and the plain explanation of a break). `state` per link: `ok`, `broken` (thick red dashed link, broken-link icon, "Broken here", danger chip), `unchecked` (after a break: dotted, muted); `head` rings the last record the report saw ("In this report"); `after` dashes records written later. Links draw in once from the left (transform only, staggered, under 1 s; never under reduced motion); forced colours keep dashes, icon and words. It wraps inside its cell; the table's own scroll region handles 320 px |
| `RedactedText` | Redacted case text and summaries (`cases.redactedText`, `aiSummary`, `locationDetail`) | Wraps each `[TYPE]` token in `<mark class="al-redact">` (colour + dashed underline + the token text, never colour alone); renders a `<p>`, or a `<span>` with `as="span"` for a piece inside a sentence (the redaction review's context lines, a History body). `wrap-anywhere`, so a long surviving token wraps at 320px. Never pass original text |
| `VisuallyHidden`, `SkipLink` | Screen-reader text; the skip link | The skip link targets `#main`; every shell renders `<main id="main" tabIndex={-1}>` |
| `Icon` | lucide-react or loop icons | Always `aria-hidden`, `currentColor`, sized in `em` |
| `LoopMark`, `SegmentRing`, `ProgressRing`, `LoopOpenIcon`, `LoopClosedIcon` | The loop motif | Decorative SVG only. `ProgressRing`: `strokeWidth` (5 for tiles, 3.6 for the dashboard's headline), `hollow` (no check mark: text sits in the centre), `animate` (the headline draws its arc once on load; nothing moves under reduced motion) |

Layout: `SiteHeader` (top row: brand, optional org name, then the utility slot; **"Get help" to /help is always the last
item of the top row**, top right, the only "Get help" on a page; with a nav slot the navigation is a second row of tabs
under it, in the DOM after "Get help", so the header never wraps into an uneven shape however many sections a role has;
on phones the organization sits under the brand with no separator rule, the reporter's "Get help" stays beside the brand,
and the staff person has a line of their own under the organization with "Sign out" and "Get help" under it at the right,
with nothing reordered: DOM, Tab and visual order match), `SiteFooter` (on every page: "Privacy and AI" to /trust and "Accessibility" to /accessibility, after
any `links` the shell adds, like the reporter's "Check your report"; never "Get help"), `ReporterShell` (`orgName`, `orgSlug`, `width="form"|"wide"`; with `orgSlug` the footer also links the organization's page "{org}: accessibility feedback" to /p/{slug}, and "Get help" and "Check your report" carry `?org={slug}`), `OrgContacts` (`OtherWaysToReach`: the "Other ways to reach {org}" disclosure with the phone, email, mail and /p link; `OrgContactList`, `OrgPageLink`), `OrgContext` (the organization of `app/o/[orgSlug]/layout.tsx`, for the error page under it), `StaffShell` (`orgName`,
`userName`, `userRole` (shown from sm), `nav`, `signOut` slot; no nav items, no tab row: the sign-in page), `StaffNav`
(the tab row; on phones an even grid of tabs, four to a row at 390px, instead of a ragged wrap into three rows; `aria-current="page"` plus a bar on the header's bottom edge that stays visible in forced-colors mode; a
page in a tab's `section`, like a case page under the Inbox or the owner's My work, or a report's `/verify` under Reports, marks that tab `aria-current="true"`
with the same bar; `staffNavCurrent` in `staff-nav-current.ts` decides), `StickyHeaderOffset` (keeps `--header-h` equal
to the sticky header's real height).
`RouteFocus` (mounted once in `app/layout.tsx`, inside `<Suspense>`) moves focus to the new page's h1 after every client-side navigation, including a server action's redirect (sign-in, the receipt) and a change of the query string alone (the inbox's "Clear filters"); a fresh page load keeps the browser's focus. Pages keep their h1 in `PageHeader` (focusable, tabindex -1).
Error pages: `app/error.tsx` (inside the root layout, reporter shell), `app/(staff)/app/error.tsx` (inside the staff shell) and `app/global-error.tsx` (replaces the root layout, so it brings its own `<html lang>`, `<title>`, fonts and shell). None of them shows the error's message.
`SignOutForm` is the one sign-out control for StaffShell's `signOut` slot (a plain POST form to `/sign-out`; one per page).
The `(staff)` layout already wires StaffShell from `requireStaff()` (lib/auth/staff.ts): pages under `app/(staff)/app/` only call `requireStaff([roles])` and render their content.

## Rules for pages (they keep e2e/demo.spec.ts passing)

- Exactly one `<h1>` and one `role="status"` per page; no `<output>` elements.
- Accessible names used by the e2e must match one element only (Playwright matches substrings). Do not give
  table regions, cards or disclosures names that contain "Your words", "We understood", "Redaction review",
  "Original report", "History", "Report checks", "Feedback", "Records" or "Sources" unless they are that element.
  On the staff case page also keep unique: one button containing "Assign" (never "Reassign"/"Unassign"), "Show original",
  "Approve redaction", "Save triage", "Log fix"; the text "Acknowledged on screen" once (the History says "Acknowledgement
  shown on screen"); and no "checked by reporter" outside the loop timeline (pages.spec finds the loop list by it).
  The case page's acknowledgement and reminder steps are "Send acknowledgement email", "Record acknowledgement" (with
  "I acknowledged by phone/by mail/in person/another way/by email on", domain §4's wording) and "Send a reminder email": none of them
  contains a protected name, and none says "acknowledged on screen".
- The dashboard (e2e/dashboard.spec.ts): the web form's daily cap line under the deadline banner is
  `data-testid="intake-cap"` (`app/(staff)/app/dashboard/IntakeCap.tsx`: a muted line, a warning Notice once the cap is
  reached); tiles are `data-testid="tile-…"`; chart toggles are "Show as table ({chart title})";
  chart table captions start with their chart's words ("The loop funnel: …", "Cases received and verified by the reporter,
  per month", "Barriers by priority area (…)", "Cases received by intake channel (…)") and never contain "Feedback",
  "Records" or "Sources". The two report cards (`app/(staff)/app/dashboard/ReportCards.tsx`, handoff Phase 5 item 3):
  `report-readiness` shows the newest report for exactly the selected period (`ReportStateBadge`, its title linking to
  it as `readiness-report`, `readiness-checks` = the report page's "Report checks" first line re-run by
  `lib/report/readiness.ts`, `readiness-next`) or "No report for this period yet" (`readiness-none`), and the lead's
  one "Generate report" link to `/app/reports/new?start=&end=` (auditors get a line instead); never a "New report" link
  (that name is /app/reports'). `evidence-integrity` links "Open the evidence check" (plus a hidden " for {title}") to
  the org's latest report's /verify (`integrity-latest`), or says "No progress report exists yet, …"
  (`integrity-no-report`); never "Verify evidence chain" (the report pages own that name). The clause 17 panel
  (`./Clause17Panel.tsx`, Phase 7) is the region "CAN-ASC-5.2.1, clause 17: what your records show": four numbered
  steps (h3 "Step N: Receive" ...), no table, links "See the cases for clause 17: {step}" (unique on the page).
- /verify (Phase 4): one h1 "Evidence check"; the status line shown visibly (`data-testid="evidence-line"`) and announced only through the global StatusRegion (`<Announce>`); exactly one table whose name contains "records" (caption exactly "Records", no description inside the caption) with one `<tr>` per cited case; no link named "Verify evidence chain" (the report pages own that name).
- Report pages (Phase 4): exactly one region whose name contains "Feedback" (the Feedback section; its h3s are plain
  headings, and no table caption, card or aside elsewhere may say "feedback"; the one exception is the benchmark card
  `components/benchmark/FeedbackBenchmarkCard.tsx`, "How your Feedback section compares", a plain `<div>` that is
  never a region, shown only once a person verified benchmark rows), one region "Report checks" (not a live
  region), exact h2 texts (General, each plan area's canonical heading, Consultations, Feedback), one link "Verify
  evidence chain", and one "New report" link on /app/reports (the lead's header action; the empty state has none). A draft's note
  links "Go to the report checks" at every width: the checks and sign-off follow every footnote in the Tab order, even where
  they are drawn beside the report.
  The report body is `components/report/ReportBody.tsx` (shared by the draft and the public page) built from these
  primitives; the publication styles are `.al-sheet`, `.al-report*`, `.al-sourced*`, `.al-check*` in app/globals.css.
- The inbox (Phase 7 T2q): one `role="search"` form named "Find cases" (its h2) with the labels "Search", "Status", "Area", "Assigned to", "Came in by", "Age", "Sort by" and one button "Show cases"; the table caption stays "Cases received" (the e2e finds it by `/^Cases received/`); 50 rows to a page, with "Previous page" / "Next page" in a nav named by its visible "Page N of M" line (`#inbox-pages-title`). Specs that compare the listed cases with lib/metrics walk the pages (`e2e/inbox-pages.ts`). Never a second "Clear filters" link (FilterSummary has the one). On the case page the assign step's date field is exactly "Due date (optional)".
- Staff intake is "Log feedback" (nav item and button), never "New report" (that link name is Phase 4's). On
  /app/cases/new the code label is exactly "Read this code to the person; it won't be shown again"; the Outbox's
  buttons all start "Show the email" (scope them to a row).
- Staff pages that run actions answer through one visible result line (`components/ui/ActionFeedback.tsx`; the case page
  through `CaseFeedback.tsx`): shown, focused and announced; field errors stay with their form (ErrorSummary + the
  field). Reuse that pattern. Forms with a side panel ("What happens next", "Where this shows") use
  `lg:grid-cols-[minmax(0,48rem)_minmax(16rem,22rem)]` and stack on phones.
- Every button and link is at least 44x44px (controls already are; inline text links are exempt).
- Copy: never "compliant", "certified" or "guarantees"; reporter copy at grade 6-8, never "priority area" or
  "barrier classification".
- Never raw colours or Tailwind palette names in components: add a token in `app/globals.css` and run
  `npx tsx scripts/check-contrast.ts` (also part of `npm test`).
- Visual QA: every key screen is shot by `e2e/screenshots.spec.ts` at 1440px and 390px, light and dark, into
  `e2e/screenshots/<screen>-<desktop|mobile>-<light|dark>.png`, with axe and a 390px no-sideways-scroll check on each.
  Add each new screen there, and look at the pictures.

## Contrast (checked by `scripts/check-contrast.ts`; `npm test` fails below the minimum)

Body text needs 7:1, other text 4.5:1, control boundaries and the focus ring 3:1.

| Pair | Min | Reporter light | Staff light | Reporter dark | Staff dark |
|---|---|---|---|---|---|
| Body text on page (`ink` on `bg`) | 7 | 14.57 | 14.90 | 15.18 | 15.57 |
| Body text on card (`ink` on `surface`) | 7 | 15.89 | 17.31 | 14.03 | 14.44 |
| Body text on raised card / input (`ink` on `surface-raised`) | 7 | 16.14 | 17.31 | 12.70 | 13.31 |
| Body text on sunken panel (`ink` on `surface-sunken`) | 7 | 13.10 | 15.74 | 16.04 | 15.14 |
| Muted text (hints) on page (`ink-muted` on `bg`) | 7 | 7.97 | 7.76 | 10.03 | 8.72 |
| Muted text on card (`ink-muted` on `surface`) | 7 | 8.69 | 9.02 | 9.28 | 8.09 |
| Muted text on raised card (`ink-muted` on `surface-raised`) | 7 | 8.82 | 9.02 | 8.40 | 7.46 |
| Muted text on sunken panel (`ink-muted` on `surface-sunken`) | 4.5 | 7.16 | 8.20 | 10.60 | 8.48 |
| Link on page (`link` on `bg`) | 7 | 9.05 | 8.63 | 10.21 | 10.82 |
| Link on card (`link` on `surface`) | 7 | 9.86 | 10.02 | 9.44 | 10.04 |
| Hovered link on page (`link-hover` on `bg`) | 7 | 12.76 | 12.17 | 12.64 | 13.41 |
| Link on selected row (`link` on `primary-soft`) | 4.5 | 8.22 | 8.22 | 7.91 | 7.91 |
| Text on selected option (`ink` on `primary-soft`) | 7 | 13.24 | 14.20 | 11.76 | 11.38 |
| Primary button text (`on-primary` on `primary`) | 7 | 10.02 | 10.02 | 9.52 | 9.52 |
| Primary button text (hover) (`on-primary` on `primary-hover`) | 7 | 12.70 | 12.70 | 11.62 | 11.62 |
| Danger button text (`on-danger` on `danger`) | 4.5 | 7.59 | 7.59 | 9.19 | 9.19 |
| Danger button text (hover) (`on-danger` on `danger-hover`) | 4.5 | 9.58 | 9.58 | 11.07 | 11.07 |
| Info notice title (`info` on `info-bg`) | 4.5 | 7.16 | 7.16 | 8.66 | 8.66 |
| Success notice title (`success` on `success-bg`) | 4.5 | 5.95 | 5.95 | 9.13 | 9.13 |
| Warning notice title (`warning` on `warning-bg`) | 4.5 | 7.30 | 7.30 | 9.03 | 9.03 |
| Danger notice title (`danger` on `danger-bg`) | 4.5 | 6.28 | 6.28 | 8.53 | 8.53 |
| Notice body (info) (`ink` on `info-bg`) | 7 | 13.66 | 14.65 | 13.42 | 12.98 |
| Notice body (success) (`ink` on `success-bg`) | 7 | 13.78 | 14.78 | 13.46 | 13.03 |
| Notice body (warning) (`ink` on `warning-bg`) | 7 | 14.13 | 15.16 | 12.76 | 12.35 |
| Notice body (danger) (`ink` on `danger-bg`) | 7 | 13.35 | 14.32 | 13.66 | 13.22 |
| Field error text on page (`danger` on `bg`) | 4.5 | 6.86 | 6.54 | 9.48 | 10.05 |
| Field error text on card (`danger` on `surface`) | 4.5 | 7.47 | 7.59 | 8.77 | 9.32 |
| Success text on card (`success` on `surface`) | 4.5 | 6.87 | 6.98 | 9.52 | 10.13 |
| Accent text on page (`accent-ink` on `bg`) | 4.5 | 7.81 | 7.45 | 11.41 | 12.10 |
| Accent text on accent tint (`accent-ink` on `accent-soft`) | 4.5 | 7.43 | 7.43 | 8.77 | 8.77 |
| Badge: New (`status-new-fg` on `status-new-bg`) | 4.5 | 7.10 | 7.10 | 9.05 | 9.05 |
| Badge: Triaged (`status-triaged-fg` on `status-triaged-bg`) | 4.5 | 7.30 | 7.30 | 9.07 | 9.07 |
| Badge: Assigned (`status-assigned-fg` on `status-assigned-bg`) | 4.5 | 6.69 | 6.69 | 8.89 | 8.89 |
| Badge: Waiting for the reporter (`status-retest-open-fg` on `status-retest-open-bg`) | 4.5 | 7.07 | 7.07 | 9.03 | 9.03 |
| Badge: Verified by reporter (`status-verified-fg` on `status-verified-bg`) | 4.5 | 6.98 | 6.98 | 9.14 | 9.14 |
| Badge: Fixed, not verified (`status-fixed-unverified-fg` on `status-fixed-unverified-bg`) | 4.5 | 6.69 | 6.69 | 9.61 | 9.61 |
| Badge: Closed (`status-closed-fg` on `status-closed-bg`) | 4.5 | 7.02 | 7.02 | 8.17 | 8.17 |
| Redaction highlight text (`redact-ink` on `redact-bg`) | 7 | 12.51 | 12.51 | 8.48 | 8.48 |
| Selected text (`ink` on `selection`) | 7 | 12.51 | 13.42 | 8.12 | 7.86 |
| Header text (`chrome-ink` on `chrome-bg`) | 7 | 14.57 | 15.28 | 15.18 | 14.18 |
| Header muted text (`chrome-muted` on `chrome-bg`) | 4.5 | 7.97 | 9.13 | 10.03 | 7.94 |
| Header button text (hover) (`chrome-ink` on `chrome-border`) | 4.5 | 11.17 | 11.05 | 10.36 | 10.26 |
| Control boundary on page (`border-strong` on `bg`) | 3 | 4.40 | 3.77 | 4.87 | 4.42 |
| Control boundary on card (`border-strong` on `surface`) | 3 | 4.79 | 4.38 | 4.50 | 4.10 |
| Control boundary on raised card (`border-strong` on `surface-raised`) | 3 | 4.87 | 4.38 | 4.07 | 3.78 |
| Primary button edge / ring on page (`primary` on `bg`) | 3 | 9.05 | 8.63 | 9.72 | 10.31 |
| Primary ring segment on card (`primary` on `surface`) | 3 | 9.86 | 10.02 | 8.99 | 9.56 |
| Selected option border (`primary` on `primary-soft`) | 3 | 8.22 | 8.22 | 7.53 | 7.53 |
| Current ring segment on card (`ring-current` on `surface`) | 3 | 5.02 | 5.10 | 9.46 | 10.06 |
| Closed-loop ring on page (`success` on `bg`) | 3 | 6.30 | 6.01 | 10.30 | 10.92 |
| Invalid input border (`danger` on `surface-raised`) | 3 | 7.59 | 7.59 | 7.94 | 8.60 |
| Chart mark on card (received, stages) (`chart-1` on `surface`) | 3 | 6.17 | 6.26 | 4.83 | 5.14 |
| Chart mark on card (verified by reporter) (`chart-verified` on `surface`) | 3 | 5.26 | 5.34 | 5.24 | 5.57 |
| Chart mark on card (not classified) (`border-strong` on `surface`) | 3 | 4.79 | 4.38 | 4.50 | 4.10 |
| Chosen segment text (period selector) (`on-primary` on `primary`) | 4.5 | 10.02 | 10.02 | 9.52 | 9.52 |
| Focus ring on page (`focus` on `bg`) | 3 | 8.23 | 7.85 | 11.97 | 12.69 |
| Focus ring on card (`focus` on `surface`) | 3 | 8.97 | 9.11 | 11.07 | 11.77 |
| Focus ring on raised card (`focus` on `surface-raised`) | 3 | 9.11 | 9.11 | 10.02 | 10.85 |
| Focus ring on sunken panel (`focus` on `surface-sunken`) | 3 | 7.39 | 8.29 | 12.65 | 12.34 |
| Focus ring on selected option (`focus` on `primary-soft`) | 3 | 7.47 | 7.47 | 9.27 | 9.27 |
| Focus ring against its halo (`focus` on `focus-halo`) | 3 | 6.67 | 6.67 | 11.97 | 11.97 |
| Focus ring in header (`chrome-focus` on `chrome-bg`) | 3 | 8.23 | 11.56 | 11.97 | 11.56 |
| Header focus ring against its halo (`chrome-focus` on `chrome-focus-halo`) | 3 | 6.67 | 11.56 | 11.97 | 11.56 |
