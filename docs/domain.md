# AccessLoop domain spec

This is the source of truth for what AccessLoop does. Code, tests and prompts follow it. If code and this file disagree, this file wins; change it only with a human's OK, and log the change in `docs/decisions.md`.

Positioning sentence (use it verbatim in UI copy, README and pitch):

> AccessLoop is the record system for the Accessible Canada Act feedback obligation. Every barrier someone reports, whether a website, a building, a phone line or a policy, is closed only when the person who reported it confirms the fix, and the Feedback section of the required progress report is drafted from those records, each sentence linked to its evidence.

What we never claim: "certified compliant", "guarantees compliance", "first/only product". We say "helps you meet your obligations". AccessLoop never fixes anything automatically and is not an overlay.

---

## 1. Legal basis (verbatim)

Retrieved 2026-10-18 from the Justice Laws website. These quotes are the reference strings for the rule checker and UI copy. Do not paraphrase them in code; copy them from here.

Sources:
- Accessible Canada Act, S.C. 2019, c. 10 (ACA): https://laws-lois.justice.gc.ca/eng/acts/A-0.6/FullText.html
- Accessible Canada Regulations, SOR/2021-241 (ACR): https://laws-lois.justice.gc.ca/eng/regulations/SOR-2021-241/FullText.html
- Sector variants with the same form rules: CRTC Accessibility Reporting Regulations (SOR/2021-160) for broadcasting and telecom; the CTA's Accessible Transportation Planning and Reporting Regulations for federal transportation providers.

### 1.1 What a barrier is (ACA s. 2)

> **barrier** means anything — including anything physical, architectural, technological or attitudinal, anything that is based on information or communications or anything that is the result of a policy or a practice — that hinders the full and equal participation in society of persons with an impairment, including a physical, mental, intellectual, cognitive, learning, communication or sensory impairment or a functional limitation.

That's why AccessLoop takes every barrier type, not only websites.

### 1.2 The priority areas (ACA s. 5)

> (a) employment; (b) the built environment; (c) information and communication technologies; (c.1) communication, other than information and communication technologies; (d) the procurement of goods, services and facilities; (e) the design and delivery of programs and services; (f) transportation; and (g) areas designated under regulations made under paragraph 117(1)(b).

Canonical keys (used in DB enum `priority_area`, prompts and fixtures):

| key | ACA para | Heading text used in reports |
|---|---|---|
| `employment` | 5(a) | Employment |
| `built_environment` | 5(b) | The built environment |
| `ict` | 5(c) | Information and communication technologies |
| `communication_other` | 5(c.1) | Communication, other than information and communication technologies |
| `procurement` | 5(d) | The procurement of goods, services and facilities |
| `programs_services` | 5(e) | The design and delivery of programs and services |
| `transportation` | 5(f) | Transportation |

5(g) is out of scope (no areas have been designated).

### 1.3 Feedback process (ACA s. 70(1), with the same wording in ss. 43, 48 and 57 for other entity classes)

> must establish a process for receiving feedback about the following and for dealing with that feedback: (a) the manner in which the regulated entity is implementing its accessibility plan; and (b) the barriers encountered by persons that deal with the regulated entity.

ACR s. 9:

> (1) When establishing a feedback process under subsection 48(1), 57(1), 66(1) or 70(1) of the Act, a regulated entity must designate a person responsible for receiving feedback on behalf of the entity and provide the position title of that person.
>
> (2) The regulated entity must ensure that feedback process allows a person to provide feedback anonymously.
>
> (3) The regulated entity must ensure that feedback process allows a person to provide feedback by mail, telephone, email and by any other means the regulated entity uses to communicate with the public.
>
> (4) The regulated entity must ensure that acknowledgment of receipt is included in the feedback process, unless the feedback is received anonymously, in the same means by which it is received.

ACR s. 19 (retention):

> A regulated entity must retain an electronic copy or print copy of any feedback it receives under section 9 for a period of seven years beginning on the day on which it is received.

What this means for the product:
- **s.9(1):** the org setting `feedbackDesignateTitle` is required and shows on the public report page and in the General section.
- **s.9(2):** the public form never asks for a name, and its follow-up question (§4 step 3) has no answer chosen for the person: two of its three answers keep them anonymous (since Phase 7 T4.2; before it, anonymous was pre-selected).
- **s.9(3):** the public web form covers only one channel, so staff must be able to log feedback received by mail, telephone, email or in person (`intake_channel`). It goes into the same loop. This is in MVP scope.
- **s.9(4):** the acknowledgement goes back through the intake channel. For a web submission it is the on-screen receipt, recorded as an `ack_recorded` event with `channel: "web_screen"`. Email is an optional extra the reporter chooses. Feedback that came by email gets an acknowledgement email. Phone or mail feedback gets a staff-recorded manual acknowledgement. Anonymous feedback needs no acknowledgement, but still gets the on-screen receipt.
- **s.19:** `cases.retentionUntil` = received date + 7 years. No hard delete before that date. The original text is kept encrypted (`case_private`); staff work from the redacted copy. After that date the owner-run retention step (`npm run db:retention -- --apply`, scripts/retention.ts; dry run without `--apply`) wipes the private copy: the original words become a fixed encrypted note saying they were removed, and the email and contact details are deleted; the redacted copy, the public summary and the log stay. Separately, 30 days after a case is verified or closed (when its receipt code stops working) the same step deletes the reporter's email and contact details. Each change is a system `note_added` event with `kind: "retention_purged"` (Phase 7, docs/decisions.md 2026-10-20). The app itself never deletes or wipes anything.
- **The description and its checklist (Phase 7):** `/p/[orgSlug]` publishes the feedback-process description generated from the org settings (who receives feedback, every way to give it, anonymous allowed, acknowledgement in the same way, other formats on request), and `/app/settings` previews the same component beside an ACR s.9 checklist: s.9(1) title (flagged when it may be a person's name), s.9(2) anonymous, s.9(3) mail/phone/email, s.9(3) other public channels (marked for the lead to check: AccessLoop cannot see them), s.9(4) acknowledgement (non-anonymous cases received this year with none recorded in the intake channel, from `lib/metrics`, linked to the inbox), and other formats on request (s.14(2)(b)). Each row says what AccessLoop sees; none says the process is "compliant".

### 1.4 Progress report (ACA s. 71, with the same wording in ss. 44, 49 and 58)

> (3) The regulated entity must consult persons with disabilities in the preparation of its progress report.
> (4) The progress report must set out the manner in which the regulated entity consulted persons with disabilities in the preparation of its progress report.
> (5) The progress report must set out information concerning the feedback received by the regulated entity through its feedback process and how that feedback was taken into consideration.

ACR s. 14:

> (1) A progress report that is required by subsection 49(1), 58(1), 67(1) or 71(1) of the Act must be written in simple, clear and concise language and must include the following headings: (a) "General"; (b) a heading for each area identified under paragraph 47(1)(a), 56(1)(a), 65(1)(a) or 69(1)(a) of the Act, as the case may be; (c) "Consultations"; and (d) "Feedback".
>
> (2) The information that is contained under the heading "General" must include the position title of the person designated to receive feedback on behalf of the regulated entity and the manner and information by which the public can communicate with the regulated entity, including the mailing address of its publicly accessible businesses, a telephone number and an email address in order to (a) request the entity's progress report in a format referred to in subsection 17(2); (b) request the description of the entity's feedback process in a format referred to in subsection 9(5); or (c) provide feedback.
>
> (3) The information that is contained under the heading "Consultations" is the information referred to in subsection 49(4), 58(4), 67(4) or 71(4) of the Act, as the case may be.
>
> (4) The information that is contained under the heading "Feedback" is the information referred to in subsection 49(5), 58(5), 67(5) or 71(5) of the Act, as the case may be.

ACR s. 15(1)(a): the progress report must be published "in a format that meets the requirements of Level AA conformance that are set out in the WCAG". So the generated report page must itself pass WCAG AA.

ACR s. 16: notify the regulator within 48 hours after publishing. The product shows a reminder, and the signed fingerprint to include in the notice (§8 "Signed at sign-off"); sending the notice is out of scope.

**Heading text note:** s.14(1)(a), (c) and (d) give the exact heading strings "General", "Consultations" and "Feedback". Paragraph (b) requires a heading *for each area* in the org's accessibility plan but does not fix the wording. We use the canonical texts in 1.2 and accept the aliases in `lib/report/headings.ts`.

### 1.5 Deadlines (for the pitch and the dashboard banner)

| Entity class | Next deliverable |
|---|---|
| Federal public sector | Progress report due **Dec 31, 2026** |
| Large private (100+ employees) | Progress report due **June 1, 2027** |
| Small private (10–99) | Updated accessibility plan due June 1, 2027 (not a progress report) |

### 1.6 Penalties: pitch them honestly

The statutory maximum is $250,000 per violation (ACA s.91(2)). The obligations AccessLoop touches (feedback process, progress report, retention) are classed as **minor** in ACR Schedule 1: $1,000–$10,000 for a first violation by a large entity. The Commissioner's 2024–25 report says no enforcement actions had been taken yet. Lead with inspection findings instead: feedback-process descriptions had the highest number of non-compliances, and missing headings and weak barrier-removal reporting were common in progress reports.

---

## 2. Roles

| Role | Who | Auth | Can |
|---|---|---|---|
| Reporter | Anyone; often a person with a disability | **None.** Holds a receipt code | Submit, confirm the AI summary, check status, give re-test verdicts, opt out of contact |
| Lead (`org:lead`) | The designated feedback person | Clerk, org role | Everything staff can do; approve redaction; reveal the original (logged); triage; assign; close; generate and sign off reports; edit org settings |
| Owner (`org:owner`) | Whoever fixes it (IT, facilities, HR) | Clerk, org role | See only cases assigned to them, redacted text only; log a fix with evidence |
| Auditor (`org:auditor`) | Internal audit, regulator demo | Clerk, org role | Read-only for cases (redacted) and reports; use /verify |

In the **local prototype** (`AUTH_MODE=local`), staff sign in from a localhost-only "Sign in as…" page that lists the seeded staff. Their roles come from `org_members.role`. At **Going live** (`AUTH_MODE=clerk`), Clerk Organizations is turned on, and custom roles are created in the Clerk dashboard with keys `org:lead`, `org:owner` and `org:auditor`. In both modes the reporter flow never loads any auth UI and never shows a CAPTCHA.

---

## 3. Case state machine

Implemented in `lib/state-machine.ts` (frozen). `cases.status` is a projection. It changes only through `transition()`, which appends a `case_events` row in the same transaction.

```
            triage                 assign             log_fix (wantsRetest && round < 2)
  new ───────────────▶ triaged ───────────▶ assigned ───────────────────────────▶ retest_open
   │                     │                  ▲   │                                    │
   │ close               │ close            │   │ log_fix (otherwise)                │ verdict=fixed
   ▼                     ▼                  │   ▼                                    ▼
 closed               closed      reopen    │  fixed_unverified ◀── verdict=cant_check  verified
                                            │        │               opt_out / expire
                                            │        │ reopen (lead)
                                            └────────┘
                       retest_open ── verdict=partly|not_fixed ──▶ assigned   (round stays; next log_fix decides)

  Phase 7 (D1-D4), all by the lead:
  triaged | assigned ── retriage ──▶ the same status            (a new area and/or public summary, with a reason)
  retest_open ── stop_waiting (14+ days after the request) ──▶ fixed_unverified   ("reporter unreachable")
  verified ── reopen ──▶ assigned          closed ── reopen ──▶ triaged (new when it was closed before triage)
```

| From | Action | Actor | To | Guard |
|---|---|---|---|---|
| new | `triage` | lead | triaged | a `redaction_approved` event exists; `priorityArea` and `publicSummary` set |
| new, triaged | `close` | lead | closed | `closedReason` ∈ duplicate, out_of_scope, spam, no_action_possible; a `duplicate` names its original, a case of the same org ("Duplicates" below). A case that was **ever** assigned or had a fix logged (an `assigned` or `fix_logged` event exists, counted by `transition()`) only gets duplicate or no_action_possible, also back in triaged after a reopen (D1; docs/decisions.md 2026-10-21) |
| assigned, fixed_unverified | `close` | lead | closed | `closedReason` ∈ duplicate, no_action_possible (Phase 7 D1: "spam" and "out of scope" only before the case is assigned, so a fixed case can't be closed out of the numbers) |
| triaged, assigned | `retriage` | lead | the same status | Phase 7 D2: a new `priorityArea` and/or `publicSummary` (at least one must change) and a required `reason`. Logged as a `triaged` event with `retriage: true`, `changed` and `reason`, carrying both resulting values |
| triaged, assigned | `assign` | lead | assigned | assignee is an org member with role owner or lead. Phase 7 D8: an optional due date (`dueAt`), written to `cases.due_at` and to the `assigned` event (an ISO instant, or null for none; §9) |
| assigned | `log_fix` | owner (assignee) or lead | retest_open | `wantsRetest` && `retestRound < MAX_RETEST_ROUNDS` (2); increments `retestRound` |
| assigned | `log_fix` | owner or lead | fixed_unverified | otherwise |
| retest_open | `verdict_fixed` | reporter (receipt code) | verified | — |
| retest_open | `verdict_partly`, `verdict_not_fixed` | reporter | assigned | — |
| retest_open | `verdict_cant_check` | reporter | fixed_unverified | — |
| retest_open | `opt_out` | reporter | fixed_unverified | sets `wantsRetest=false`. Allowed in any other state too: it then only records the preference, status unchanged |
| retest_open | `expire_retest` | system | fixed_unverified | 60 days since `retest_requested`. Run by the daily job (`/api/cron/daily`) only when `CRON_EXPIRE_RETEST=1` (§10) |
| retest_open | `stop_waiting` | lead | fixed_unverified | Phase 7 D3: 14 days or more since the latest `retest_requested`; reason "reporter unreachable". Logged as a `retest_expired` event by the lead with `reason: "reporter_unreachable"` and `afterDays`; the round ends unanswered and the fix counts as not verified |
| fixed_unverified | `reopen` | lead | assigned | a required `reason` |
| verified | `reopen` | lead | assigned | Phase 7 D4: a required `reason`; `verifiedAt` is cleared, so the case leaves every verified number from that event on (a report frozen before it keeps it) |
| closed | `reopen` | lead | triaged, or new when it was closed before triage | Phase 7 D4: a required `reason`; the closing reason, assignee and due date are cleared (a triaged case always has an area and a public summary, so one closed from new goes back to new) |

Terminal states: `verified`, `closed`. Only the lead's `reopen` (D4, with a reason) leaves them.

**Duplicates** (Phase 7 T2 item 8): closing with `duplicate` names the original case, a case of the **same org** (looked up inside the org by `transition()`; another org's case is "not found"), not the case itself and not itself closed as a duplicate (name the case it repeats instead, so links never chain). The `closed` event records it as `duplicateOf: { caseId, ref }`. The case page requires it (the lead types the original's ref, e.g. BAR-0003); `plan()` still accepts a duplicate close without one, for closes logged before Phase 7 and the seed's. The link shows both ways: the duplicate says "Duplicate of BAR-0003" and links it; the original lists the cases closed as duplicates of it while they still are ("Reported again"). Refs of other cases are named and linked only for the lead and the auditor; an owner, who opens only their own cases, sees "a duplicate of another case" and a count. The reporter's page shows only the plain closing reason.

**Telling the assignee (Phase 7 T2 item 7).** When the lead assigns a case to someone new (not when only its due date changes, and never to the lead who assigned it to themself), AccessLoop emails them "A barrier was assigned to you": the case reference and a link to the staff case page only, never report text, a receipt code or a /check link. It goes out after the assignment is saved, so an email problem never undoes it, and the "Assign" answer says what happened (emailed; logged, not sent, with `FAKE_EMAIL=1`, where the Outbox shows it; failed; or no address on file: "tell them another way"). Staff have no address in AccessLoop: it comes from Clerk at Going live, so before that a real send has no address and sends nothing.

The Phase 7 actions add no event types (the `event_type` enum is schema; no schema change was approved for them): a retriage is a `triaged` event, stopping the wait a `retest_expired` event, a reopen a `reopened` event. The replay (§8) reads them that way: the latest `triaged` event sets the area and public summary (the first one stays the triage time), a lead's `retest_expired` closes the round unanswered, and leaving `closed` or `verified` clears the closing reason or the verified date.

Status labels shown to staff (`data-testid="case-status"`; the e2e tests assert these exact strings):

| status | Staff label | Reporter sees on `/r/[code]` |
|---|---|---|
| new | New | We got your report |
| triaged | Triaged | A team is looking at it |
| assigned | Assigned | Someone is working on a fix |
| retest_open | Waiting for the reporter to check | Please tell us if it works now |
| verified | Verified by reporter | Fixed and confirmed by you |
| fixed_unverified | Fixed, not verified by reporter | Fixed (not checked by you) |
| closed | Closed | Closed: {reason in plain words} |

All guards in this table are enforced by the frozen `plan()`/`transition()`: the assignee's role is looked up in the same org, and expiry and `stop_waiting` are measured from the latest `retest_requested` event. Free-text fields (comment, description, reason, note, public summary) are layer-1 redacted before they enter the log.

**Only a reporter holding the receipt code can produce `verified`**, or the reporter's one-round link: a re-test email (request or reminder) links to `/r/t/{token}`, where the token is an HMAC (`RETEST_LINK_SECRET`) over the org, the case, the round and an expiry (30 days after the email, or the round's 60-day end, whichever comes first). It answers that round's question only (a later round needs its own email), shows the same status view as `/r/[code]` without the code or the "Stop contact" form, is never stored or logged, and the Outbox shows a placeholder for it (Phase 7, docs/decisions.md 2026-10-20). No staff UI, API or seed path creates `verified`. Staff cannot issue receipt codes after intake. Each verdict event records `{ via: "receipt_code", round }`, also for an answer through the link (the frozen `plan()` writes it; the link is only sent to the address the reporter gave).

For **staff-logged intake** (phone, mail, in person), staff must pass the code on. The system emails it when there's an email; otherwise it is shown to staff once ("Read this code to the person; it won't be shown again"). The `submitted` event records `codeRelayedByStaff: true`, and the report counts those verifications separately ("confirmed by the reporter, code given by staff"), so the headline verified-by-reporter number only includes codes that never passed through staff.

After a verdict, the re-test page's status region says: "Thank you. It's now marked as fixed and confirmed by you." (for "fixed"), or a matching plain sentence for the other answers.

Non-transition events (status unchanged): `submitted`, `ack_recorded`, `ai_structured`, `redaction_proposed`, `redaction_approved`, `private_revealed`, `note_added`, `retest_requested`, `message_sent`.

**Staff notes** (Phase 7 T2 item 4): the lead, and the owner a case is assigned to, can add a note in any status. It is a `note_added` event appended with `appendCaseEvent` (never edited) with `{ kind: "internal" | "interim_accommodation", note }`, the text layer-1 redacted first (and, for the lead, checked against the details the redaction hides). An **interim accommodation** is what the person was offered while the barrier is being fixed; it has its own label ("Interim accommodation", "Offered meanwhile") in the case's Notes card and History. Notes are for staff: auditors read them, the reporter's page never shows them, and no metric or report counts them. (A reporter's `note_added`, the comment left with "Don't contact me", stays as before: shown to the lead only.)

Re-test ethics rules (product behaviour, not only copy):
- Ask at most once per round, with at most one reminder email (only if the reporter gave an email). Maximum 2 rounds per case. The lead may send the reminder ("Send a reminder email"); otherwise the daily job sends it 7 days after the round's request (Phase 7).
- The re-test page offers: "Yes, it works now", "Partly", "No, still a barrier", "I can't check right now", "Don't contact me about this again".
- The org may set `retestOfferText` (e.g. "We offer a $25 gift card for checking"). If set, it is shown on the re-test page. Payment handling is out of scope.
- Report metrics never rank or name individual reporters.

---

## 4. Intake (reporter flow)

The public form is at `/o/[orgSlug]/report`. It has one question per screen, at most 4 screens, no time limit and no modals. The answers are autosaved in this browser as the person types: by default in `sessionStorage` (this tab only, gone when the tab is closed); in `localStorage`, for at most 7 days, only when the person ticks "Keep this draft on this device" (under the form on every step). The email address, the AI summary, the summary answer and the preview token are never saved. A kept draft comes back on step 1 with "Start over"; it is cleared once the report is sent.

Each step's `<h2>` starts with a visually hidden "Step N of 4: " (focus lands on it after every step change, so the step is announced there; the visible "Step N of 4" line is hidden from screen readers so it is not read twice), while the step's field or group keeps the question alone as its name.

1. **What got in your way?** A free-text `<textarea>` with the hint: "You can type or use your device's dictation." A required field.
2. **Where did it happen?** Radio buttons in a `<fieldset>`: On a website or app / At a place / On the phone or at a service / In a document / Somewhere else. Optional free text: "Where exactly? (optional)".
3. **How can we follow up?** ONE question: radio buttons in a `<fieldset>`, none chosen for the person, required:
   - "Don't contact me" → `wantsRetest=false`, anonymous ("You still get a receipt code, to see where your report is.");
   - "Let me check the fix with my code" → `wantsRetest=true`, anonymous; shows the receipt-code explanation under it;
   - "Email me, and let me check the fix" → `wantsRetest=true`, email; the email field appears only under it, with the text: "If you add your email, the organization's accessibility team can see it. It is never shown in public reports."
   - A notice before Next: "An AI tool helps summarize your report. We remove names and contact details before staff see it. {Where the words go} When you press Next, you can check its summary, or choose not to use AI." **{Where the words go}** (Phase 7 Wave 4 item 1, `lib/public-info/ai-where.ts`) is one sentence, true for this copy's AI setting (`describeThisCopy()`, at request time): with `api`, "When AI is on, your words go to Anthropic, an AI company in the United States, after we take out contact details and ID numbers."; with `claude-cli`, that it is a test copy using the team's own Claude account, then the same; with the fake backend, that the AI is simulated with ready-made answers, so the words don't leave this computer (only when the database is on this computer; otherwise "are not sent to any AI company"); with a bad setting, that AI is not working and no AI company gets the words. The same sentence starts the hint of "Don't use AI on my report" on the review (§4 item 4), so it is read with the checkbox.
4. **Review** (`<h2>` "Check your report"). Shows "Your words" (verbatim) and "We understood" (the AI summary) with the question "Is this right?" as radio buttons in a `<fieldset>`: "Yes, that's right" / "Change it" (a box for the reporter's own summary opens under it; chosen by click, tap or Space, focus moves into the box, whose label and hint are the one announcement; moved onto with the arrow keys, focus stays and the status region says once that the box is open) / "Keep my words only". Then the checkbox **"Don't use AI on my report"** → `aiOptOut=true`: the summary is put away, no AI result is stored with the case and no further AI call is made for it (manual triage, and a person checks for names). That holds for every later AI step too: its own sentence in a progress report keeps the template and is never sent to `phraseClaims` (§7), and "Similar past barriers" (§6.2) offers no AI suggestion for it and never sends its public summary as a candidate. Unticking it brings the summary back (or makes one if none was made). Then "Your choices" and "Send report". The AI output is not streamed. The live region announces "Summarizing your report…", then focus moves to the "Check your report" heading. Reporter text that reads as French (`lib/intake/language.ts`) is marked `lang="fr"` wherever it is shown back.

The AI summary is made when the person presses Next on step 3 (on the layer-1-masked text, as before), so a person who opts out on the review has had it made but never stored: the step 3 notice says so before Next. A choice kept in the draft is honoured: with `aiOptOut` already set, Next makes no AI call at all.

On submit:
- The server re-runs redaction on the stored text (the client is never trusted).
- It creates the case, `case_private` (encrypted original and email), and the events `submitted`, `ack_recorded{channel:"web_screen"}` and `ai_structured`.
- It sends an email acknowledgement if an email was given (`message_sent`).
- It responds with the **receipt page** `/o/[orgSlug]/receipt`. Its `<h1>` "We got your report" receives focus. The page shows:
  - the receipt code (`XXXX-XXXX-XXXX-XXXX`, `data-testid="receipt-code"`, whose text is exactly the code) drawn as two groups of eight on two lines, with a spelled-out reading under it ("seven, K for Kilo, three, M for Mike, ..."), and "Copy code" (copies the 16 letters and numbers without hyphens), "Download as a text file", "Print receipt" (print styles: the code, the reference, how to check; no buttons), "Add a reminder to my calendar" (an `.ics` all-day event 14 days later that links to `/check` and names the organization and reference, and **never holds the code**), and the link `/r/[code]`;
  - the line "Keep this code. It is the only way to check your report or confirm a fix if you stay anonymous.", and that the page shows the code only once;
  - the non-secret reference ("Reference: BAR-0017", `data-testid="case-ref"`), which the reporter can quote by phone.

  The receipt code is passed to this page in a short-lived (**2 minutes**), httpOnly, same-site cookie scoped to the receipt path (or rendered directly by the POST response), never in the URL query. As soon as the receipt is on screen the page clears that cookie (a same-origin POST to `/o/[orgSlug]/receipt/seen`), so a reload, the Back button or the next person at a shared computer finds no code.

**Other ways to reach the organization** (ACR s.9(3)): every page about one organization (the report form on every step, the receipt, `/r/[code]`, a re-test email's `/r/t/{token}` (also its "This link no longer works" page, with the org of the link's MAC-checked claims), `/check?org={slug}`, `/help?org={slug}`, and the error page under `/o/[orgSlug]`) offers "Other ways to reach {org}": its phone, email and mailing address from the org settings, the person to ask for, and its feedback page `/p/{orgSlug}`. On those pages, and on `/p/{orgSlug}`, its published reports and their `/verify` page, the footer links `/p/{orgSlug}` ("{org}: accessibility feedback"), and "Get help" and "Check your report" carry `?org={slug}` (a public slug that only names the organization; it never decides what a receipt code opens).

**From a location poster** (Phase 7 T4.5; the `org_locations` of §9): the lead names the org's places, phone lines, websites and documents at `/app/settings/locations` (lead only) and prints a poster for each from `/app/settings/locations/{id}/poster`: the org's name, "Did something here get in your way?", the location's name and detail, a QR code drawn on the server (the `qrcode` package, human decision N1; no QR service, no script), three plain steps, the address the code opens printed under it ("No camera? Type this address:"), and the org's phone, email and the person to ask for. In print the poster is alone on one portrait page (Letter or A4). The code opens `/o/{slug}/report?loc={locationId}`, built from the configured public base URL (`lib/app-url.ts`), never from the Host header; on a computer-only address (localhost) the poster page tells the lead that phones can't open it yet (on screen only). On the form, `loc` is looked up **only inside the org resolved from the slug**, and only while the location is in use (`active`): an unknown, malformed, retired or other org's id, or more than one `loc`, is ignored without a word and the form starts empty, so a location never decides or reveals an org. A found location fills in "Where did it happen?" with its kind and "Where exactly?" with its name, then its detail ("Main Street branch, front entrance"; at most 80 + 200 characters, within the box's 300) — only where the person has not answered yet (a kept draft's own answer always wins), and "Start over" fills it in again. Step 1 then says "You came from the poster for {name}, so step 2 already says where it happened. You can change it.", and step 2's question has the hint "We filled this in from the poster for {name}. You can change it." — both only when the poster's place was really filled in: a kept draft that already answered "Where did it happen?" shows neither (docs/decisions.md 2026-10-21). The person can change both answers; the case keeps what they send (kind and detail, as before: no reference to the location row). Retiring a location (it is never deleted) makes its printed posters open the form empty; a change to its name or detail reaches every poster already printed, since the code holds only the id.

The reporter never sees the words "priority area" or "barrier classification". Reporter-facing copy targets a grade 6–8 reading level. A French toggle on reporter pages is a stretch goal.

**Receipt code** (`lib/receipt-code.ts`, frozen): 80 random bits, encoded as 16 Crockford base32 characters in groups of 4. Only `HMAC-SHA256(RECEIPT_PEPPER, normalized)` is stored. `/r/[code]` GET only renders the page; any verdict is a POST from a button, so email link scanners cannot consume it. The code is valid until the case is terminal plus 30 days. `/check` accepts a typed code and is rate-limited. Re-test emails also carry the one-round link `/r/t/{token}` (§3), which follows the same GET-renders, POST-answers rule and is rate-limited the same way.

**Staff-logged intake** (`/app/cases/new`, lead only): channel (email / phone / mail / in person / other), received date, the text as received, anonymous or not, reporter contact (encrypted) and wants re-test. It enters the same pipeline (redaction → `new`). The acknowledgement for that channel is recorded on the case page: "Send acknowledgement email" (email intake) or "I acknowledged by phone/mail on [date]". The typed date dates the acknowledgement; the case page and its History also say when it was recorded ("Recorded on {date}, N days later"), and the dashboard counts the records written more than 7 days after the date they give (Phase 7, acknowledgement honesty, §10).

### 4.1 Reporter JSON API (`/api/v1`, for the Expo reporter app)

A versioned JSON API lets the Expo reporter app (Phase 7 Wave 3, `mobile/`) do exactly what the web form and `/r/[code]` do. It **reuses their code**: the same `buildPreview`, the same submit (`lib/intake/submit.ts`: email check, the org's daily cap of §9, `prepareCase` redacting again on the server, the frozen `createCase`, the acknowledgement email), the same `loadReporterCase` and the same re-test rules (`lib/retest-answer.ts`), the same preview token, the same AI budget (§9) and the same rate-limit buckets (`intake_preview`, `intake_submit`, `receipt_view`, `verdict`, `public_report`; a person's web and app requests from one connection share them). Every route is `runtime = "nodejs"`, sets and reads **no cookies**, answers `Cache-Control: no-store`, and never logs a body, receipt code, email or IP. The org always comes from the slug (or, for a code, from `resolve_receipt()`), never from a body: bodies are strict (zod), so an unknown key such as `orgId` is refused.

| Route | Body / header | Answer |
|---|---|---|
| `GET /api/v1/orgs/{slug}` (optional `?loc={locationId}`) | — | `{ organization: { slug, name, feedbackPage, contact: { designatedTitle, phone, email, mailingAddress } }, place: { name, locationKind, locationDetail } \| null, form: { locationKinds, followUp, summaryChoices, limits } }` (the public profile of `/p/{slug}` and the form's answers in the web form's words; `place` is a location poster's starting answers exactly as the web form fills them in (§4), null without `loc`, with more than one `loc`, or for any id that is not a location in use of this org) |
| `POST /api/v1/orgs/{slug}/preview` | `{ text, locationKind, locationDetail?, aiOptOut? }` | `{ summary, previewToken }` (both null with `aiOptOut`; never the suggested areas or layer-2 values), plus `aiPaused: true` with both null when the hour's AI budget of §9 is spent or can't be checked (the web form's manual path) |
| `POST /api/v1/orgs/{slug}/reports` | `{ text, locationKind, locationDetail?, followUp: "none"\|"code"\|"email", email?, aiOptOut?, summaryChoice?, editedSummary?, previewToken? }` | **201** `{ receiptCode, receiptCodeSpelledOut, reference, receivedAt, status, statusLabel, organization, notice }` |
| `GET /api/v1/status` | `Authorization: Receipt XXXX-XXXX-XXXX-XXXX` | `{ reference, receivedAt, status, statusLabel, closedReason, organization, fixDescription, wantsRetest, canStopContact, retest: { question, offerText, answers, commentMax } \| null }` |
| `POST /api/v1/retest` | `Authorization: Receipt …`; `{ answer, comment? }` (one of the five answers of §3) | `{ answer, message, report }` (`message` is the web page's sentence; `report` the status above) |

- **The receipt code is returned exactly once**, in the 201 of `POST /reports`, and no other answer ever holds it. It travels back only in the `Authorization` header with the `Receipt` scheme (any case, hyphens and spaces optional, as `/check` accepts it), **never in a URL or a body**: a `?code=` or a `code` field is ignored (401). Unknown, malformed and expired codes are the same 404 (it never says whether a code existed).
- `followUp` is step 3's one question (§4): `email` is used only with `"email"` (otherwise ignored, never stored). A bad address is 400 `invalid_email` and nothing is saved.
- Re-test: a verdict while no re-test is open, or a second answer, is 409 `already_answered` and changes nothing; `opt_out` works at any time (the preference only, outside `retest_open`). Only this, a reporter holding the code, can produce `verified` (§3).
- Errors are `{ error: { code, message, fields? } }` with plain words an app can show (`fields` names fields, never values): 400 `invalid_request` / `invalid_json` / `invalid_email` / `comment_too_long`, 401 `missing_code` (with `WWW-Authenticate: Receipt`), 404 `not_found`, 409 `already_answered`, 413 `too_large` (bodies over 64 KiB), 415 `unsupported_media_type` (every POST is `application/json`), 429 `rate_limited` (with `Retry-After`), 429 `org_full` (the org's daily cap of §9 is reached: nothing is saved, and the message names the org's phone and email), 500 `failed`, 503 `unavailable`.
- Browsers: JSON bodies and the Authorization header need a preflight, and no CORS headers are sent, so a cross-site page can't use the API with a visitor's browser. The native app is not a browser and is not affected. **One exception, for local development only:** the Expo app's web build (`npx expo start --web`, origin exactly `http://localhost:8081`) gets CORS (`proxy.ts` answers its preflight: `GET, POST, OPTIONS`, `Accept, Authorization, Content-Type`; the route's answer gets `Access-Control-Allow-Origin` and exposes `Retry-After`), only in `AUTH_MODE=local`, never on Vercel, and only for a request for this computer that came through no proxy or tunnel from elsewhere (the same test as the local sign-in, `lib/auth/local-request.ts`). Never `Allow-Credentials`: the API has no cookies.
- Intake through the API is channel `web` (the app's on-screen receipt is the ACR s.9(4) acknowledgement, as on the web).

---

## 5. Redaction pipeline (fail-closed)

Layers run in this order on the server. The output is a list of spans `{start, end, type, source}` over the original text, and the redacted text replaces each span with `[TYPE]`.

1. **Deterministic** (`lib/redaction/patterns.ts`, frozen baseline; may be extended, never weakened): email, Canadian phone numbers, SIN (Luhn-checked), postal codes, health-card-like numbers, account/card-like digit runs, street addresses, URLs with query strings. Since Phase 7 also keyword-anchored values, the keyword staying visible ("my SIN is [SIN]"): street addresses in any letter case or with a spoken house number after "I live at", French street words and abbreviations ("boul.", "ch.", "av.") in any case, PO Box / RR / case postale, OHIP and other health card numbers without version letters (and the 4-3-3 grouping on its own), bank transit and account numbers near "transit" / "account" / "compte", any 9 digits after "SIN" / "NAS" and a joining word or sign ("is", ":", "number"; a bare "SIN 123 456 789" stays Luhn-checked), dates of birth near "born" / "DOB" / "né(e)" / "date de naissance" (type `DOB`), and ticket or reference numbers near their keyword plus IT-service ticket IDs such as INC0012345 (type `OTHER_ID`, never our own case refs).
2. **LLM pass** on the already-masked text: it returns **exact substrings only** (JSON, zod-validated; no offsets, no rewritten text), and `spansFromValues()` maps every occurrence back onto the original. It looks for person names, named staff, exact dates of birth and quasi-identifiers (for example "the only wheelchair user at the Moncton depot"). The prompt treats the report text as untrusted data inside delimiters (a tag in the text that could close or open them is neutralized, look-alike characters included; the injection suite, `npm run eval -- --set injection`, checks this). If the call fails or times out, the case is flagged `needsManualRedaction` and still goes to human review.
3. **Human approval** by the lead on the case page: spans are highlighted, and the lead can add or remove spans, then approves. This creates a `redaction_approved` event with the final span list (types and offsets, never the values). Owners never see a case before this approval.
   **Correcting it later** (Phase 7 T2): after the approval, the lead can hide a detail it missed ("Hide a detail that was missed" under the report). A correction only ever hides more: every span of the latest approval stays, the lead's exact words are added, the case's redacted text, summaries and place detail are redacted again from the original, and a **new** `redaction_approved` event records the corrected spans with `revision: true` (the first approval's time stays the approval time). Earlier events are never edited: when the words also appear in the public summary or in earlier records, the answer says so (the public summary can be fixed with "Correct the triage" while the case is triaged or assigned).

If `aiOptOut` is set, layer 2 is skipped; layers 1 and 3 still run.

Images: EXIF is stripped server-side before storage; images never go to the LLM. Photo upload is a stretch goal and can be cut.

Reveal: the lead can click "Show original". This creates a `private_revealed` event with the actor, and the decrypted text is shown once. It is never cached.

---

## 6. AI functions (contract)

All LLM calls go through `lib/ai/` only. Each function has a zod output schema, a prompt file under `lib/ai/prompts/*.md` (versioned; the sha256 of the prompt file is stored in the event payload), a timeout, and a fake implementation reading `lib/ai/fakes/*.json`. How a call reaches a model is chosen by `AI_BACKEND` (§6.1).

| Function | Input | Output | Model env |
|---|---|---|---|
| `structure(maskedText, locationKind)` | redacted text | `{ summary: string (≤ 2 plain sentences, second person), priorityAreas: [{area, confidence 0–1}] (1–3), uncertain: string[] }` | `MODEL_STRUCTURE` (default `claude-sonnet-5-5`) |
| `flagPii(maskedText)` | layer-1 masked text | `{ items: [{text (exact substring), type: "PERSON"\|"STAFF_NAME"\|"DOB"\|"QUASI_ID"\|"OTHER_ID", reason}] }` | `MODEL_PII` (default `claude-haiku-5-5`) |
| `phraseClaims(claims[])` | compiled claims (section 7) | `[{ claimId, text }]`, one per input claim | `MODEL_REPORT` (default `claude-sonnet-5-5`) |
| `similarBarriers(query)` (Phase 7, §6.2) | this case's public summary, area and place, and up to 40 candidates' refs and public summaries (never report text) | `{ matches: [{ ref, reason }] }`, 0 to 5, every `ref` one of the candidates | `MODEL_SIMILAR`, else `MODEL_PII` (default `claude-haiku-5-5`) |

Rules:
- Model output never changes case state directly. Only a human (lead, owner) or the reporter changes state.
- The summary is labelled "AI summary" wherever it is shown to staff, and the reporter's confirmation (yes / edited / kept own words) is stored in `cases.summarySource`.
- The suggested area is labelled "AI suggestion" with its confidence as a plain word (high from 0.8, medium from 0.5, low below 0.5) and, in the triage form, what the AI was unsure about (`uncertain`, in fixed staff words). The triage form pre-selects the suggestion only at a confidence of 0.5 or more (the eval's `ABSTAIN_THRESHOLD`); below that the lead chooses the area. The lead always confirms.
- `ai_structured` events store `{ backend, model, promptSha, latencyMs, aiValue, confirmedValue }`, so the reporter-correction rate can be computed.
- **Intake time budget:** the AI steps of one intake (the web preview, or feedback a lead logs) share one budget, end to end: 10 s on `api`, 60 s on `claude-cli` (the backend's own per-call timeout). Layer 2 on the report and on "Where exactly?" run in parallel; `structure` starts when the report's own layer 2 is done. A call that is not done by the deadline gets its usual fallback (layer 1 and `needsManualRedaction`, or no summary).

### 6.1 Backends (`AI_BACKEND`)

The three functions above have one implementation each. The **backend** only decides how a request reaches a model. Prompts, zod schemas, fakes and the validation and fallback logic are shared, so switching backends never changes behaviour except for the model's answers.

| `AI_BACKEND` | What it does | Needs | Use it for |
|---|---|---|---|
| `fake` (default) | Answers from `lib/ai/fakes/*.json` | Nothing | Tests, CI, e2e, offline demo fallback |
| `claude-cli` | Spawns the locally installed Claude Code CLI in print mode, signed in with **your own** Claude subscription | Claude Code CLI ≥ 2.1.211 installed and logged in (`claude auth status` → `authMethod: "claude.ai"`) | **The team's own local development only:** trying prompts, tuning them, running the eval while there is no API key |
| `api` | Calls the Anthropic Messages API with `@anthropic-ai/sdk`: tool-use JSON output (one tool, `tool_choice: auto`, `strict` where the model accepts it), no temperature (the current models reject any value but their default), `output_config.effort: low` for `structure`, one jittered retry on HTTP 429/529 inside a 10 s budget per call. Token usage per call goes into eval results | `ANTHROPIC_API_KEY` | Tester sessions, judging, the live demo, any deployed URL, the eval numbers you publish |

**Effective AI backend = `FAKE_LLM=1` ? `fake` : `AI_BACKEND`.** To get real AI you must set BOTH `FAKE_LLM=0` and `AI_BACKEND` (`claude-cli` or `api`); `npm run local:setup` writes `FAKE_LLM=1` and `AI_BACKEND=fake`. Playwright's local web server always forces `FAKE_LLM=1`, `FAKE_EMAIL=1`, `AI_BACKEND=fake`, whatever `.env.local` says.

**`claude-cli` contract** (`lib/ai/backends/claude-cli.ts`):
- **Process:** spawn the Claude Code CLI with an **args array and no shell**. It is found in this order: `CLAUDE_CLI_PATH` (used exactly as given; the default name `claude` counts as not set); then `claude` on PATH (`claude.exe`, or the npm package's `cli.js` run with Node); then, on Windows only, the newest copy the Claude desktop app keeps in `%LOCALAPPDATA%\Claude-Data\*\claude-code\<version>\*\claude.exe`. With none of these, it fails with a clear error. The working directory is an empty temp directory, so the CLI has no project files to see.
- **Input:** the masked report data goes in on **stdin**, wrapped in `<report>…</report>`, never in argv. A short fixed positional prompt tells the model to process the stdin data according to the system prompt. Stdin-only (no positional prompt) is not documented, so don't rely on it.
- **Flags:**
  - `-p --output-format json --no-session-persistence`
  - `--model <CLAUDE_CLI_MODEL>` (default `sonnet`)
  - `--system-prompt-file <lib/ai/prompts/X.md>`, which replaces Claude Code's default prompt, **when `claude --help` lists it**; otherwise `--system-prompt '<the same file's text>'` (our own prompt in argv is fine; reporter text still goes only on stdin)
  - `--json-schema '<schema>'`, produced from the zod schema with `z.toJSONSchema`, without its top-level `"$schema"` (CLI 2.1.299 refuses the draft 2020-12 URI)
  - `--tools "" --disallowedTools "mcp__*"`, so there are no file, shell, web or MCP tools at all. Not `--disallowedTools "*"`: `--json-schema` answers through the CLI's own `StructuredOutput` tool, which `"*"` also denies (CLI 2.1.312, checked 2026-10-28: every `structure` call then failed). `"mcp__*"` keeps MCP tools out even when the CLI has no `--safe-mode`
  - `--max-turns 1` **only when `claude --help` lists it**. Without tools there is only one turn anyway. CLI 2.1.299 lists neither `--system-prompt-file` nor `--max-turns`.
  - Capability detection: `claude --help` is read once at the startup check, and only its option lines count. A help that does not list `--print`, `--output-format`, `--no-session-persistence`, `--model`, `--json-schema`, `--tools`, `--disallowedTools` and a system-prompt flag is refused with a clear message.
- **Isolation:** do **not** use `--bare`, because it ignores subscription logins and needs an API key. Use `--safe-mode` if the installed version has it; it turns off CLAUDE.md, skills, plugins, hooks and MCP while keeping auth. Also set the child env `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` and `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`. **Remove `ANTHROPIC_API_KEY` from the child env**, because in print mode it would silently take precedence over the subscription. For the same reason also remove `CLAUDE_CODE_OAUTH_TOKEN` and `CLAUDE_CODE_SIMPLE`. `CLAUDE_CODE_SIMPLE` is what `--bare` sets, and a server started inside a Claude Code session inherits it.
- **Output:** parse stdout as JSON even when the exit code is non-zero. Take `structured_output`, falling back to `result` parsed as JSON. Validate with the same zod schema. On `is_error`, a timeout or a schema mismatch, use the same fallbacks as the API backend (manual triage, `needsManualRedaction`).
- **Timeout:** 60 s, not 10 s, because each call starts a whole CLI process. Run at most **one** CLI call at a time (a simple in-process queue). A caller's deadline (the intake time budget, §6) shortens it, and a queued call whose turn comes with less than 5 s left is not started.
- **Startup check:** on first use, run `claude --version`, `claude auth status` and `claude --help`. If the version is too old, the CLI isn't logged in, or the auth method isn't `claude.ai`, fail with a clear message telling the human what to do. For a CLI that is not signed in, that message gives the exact command for the CLI that was found (`<found path> auth login`, or `npm install -g @anthropic-ai/claude-code` then `claude auth login`), to run once with the team's own claude.ai account, and says that a local eval also needs `FAKE_LLM=0` and `AI_BACKEND=claude-cli`. AccessLoop never starts a login itself. Never fall through to another backend silently.
- **Logging:** `ai_structured` events store `backend: "claude-cli"`, the model alias, and the CLI version, with the detected capabilities as semver build metadata (for example `2.1.299+system-prompt-inline.no-max-turns.safe-mode`).

**Hard limits of `claude-cli` (enforced in code, not just documented):**
1. **Your own use only.** Anthropic's Claude Code legal page says subscription (OAuth) login is for "ordinary use of Claude Code", and that developers building products "should use API key authentication" and may not "route requests through Free, Pro, or Max plan credentials on behalf of their users". So this backend serves only the team working on its own machine. Tester sessions, judges and the demo audience are users: use `api` (or `fake`, clearly labelled) for them.
2. It refuses to start unless `AUTH_MODE=local`, `VERCEL` is unset, and the request is local: a localhost `Host` **and** no forwarding header pointing away from this computer (`localRequestAllowed`, the local sign-in's own test, §9), so a tunnel that rewrites `Host` to localhost can't run the team's subscription for the public form (`aiRequestContext(headers)`, `lib/ai/context.ts`; docs/decisions.md 2026-10-21). The child process also never gets AccessLoop's secrets (every one `lib/env.ts` knows, the Phase 7 ones included).
3. **No temperature control** (the CLI has none). Answers vary between runs, so eval results from it are labelled `backend: claude-cli` and are **never published** as the product's numbers. Re-run the eval with `api` before quoting anything.
4. **Slower:** a CLI process starts on every call. The review step must show "Summarizing your report…" and stay accessible for up to 60 s. Never block the submit itself on the AI.
5. Usage counts against your subscription's limits. A full eval run is about 40–60 calls.

### 6.2 Similar past barriers (Phase 7, T2 item 10)

A card "Similar past barriers" on the staff case page helps the lead notice a barrier that was reported before, or that was fixed and came back. It is a suggestion only: **nothing is ever merged, linked, closed or recorded for the lead** (it is not the duplicate clustering of §11; closing a case as a duplicate stays the lead's own step).

- **Who and when:** leads only (owners and auditors never see it; the server action refuses other roles), and only once the case has an area and a public summary (after triage).
- **Candidates (plain Postgres history, `lib/cases/similar.ts`):** cases of the same org (inside `withOrg`), the same `priorityArea`, the same `locationKind`, received in the last 24 months, with a public summary, never the case itself and never a submission closed as spam; the 40 newest, newest first. The card always lists them in a table behind a disclosure, so the lead can read them with or without AI. **"Don't use AI on my report"** (§4) holds here: a case whose reporter opted out gets the table only, with no AI button (the server action refuses it too), and an opted-out candidate is listed but never sent to the AI.
- **The AI call (`lib/ai/similar.ts`, prompt `lib/ai/prompts/similar-barriers.md`, fake `lib/ai/fakes/similar-barriers.json`):** runs only when the lead presses "Find similar past barriers", never on page load. It reads only lead-approved public summaries (layer-1 masked again), as JSON inside `<cases>…</cases>` in the user turn. Its answer is zod-validated, and every `ref` must be exactly one of the candidates: **an answer that names any other case is dropped whole** and the card says the suggestion is not available. At most 5 matches, each with one short reason. On `api` it uses `MODEL_SIMILAR`, else the `MODEL_PII` model (Haiku by default); on `claude-cli` the same one-call-at-a-time queue. Nothing about the call is stored, so it adds no event.
- **Shown as** "AI suggestion" with who answered ("simulated AI, for testing", "the team's local Claude CLI", "Claude API"): each match's reference (a link), status, received date, public summary and the AI's reason. Only the count is announced; AI text never goes into the live region.

---

## 7. Report generator (compiled, not generated)

Lives at `/app/reports`. The flow is: **choose period → freeze snapshot → compile claims → phrase → validate → review → sign off → publish page**.

1. **Snapshot**: select every case received in the period, plus their events. A case closed as spam ("Not feedback about a barrier") is in the snapshot only so `F_NOT_FEEDBACK` can cite it; no other fact counts it (Phase 7 D6). Store in `reports.snapshot` `{ cases: [{id, ref, status, priorityArea, publicSummary, receivedAt, verifiedAt, headHash}], facts: [...] }`. `reports.manifestHash` = sha256 of the canonical snapshot. It is printed in the report footer and checked by `/verify/[reportId]`.
2. **Facts** (computed in SQL or TypeScript, never by the LLM). Each fact is `{ id, kind, values: Record<string, number|string>, caseIds: string[] }`:
   - `F_TOTAL`: total feedback received, with `byChannel`
   - `F_ANON`: number received anonymously
   - `F_NOT_FEEDBACK`: submissions received in the period and closed as not accessibility feedback (spam), with their cases; only when there is 1 or more (Phase 7 D6: "We also closed {N} submissions as not accessibility feedback, so they are not counted in this section.")
   - `F_AREA:<area>`: count per priority area
   - `F_OUTCOME`: verified by reporter / fixed but not verified by reporter / in progress / closed without action
   - `F_VERIFY_TIME`: median days from received to verified (only if 1 or more verified)
   - `F_ACK`: non-anonymous feedback acknowledged, and median hours to acknowledgement
   - `F_RETEST`: re-test rounds answered "partly" or "not fixed" (the loop working)
   - `F_CASE:<ref>`: one per verified or fixed case, with its `publicSummary`
3. **Claims**: each fact is turned into a template sentence (for example `F_OUTCOME` → "Of these, {verified} were fixed and confirmed by the person who reported them, {unverified} were fixed but not yet confirmed, and {open} are still in progress."). A claim is `{ claimId, heading: "Feedback", template, slots, factIds }`.
4. **Phrase**: `phraseClaims` may rewrite only for plain language. It must keep every slot value.
5. **Validate** (`lib/report/validate.ts`): a sentence is rejected if any of these hold:
   - it has no fact IDs, or cites a fact that is not in the snapshot;
   - it contains a number that is not among its cited facts' values (the period year is allowed);
   - it contains a case reference that is not cited;
   - it contains `[` placeholders or any raw text;
   - compared with its claim's template filled with the slot values (Phase 7, before real AI rewords anything): its numbers are not in the template's order (two values swapped); it has more than 1.3 times the template's words, rounded up (an added claim); or it uses a banned word more often than the template does: compliant, compliance, certified, guarantee(d), fully, every, all, 100%, satisfied, resolved, and their French equivalents (conforme, certifié, garanti, entièrement, chaque, tous, satisfait, résolu, ...). A quoted public summary counts as the summary's own words on both sides.

   A rejected sentence falls back to the deterministic template. Export is blocked if any sentence lacks a citation.
6. **Headings** (`lib/report/headings.ts`, frozen): the checker runs ACR s.14 rules R1–R5 on the draft and shows a live checklist. Heading text is checked case-insensitively. All headings are `<h2>`.
7. **Draft structure**:
   - **General**: generated from org settings (designate title, mailing address, phone, email, and how to request alternate formats).
   - **One heading per org plan area**: each section is a placeholder the lead must write, plus "Feedback received in this area: N" (cited).
   - **Consultations**: a placeholder the lead must write.
   - **Feedback**: generated claims.

   Placeholders are warnings, not heading failures.
8. **Sign-off**: the lead clicks "Sign off" and a `signedOffBy`/`signedOffAt` is recorded. After sign-off the report is immutable, in the app and in the database: the sign-off lock trigger (`db/sql/0100_security.sql`) refuses every UPDATE of a signed-off row, even for the owner, except setting `published_at` once, from null (publishing). A new version means a new report row. In the same update AccessLoop seals and signs the report (§8 "Signed at sign-off"); sign-off is refused when the report's evidence check fails, when any case history of the org does not verify, or when no signing key is set up.
9. **Published page** `/p/[orgSlug]/reports/[reportId]`: semantic HTML and print CSS. Each sentence (here and on the staff draft) ends with a footnote-style **button** (a disclosure toggle with `aria-expanded`) whose accessible name is "Sources for this sentence (N records)". It opens an in-page list (accessible name "Sources") of case references and redacted public summaries; a cited case without one says "Waiting for review", or "Closed before review (no public summary)" when it was closed (spam cited by `F_NOT_FEEDBACK`, a duplicate closed from new), here, on `/verify` and in the plain-text export. A plain-text export is available, and so is "Download evidence bundle" (§8). The footer shows the signed fingerprint; on the lead's staff page it is labelled as the fingerprint to include in the ACR s.16 notice to the regulator.
10. **"How your Feedback section compares" (Phase 7):** on the staff report page, after sign-off in the rail, a card "Your draft covers N of 7 elements; published median is M". The 7 elements are ESDC's recommendations for the Feedback heading (total, by ACA area, by channel, areas with no feedback, changes to the feedback process), ACA s.71(5)'s "how feedback was taken into consideration", and AccessLoop's own "whether the people who reported barriers confirmed the fixes". N is read from the report's stored sentences (AccessLoop never drafts changes to the feedback process, so a draft covers at most 6). M is the median score of the published reports in `data/benchmark/feedback-sections.csv`, counted **only from rows a person verified** (`verified_by_human = true`); with none, the card is not shown. The card is never a region (the page keeps one region named "Feedback").

The report never contains reporter text, names, emails or quasi-identifiers. It uses only the lead-approved `publicSummary`.

---

## 8. Evidence chain (tamper-evidence)

`case_events` is append-only. A DB trigger blocks UPDATE and DELETE, and the app role has no UPDATE or DELETE grant. Each case has its own hash chain, implemented in `lib/case-events.ts` (frozen):

```
hash_n = sha256( hash_{n-1} + "\n" + canonicalJson({ orgId, caseId, seq, type, actorKind, actorId, payload, createdAt }) )
hash_0 = "0" * 64
```

Payloads hold redacted content only, never raw PII. Transition events carry `from`/`to`, and `triaged` carries `priorityArea` and `publicSummary`, so a case's reportable state can be **replayed from its events alone**.

`/verify/[reportId]` (public for published reports via `resolvePublishedReport()`; drafts only for signed-in staff of the org) has an `<h1>` "Evidence check", a status line ("All records match" or what failed), and a `<table>` named "Records" with **one row per cited case** and one column per check below. It runs five checks, each shown as ✓ or ✗:
1. **Report unchanged:** recompute `manifestHash` from the stored snapshot. A mismatch means the report was altered after it was generated.
2. **Records intact:** `verifyCaseChain` for every cited case. A broken link means an event was edited or deleted.
3. **Report matches records:** the snapshot's `headHash` must be an event hash in that case's chain. Replaying events up to that hash must give the same `status`, `priorityArea`, `publicSummary`, `receivedAt` and `verifiedAt` as the snapshot, and recomputing the facts from those replayed cases must give the same values.
4. **Later updates (info, not an error):** "N updates since this report" for events after the head.
5. **Signed by AccessLoop at sign-off** (once signed off; a draft says "Not signed yet", never an error): the root recomputed from the row as stored now (its snapshot must still hash to the signed fingerprint) equals the signed root, the Ed25519 signature over it checks with a key published at `/.well-known/accessloop-signing-keys.json`, and every case history the signature sealed (the whole org's, not only the cited ones) still holds its signed record at the signed position, unbroken (frozen `verifyCaseChain`) up to it, and every case the report cites is among those sealed histories (as the offline check requires). Each failure is named in plain words: the lead's own text, the sentences, the frozen records or the sign-off date changed, an unknown key, a signature that doesn't match, "N case histories changed after sign-off (refs)", or "N cited cases were not sealed at sign-off (refs)". The "Records" column says per case: "Signed", "Changed after signing", "Signature fails", "Not sealed" or "Not signed yet". "All records match" needs checks 1-3, and check 5 once the report is signed off.

The `cases` table is only a projection for fast UI. `/verify` never trusts it.

Demo beat (on the owner DB URL):
- `UPDATE case_events …` fails, because the trigger blocks it. Show the error.
- `UPDATE reports SET snapshot = jsonb_set(…)` to inflate the verified count turns check 1 red on a draft. On a signed-off report the sign-off lock refuses the UPDATE; with that trigger switched off, checks 1 and 5 turn red.
- Optionally, disable the trigger and edit an event payload: check 2 turns red.

### Signed at sign-off (the regulator's copy of the evidence)

Whoever controls the database (the org's owner role, or us as host) could rewrite a whole case chain and its hashes, and the lead's area and Consultations text is outside `manifestHash`. So at sign-off AccessLoop seals everything in one hash and signs it (`lib/report/signing.ts`, Ed25519 from `node:crypto`):

```
heads        = the hash of the latest event of EVERY case chain of the org at that moment (each chain verified first)
leadTextHash = sha256(canonicalJson({ areaText, consultationsText }))
contentHash  = sha256(canonicalJson(reports.content without its `signing` key))
root         = sha256(canonicalJson({ kind: "accessloop.report-root", version: 1, reportId, signedAt,
                                      heads (sorted), manifestHash, leadTextHash, contentHash }))
signature    = Ed25519 over the 64 ASCII characters of root, with REPORT_SIGNING_KEY
```

- **Stored** in the existing `reports.content` column as `content.signing` `{ version, alg, keyId, signedAt (= signed_off_at), root, signature, manifestHash, leadTextHash, contentHash, heads: [{ caseId, seq, hash }] }`, written in the same UPDATE as the sign-off. No schema change.
- **Key:** `REPORT_SIGNING_KEY` = an Ed25519 private key, PKCS8 DER, base64 (`node tools/signing-key.mjs --write <env file>` makes one), with optional `REPORT_SIGNING_KEY_CREATED`. Required outside `AUTH_MODE=local` and on Vercel. In `AUTH_MODE=local` a missing key is derived: seed = HKDF-SHA256(`SESSION_SECRET`, empty salt, info `"REPORT_SIGNING_KEY"`, 32 bytes), the shared Phase 7 derivation in `lib/env.ts` (`secretFromEnv`). The server checks both variables at startup (`lib/env.ts`, names only, never values) and sign-off reads them through the same helpers, so a key the server starts with is a key it can sign with. Key ID = `"ed25519-"` + the first 16 hex characters of sha256(the raw 32-byte public key).
- **Published key:** `/.well-known/accessloop-signing-keys.json` lists `{ keyId, algorithm: "Ed25519", created, source, publicKey (SPKI DER base64), jwk }`. Public values only.
- **The root is the fingerprint the lead includes in the ACR s.16 notice** to the regulator (shown in the report footer after sign-off, and in the plain-text export). A later rewrite of any case chain, the snapshot, the sentences or the lead's text changes the recomputed root; a new signature needs the private key, and the regulator already holds the old root.
- **The sign-off lock** (`db/sql/0100_security.sql`, block 2b): a BEFORE UPDATE trigger on `reports` refuses any change to a row whose stored status is `signed_off`, for every role including the owner, except setting `published_at` from null with every other column unchanged. Only whoever can switch triggers off can still edit the row, and the signed root then shows it (check 5 above).
- **"Download evidence bundle"** on the published report (`/p/[orgSlug]/reports/[id]/evidence.json`, published only, rate-limited): JSON with the report as published (snapshot, content without `signing`, the lead's text), the signature block (root, signature, key ID, the sorted heads, the root formula) and, for each cited case, its chain as **public-safe fields only**: `seq`, record type (staff-internal types written `internal`, as /verify says "Internal record"), time, `hash`, `prevHash`, `from`/`to` statuses, priority area, the snapshot's public summary, the report's head and the signed head. Never a payload, an actor, reporter text, a name or a contact detail. Because the frozen chain hashes whole payloads, a third party checks the links between records, that each chain contains both heads, the root and the signature, not each record's own hash. The bundle also names the time zone its calendar dates are counted in (`report.timeZone`, not signed).
- **Offline check: `tools/verify-bundle.mjs`**, one dependency-free file (Node.js 20+, `node:crypto` only, no network, no AccessLoop imports), also served at `/verify/verify-bundle.mjs` (read at build time) and described in "Check it yourself, offline" on `/verify` and on `/trust`. `node verify-bundle.mjs <bundle> --keys <saved key list> [--expect-root <fingerprint from the notice>] [--json]` runs five checks: the report fingerprint; the signed root recomputed from the file (and equal to `--expect-root`); the Ed25519 signature with the named key (its key ID recomputed from the key); each cited history (links from 64 zeros, the report's and the signed record present, the signed record among the signed heads, and a replay of the public fields up to the report's record giving the snapshot's status, area and dates); and the report numbers (every number in a sentence is a value of a cited fact or a period year; the total, areas, outcomes, median days to a confirmed fix and fixed cases recount from the snapshot's cases). The snapshot's case list holds every submission received in the period; the ones the "not accessibility feedback" fact (D6) cites must be closed cases, and every other count leaves them out, as the report does. Channels, anonymity, acknowledgements, re-test answers and which submissions were closed as not accessibility feedback need payload details the bundle leaves out, so it lists them as "not recounted offline" (the online check recounts them). Its replay follows `lib/metrics`: the latest area wins (a triage correction, D2) and a case reopened from verified (D4) is not verified from that record on. A history the report does not cite is not in the bundle: an edit to it shows only in the online check 5. Exit code 0 = every check passed, 1 = a check failed, 2 = could not run or finish (no key, unreadable file, not a bundle).

---

## 9. Tenancy and security

- Every tenant table has `org_id uuid not null`. Postgres RLS is forced on every tenant table. Policies compare `org_id` with `current_setting('app.org_id', true)::uuid`. `case_private` also requires `current_setting('app.role', true) = 'lead'`. See `db/sql/0100_security.sql`.
- The tenant tables are `org_members`, `cases`, `case_private`, `case_events`, `attachments`, `reports`, `outbound_messages` and `org_locations`.
- **`org_locations`** (Phase 7, D8): an org's named places, services, pages and documents, managed by the lead and printed as QR posters that open `/o/{slug}/report?loc={id}` with the place filled in (the reporter can change it). Columns: `name` (the poster heading), `kind` (the form's `location_kind`), optional `detail` (after the name, pre-fills "Where exactly?"; §4 "From a location poster"), `active`, `created_at`. The lead manages them at `/app/settings/locations`; the app refuses a second location in use with the same name in one org (any case; not a database constraint), so two posters never look alike. The report form reads a location only inside `withOrg` for the org resolved from the slug, so another org's location ID finds nothing. A location is retired with `active = false`, never deleted (the app role has no DELETE). A case copies the kind and detail as before; it has no reference to a location row.
- **`cases.due_at`** (Phase 7, D8): an optional due date (`timestamptz`, null = none) the lead sets when assigning ("Due date (optional)" in the case page's assign step: today or later, up to 3 years ahead; an overdue case being reassigned may keep its date). It is stored as the last millisecond of that day in the display time zone, so it is past once that day is over, and the `assigned` event records it too, so the replay (§8) knows it. A case is overdue when its due date has passed while it is still `assigned` (not fixed, not closed): the inbox and My work show "Overdue", and the date for an assigned case ("Due Nov 3, 2026", "Due today"). After a fix is logged the date is history and no longer shown. A case sent back to `assigned` (a reporter's "Partly"/"No", a reopen from verified or fixed) keeps its date and can be overdue again; a reopen from closed clears it.
- All DB access goes through `withOrg({ orgId, role }, tx => …)` in `db/tenant.ts`, which sets both settings with `set_config(..., true)` inside a transaction. A raw `db.select()` outside `withOrg` returns nothing from tenant tables, so the system fails closed.
- Public routes resolve the org server-side: by slug through the `orgs` table, which is not tenant-scoped, or by receipt code through the SECURITY DEFINER function `resolve_receipt(code_hash)`. Never from a client-supplied org ID.
- `orgs` and `rate_limits` also have RLS enabled and forced (Phase 7, decision D7(b)): their policies let `accessloop_app` (and the owner running the security SQL) read and write them as before, without an org context, and give every other role nothing. Where Supabase's `anon` and `authenticated` roles exist, the security SQL revokes every privilege they hold on public tables, sequences and functions, now and by default for later objects (D7(c)); elsewhere that step does nothing.
- The app connects as the role `accessloop_app` (not the owner, no BYPASSRLS). Migrations use the owner URL (`npm run db:deploy`, which first checks that `accessloop_app` exists, can log in and is NOSUPERUSER NOBYPASSRLS). At startup the server checks its own role and refuses to start if it is a superuser or has BYPASSRLS, and it refuses to start when a required setting is missing or malformed (`lib/env.ts`, from `instrumentation.ts`). A remote database is reached with `?sslmode=require`.
- Local sign-in (`AUTH_MODE=local`) also refuses any request whose forwarding headers point away from this computer: an `X-Forwarded-Host` or `Forwarded: host=` that is not local, or an `X-Forwarded-For`, `X-Real-IP` or `Forwarded: for=` address that is not loopback, so a tunnel or proxy that rewrites `Host` to `localhost` does not expose it (`lib/auth/local-request.ts`). It only sees proxies that add such a header (ngrok, cloudflared and Caddy do; a plain nginx `proxy_pass` on the same computer does not, and looks exactly like a direct local request), so a local-mode copy must never sit behind a reverse proxy or tunnel at all (SECURITY.md). The `claude-cli` guard uses the same test (§6.1).
- Rate limits on the public routes come from a Postgres token bucket keyed by `HMAC(daily salt, ip)`. Raw IPs are not stored. There is no visual CAPTCHA. An IPv6 address counts by its /64 network. The address is the platform's: on Vercel its `x-real-ip`, anywhere else the last `x-forwarded-for` entry (the one the nearest proxy added), never the first. `next start` keeps a client's own `x-forwarded-for`, so a self-hosted copy must sit behind a reverse proxy that appends the client's address (a trusted-proxy setting is roadmap). The preview (step 3 "Next") allows 20 per 10 minutes when a real AI backend answers; with the fake backend, which costs nothing, it keeps the earlier 120 (Phase 7, `lib/rate-limit.ts`).
- Two shared limits sit on top of the per-address ones (Phase 7): a **global AI budget**, real model calls from the public form across every visitor and org, `AI_GLOBAL_HOURLY_LIMIT` per hour (default 300, `0` turns the form's AI off), after which the preview runs no AI and the report takes the manual path of §5 (layer 1, then a person), saying so in plain words; and a **daily cap per org** on web reports, `ORG_DAILY_SUBMISSION_LIMIT` (default 200, counted per calendar day in Toronto time), after which "Send report" saves nothing and names the org's phone and email instead (s.9(3): the form is only one channel). Staff-logged feedback is never capped. The dashboard shows the day's count (§10). In the local prototype the cap does not count this computer's own requests (`AUTH_MODE=local`, not on Vercel, a loopback address), so the e2e suite never meets it.
- Emails are never sent inside a database transaction: the `outbound_messages` row is recorded (status `pending`) in the transaction that decides to send, the send happens after it commits (at most 5 seconds), and its result (status, `message_sent` event, and for an acknowledgement email the `ack_recorded` event) goes in a second short transaction. The one exception is the receipt-code email of staff-logged feedback, sent inside the intake transaction (5 seconds at most) so that a failure rolls the intake back (decisions 2026-10-19 "Which emails go when").
- Links that leave the browser (emails, a downloaded receipt, a report's evidence-check line) use the server-only `APP_URL`, read at run time, else Vercel's production domain (production) or deployment URL, else `http://localhost:{PORT}`; never the request's Host header.
- Encryption: AES-256-GCM, with the key in `ENCRYPTION_KEY` (`lib/crypto.ts`, frozen). It is used for `case_private` and reporter contact details.
- The daily job `GET /api/cron/daily` (vercel.json runs it at 11:00 UTC) answers only a request with `Authorization: Bearer ${CRON_SECRET}` (constant-time; anyone else gets a 401 before anything is read; `?dryRun=1` only counts). It expires re-test rounds open 60 days (only with `CRON_EXPIRE_RETEST=1`), sends each round's one reminder 7 days after the request, and sends the assigned owner one alert per stretch in `assigned` when the case is past its due date or has had no fix logged for 30+ days (§10's rule). Every part runs in its own short transaction with the case row locked and re-planned, through `transition()` and the mailer; its answer holds counts only. Staff email addresses come from Clerk at Going live; until then an owner alert is recorded in the Outbox with `FAKE_EMAIL=1` and not sent with real email (counted as "no address").
- Retention runs only as the owner (`npm run db:retention`, §1.3 s.19), never as the app role, inside each org's context with `app.role = 'lead'` (the policies on `case_private`).
- Required tests:
  - **Phase 1:** the Lakeview lead sees none of Maple Harbour's cases in their inbox; an unknown org slug → 404; UPDATE/DELETE on `case_events` → error.
  - **Phase 2:** an owner opening an unassigned case's ref → 404; the Lakeview lead opening a Maple Harbour ref → 404 (refs repeat across orgs, so the lookup must be scoped to the active org); a Maple Harbour receipt code on `/r/` for a Lakeview context → 404.
- The `/trust` page states plainly what goes to the LLM (masked text only), which provider, where data is stored, the retention period (7 years for feedback, per ACR s.19), and that reporters have no accounts. The report form says where the words go at the point of collection (§4 step 3). There is no org-level "AI off" setting (it would need a schema change that was not approved in Phase 7; a human decides at hosting): each reporter can opt out, and `AI_GLOBAL_HOURLY_LIMIT=0` turns the AI of the public form and of the `/api/v1` preview off for a whole deployment (the global AI budget above; staff-logged feedback, report wording and §6.2 still use the configured backend).

---

## 10. Dashboard (`/app/dashboard`): the staff home page and a demo centrepiece

Leads and auditors land here after sign-in (until Phase 3 builds it, leads land on `/app/inbox`); owners land on `/app/my-work`. The dashboard answers one question at a glance: **"Is our feedback loop actually closing, and are we ready to report?"** It is the opening and closing shot of the demo, so it gets real design attention (CLAUDE.md "UI quality bar", signature moment 4).

**One source of truth for numbers.** Every number comes from pure, unit-tested functions in `lib/metrics/` that take a list of cases plus their events and return values **with the case IDs behind them**. The report's facts (§7) are computed by the **same functions**, so the dashboard and the report can never disagree. No number is computed in a component or by the AI.

**Layout (desktop):**
1. **Header:** org name, period selector (This year / Last 90 days / Custom, as native date inputs), and the **deadline banner**: the next deliverable for the org's entity class (§1.5) with the days left, e.g. "Progress report due June 1, 2027: 225 days". Under it, one line with today's web reports against the org's daily cap (§9), which becomes a warning once the form has taken the day's last one.
2. **Metric tiles (`Stat`), each with a definition behind a "What is this?" disclosure:**
   - **Verified-fix rate**, the headline tile, drawn as a ring: verified by the reporter / cases with at least one `fix_logged` event (Phase 7 D6), over the period's cases whatever their status now, with the counts next to it. A fix still waiting for the reporter, one they couldn't check or didn't answer, a stopped wait, one sent back, reopened or closed after the fix all count as **not verified**, so closing a fixed case can never raise the rate. Verifications from staff-relayed codes (§3) are shown separately: in the denominator, never the numerator.
   - **Median days to verified fix.**
   - **Open barriers**, by status (new / triaged / assigned / waiting for the reporter).
   - **Acknowledgement compliance:** the share of non-anonymous cases with an `ack_recorded` event in the intake channel (ACR s.9(4)). Phase 7 (acknowledgement honesty): a staff-recorded acknowledgement is dated by the day typed, so the tile also says how many of those counted acknowledgements were **recorded more than 7 days after the date given** (the event's own time vs `payload.on`), with a link (inbox `anonymous=no&ack=late`). They still count as acknowledged; the lateness is said, never hidden.
   - **Reporter-correction rate:** the share of AI summaries the reporter edited or rejected, a live AI-accuracy signal. It only counts `ai_structured` events with `backend` `claude-cli` or `api`; with none, the tile says "No real-AI summaries yet".
   - **Re-test response rate:** answered re-tests / re-tests requested.
   - **Closed as not accessibility feedback** (a footnote under the tiles, Phase 7 D6): submissions received in the period and closed as spam are left out of every number, never silently: the footnote says how many and links them (inbox `notFeedback=yes`). The report states the same number (`F_NOT_FEEDBACK`, §7).
3. **Charts** (hand-built SVG, never colour alone; accessibility pattern below):
   - **The loop funnel:** reported → triaged → assigned → fix logged → verified by reporter. The product's thesis in one picture.
   - **Received vs verified per month** for the period.
   - **Barriers by priority area** (horizontal bars, using the §1.2 heading names).
   - **Intake channels** (web / email / phone / mail / in person), showing ACR s.9(3) coverage.
4. **"Needs attention"** list, with each row linking to the case:
   - new cases waiting for redaction review;
   - re-tests open for more than 14 days;
   - assigned cases with no fix logged for 30+ days;
   - non-anonymous cases with no acknowledgement recorded.
5. **Report readiness card:** whether a draft exists for the period, its heading-check status (§7), and a "Generate report" link.
6. **Evidence integrity card:** "All N records verify ✓", from `verifyCaseChain` over the period's cases (cached for 60 s), linking to the latest report's `/verify`.
7. **CAN-ASC-5.2.1 clause 17 panel (Phase 7):** the four steps clause 17 of CAN-ASC-5.2.1:2026 (Accessible Service Delivery) names, each with a number the dashboard already has and a link to exactly its cases: **receive** = feedback received (`total`), **acknowledge** = non-anonymous cases acknowledged in the intake channel of those that need it (`acknowledgement`), **address** = cases with a fix logged of those received (`funnel.fixLogged`), **respond** = re-test requests sent back to the person who reported it (`retestResponse.requested`, rounds). One quoted line (under 15 words) with the clause's URL. It shows what was recorded at each step; it never says the organization meets the standard.

Every tile and every chart value links to the inbox, filtered to exactly the cases behind that number. That's the same "click any number to see its records" idea as the report.

**The inbox** (`/app/inbox`, lead and auditor; Phase 7 T2 item 5) is a table of 50 cases to a page ("Previous page" / "Next page"), with the columns Reference, Summary, Area, Assigned to (with the due date), Age (whole days since received, with the date it was received under it), Where, Channel and Status. Above it, a native GET form "Find cases" (a search landmark): "Search" (a reference such as BAR-0012, also by its number, or words in the public summary or in the summary that viewer sees; words the viewer may not read are never searched), selects for Status, Area, "Assigned to" (an owner or lead, or no one yet), "Came in by" and Age (under 7 days, 7 to 29, 30 to 89, 90 or more), and "Sort by" (received, newest first; age, oldest first; due date, soonest first: assigned cases with a due date first, the most overdue on top). Nothing happens until "Show cases" is pressed. Its filters are the same `lib/metrics` filter (and predicates) as every dashboard link; the filters the form has no field for (a number's period, month, stage, ...) are kept in hidden fields, so a search narrows the cases a number opened, and "Clear filters" drops them all. **My work** (owners) adds a "Due" column, and lists the soonest due (the overdue) first among the cases that need a fix.

**Chart accessibility pattern (the only one allowed):**
- The SVG is `aria-hidden="true"`, with no links, no `tabindex` and no `<title>`/`<desc>` inside it.
- Next to it, a real data `<table>` (with `<caption>` and `<th scope>`) is **always in the DOM**. On desktop it is visually hidden until "Show as table" is pressed, but it stays exposed to screen readers. On mobile it is shown by default.
- The table cells hold the links to the filtered inbox.
- Mouse users may also click a bar or segment. That's a plain `onClick` on a non-focusable shape, repeating a link that already exists in the table.

**Mobile (390 px):** tiles stack in a single column, charts become their tables by default, and the "Needs attention" list stays near the top.

**Accessibility:** each tile is a heading plus text, not an image. Charts follow the pattern above. Nothing auto-refreshes or animates while someone is reading it. The page passes axe at both widths and in both themes.

**Expected values for the seed** (fresh `npm run local:reset`, computed with `now = 2026-10-19`; `lib/metrics/` takes `now` as a parameter and its unit tests must reproduce this table exactly):

| Metric | Seed value |
|---|---|
| Total received | 16 (web 11, email 2, phone 1, mail 1, in person 1) |
| Anonymous | 12 |
| Status | verified 7, fixed not verified 4, new 1, triaged 1, assigned 1, waiting for reporter 1, closed 1 |
| Verified-fix rate | **7 / 12** (Phase 7 D6, a fix logged: 7 verified; not verified: 4 fixed not verified BAR-0002, BAR-0006, BAR-0008, BAR-0010 and 1 waiting for the reporter BAR-0014); 0 via staff-relayed codes |
| Median days to verified fix | **14** (7, 11, 12, 14, 21, 29, 34) |
| Re-test response rate | **9 / 10** ("I can't check right now" counts as answered; the open one, BAR-0014, does not) |
| Acknowledgement compliance | **4 / 4** non-anonymous cases; **0** recorded more than 7 days after the date given (the seed's staff records give no separate date) |
| Reporter-correction rate | "No real-AI summaries yet" (all seed summaries have `backend: "seed"`, so show the count of 0, not "0%") |
| Loop funnel | reported 16 → triaged 14 → assigned 13 → fix logged 12 → verified by reporter 7 |
| Received per month (2026) | Jan 2, Feb 2, Mar 2, Apr 1, May 2, Jun 2, Jul 1, Aug 0, Sep 3, Oct 1 |
| Verified per month (2026) | Jan 1, Mar 3, May 2, Aug 1 |
| By priority area | ICT 5, the built environment 3, communication (other than ICT) 2, programs and services 2, employment 1, procurement 1, not classified yet 2 (BAR-0011 closed as duplicate, BAR-0016 new) |
| Needs attention | BAR-0016 (waiting for redaction review), BAR-0014 (re-test open 25 days), BAR-0013 (assigned 40 days, no fix); no unacknowledged cases |
| Closed as not accessibility feedback | 0 (so the report has no `F_NOT_FEEDBACK` fact) |

`e2e/dashboard.spec.ts` must not hard-code these numbers, because `demo.spec.ts` adds a verified case on every run. It compares the UI with `lib/metrics/` computed on the same database at test time. The fixed table above belongs to the unit tests, which seed a fresh PGlite database the same way `scripts/db-smoke.ts` does. No job expires re-tests automatically before demo day: the daily job (§9) runs `expire_retest` only when `CRON_EXPIRE_RETEST=1`, which stays unset until after the demo (Phase 7, docs/decisions.md 2026-10-20).

**Scenario organization (Phase 7).** The seed also creates a third made-up organization, Kestrel Bay Group (`kestrel-bay`; lead "Riley Brennan", owner "Operations team"), holding the scenario cases of `data/scenarios.json`: each one a barrier theme from a published accessibility progress report, written in our own words, created through the frozen core like every seeded case. Its staff case page shows "Scenario derived from public report: {org}, {year}, {url}; wording ours; not a real submission", and the public page `/sources` lists every scenario and every report we read. It is its own tenant, so the table above stays Maple Harbour's alone. A real organization is only ever cited as a source, never a tenant.


**Optional, Phase 5:** `/api/metrics`, the same numbers as counters and gauges in Prometheus text format. It carries counts only (no PII, no case text), is reachable only from localhost (or with a bearer token at Going live), and makes the app ready for Grafana later without running either tool now.

---

## 11. Out of scope (state it as roadmap)

These are out of scope: a mobile app beyond the local Expo reporter prototype in `mobile/` (approved as N4 in Phase 7: the reporter flow, receipt, My reports and re-test over the API of §4.1; no staff side), automated phone or mail intake (manual logging is in scope), duplicate clustering, CAN-ASC-5.2.1 or EN 301 549 mapping beyond the clause 17 panel (§10), Jira/ServiceNow (a JSON export or webhook stub is allowed), payments, French for staff pages, BC/AODA rule sets, a full report editor (only area and consultation text boxes are in scope), and sending the regulator notice.
