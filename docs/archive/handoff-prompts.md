> **Archived (2026-10-28):** the agent prompts pasted into docs/handoff.md to build AccessLoop, kept as they were written and run; they are not current guidance (CLAUDE.md and docs/domain.md are).

# Handoff prompts (archived)

Moved here from docs/handoff.md, which keeps the plan, the checklists and what is left for going live.

## Phase prompts (paste into ultracode one at a time)

Each prompt assumes ultracode is running in the project folder (or, for a parallel track, in its own git worktree) and reads `CLAUDE.md`. **Make a checkpoint zip before and after each phase.**

The prompts below are kept as they were written and run: the code parts of Phases 1–5 are built and merged on `main`. Where a prompt says to build slices one after another or with one writer, that was the rule before the 2026-10-19 local-git decision. Today parallel tracks each get their own worktree and branch, and never two writers share one folder (CLAUDE.md "Working rules").

### Phase 1: walking skeleton (local)

> ultracode: Build Phase 1 of AccessLoop as described in docs/handoff.md, following CLAUDE.md and docs/domain.md. This is the LOCAL prototype: no accounts, no deploys.
>
> 1. Scaffold Next.js 16 (App Router, TS strict, Tailwind, no `src/` dir) **in a temp folder and copy it in**, without overwriting any existing file. Set tsconfig paths `"@/*": ["./*"]`. Install only the dependencies listed in CLAUDE.md, at the pinned versions where given. Add every npm script from CLAUDE.md.
> 2. Add drizzle.config.ts (schema `db/schema.ts`, out `db/migrations`, dialect postgresql, loading `.env.local` as CLAUDE.md says). Run `npm run db:generate`, then get `npm run db:smoke` green (24/24 checks; it passed against this exact schema on Oct 19). Then run `npm run local:setup`, which also passed on this machine on Oct 19.
> 3. Auth, local mode, exactly as CLAUDE.md "Auth" describes: `lib/auth/staff.ts` with `getStaff()`; `/sign-in` with POST "Sign in as {name} ({org})" buttons; a `/sign-out` POST; landing pages (lead and auditor → `/app/inbox` for now, owner → a stub `/app/my-work`); `proxy.ts` protecting only `/app/:path*`. Use the frozen `lib/auth/local-session.ts`. **Do not add Clerk yet** (it comes in Going live). `@clerk/testing` is installed but only used in clerk mode.
> 4. **Design system** (CLAUDE.md "UI quality bar"): tokens, light and dark themes, local font files (`next/font/local`), focus ring, and the `components/ui/` primitives, plus a hidden `/app/design` page showing every component in every state (axe-checked). Load the `frontend-design` skill if you have it. Take your time here: every later page is built from these.
> 5. **The reporter flow and receipt, complete**, exactly as domain §4 and step 1 of `e2e/demo.spec.ts` describe: 4 screens, the AI disclosure, the "Check your report" review with "Your words" and "We understood", "Send report", and the receipt page with the receipt code, case ref, "Copy code" and "Download as a text file". The summary comes from `lib/ai/structure()` through the **fake backend only** (`lib/ai/fakes/structure.json`); the other backends come in Phase 3. The server runs layer-1 redaction plus fake `flagPii` and calls `createCase` with `ai.backend: "fake"`. Also build `/app/inbox` as a table of cases. Everything uses the design system.
> 6. Write tests:
>    - vitest for `lib/receipt-code`, `lib/case-events` (chain + tamper detection), `lib/state-machine` (every row of the domain §3 table, plus illegal moves), `lib/report/headings`, `lib/crypto`.
>    - `e2e/security.spec.ts` with the **Phase 1** checks from domain §9.
>
> Done = typecheck, lint, test and db:smoke green; `$env:DEMO_UNTIL_STEP=1; npm run e2e` green (it builds and starts the app itself, with fakes); the security spec green; `npm run local:serve` builds with the network off (local fonts); a case submitted on http://localhost:3000 shows in the inbox. Stop any server you started. List anything you could not verify.

### Phase 2: the loop, with fakes (3 slices, one after another)

> ultracode: Build Phase 2 of AccessLoop (docs/handoff.md), locally. Build the three slices **sequentially, never with two file-editing agents at once**; finish each (tests green) before the next. Parallel agents are allowed only for read-only review. `FAKE_LLM=1` and `FAKE_EMAIL=1` throughout. `lib/ai/` exists only as the typed interface plus fakes reading `lib/ai/fakes/*.json`.
>
> - **Slice A, reporter side** (`app/o/**`, `app/r/**`, `app/check/**`): the intake flow already exists from Phase 1. Add autosaved drafts, "Change it" and "Keep my words only", the "Don't use AI" path, rate limits, the re-test page `/r/[code]` (POST-only verdicts, the five answers, the gift-card line, the confirmation sentence from domain §3) and `/check`, all exactly as domain §4 and e2e/demo.spec.ts describe.
> - **Slice B, staff case flow** (`app/(staff)/app/inbox/**`, `app/(staff)/app/cases/**`, `app/(staff)/app/my-work/**`): redaction review (highlighted spans, add/remove, approve), logged "Show original", triage, assign, owner log-fix with evidence, a history region rendering the events, and the status labels used in demo.spec.
> - **Slice C, channels and messages** (`app/(staff)/app/cases/new/**`, `lib/email/**`, `app/(staff)/app/settings/**`, `app/(staff)/app/outbox/**`): staff-logged intake for email, phone, mail and in-person; acknowledgement in the same means; acknowledgement and re-test emails logged to `outbound_messages` (FAKE_EMAIL); a lead-only **Outbox** page showing them, so the demo can show "the email that would have been sent"; and the org settings page.
>
> Every slice uses only the frozen core for writes and only `components/ui/` for UI. Build signature moment 1 (the verified moment) in Slices A and B. Add `e2e/screenshots.spec.ts`. Add the **Phase 2** security checks from domain §9. Done = `$env:DEMO_UNTIL_STEP=4; npm run e2e` green, with axe clean on every page touched.

**Humans after Phase 2 (Oct 20):** first tester session on your laptop (`npm run local`), with NVDA (and VoiceOver if a tester uses a Mac). Log every problem in `docs/a11y-issues.md`.

### Phase 3: AI module and eval harness

> ultracode: Build Phase 3 of AccessLoop (docs/handoff.md). There is **no API key yet**. Everything must work and be tested with `AI_BACKEND=fake`. The `claude-cli` and `api` backends must switch on by env alone (domain §6.1).
>
> 1. Implement `lib/ai/structure`, `flagPii` and `phraseClaims` with the zod schemas from domain §6, versioned prompts, `<report>` delimiters and the fallbacks (manual triage, `needsManualRedaction`). Build the three backends in `lib/ai/backends/` exactly per §6.1: the `claude-cli` flags, isolation, stdin input, no `--bare`, stripping `ANTHROPIC_API_KEY`, the 60 s timeout, one call at a time, the startup checks and the localhost-only guard; and `api` with tool use and a 10 s timeout. Unit-test the parsing, fallbacks and guards with a stubbed client and a stubbed child process. Never call a real model in tests.
> 2. Wire them into intake: the review step shows the AI summary, and the `aiOptOut` path skips the LLM.
> 3. Write `eval/run.ts`: fixtures → layer 1 → `flagPii` → `structure` → `score()`, with `structure()` output feeding `Prediction.summary`. Add a zero-shot baseline flag and a `--set holdout` option that reads `HOLDOUT_PATH` (outside this folder; never open it yourself). Save results to `eval/results/`, with the backend in the file name and content. If the selected backend isn't usable (no key for `api`, CLI missing or logged out for `claude-cli`), the runner says exactly that and exits without saving. With `fake`, it runs as a harness check and marks the results as simulated.
> 4. Add an `/app/eval` page that renders the latest saved results as accessible tables, or "No eval run yet" when there are none.
> 5. **Dashboard v1** (domain §10, CLAUDE.md signature moment 4): `lib/metrics/` as pure functions taking `now` and returning values plus case IDs. Unit-test them against a freshly seeded PGlite database with `now = 2026-10-19`, reproducing domain §10's expected-values table exactly. Then build `/app/dashboard` with the header and deadline banner, all tiles, the four charts with "Show as table", "Needs attention", and the two cards (the report-readiness card may say "Available in Phase 4"); inbox filters so every number links to its cases. Add `e2e/dashboard.spec.ts`: tiles match `lib/metrics/` computed on the same database at test time (never hard-coded numbers), a tile click lands on the right filtered inbox, the table toggles work, and axe is clean at 1440 px and 390 px in both themes. Add the dashboard to `e2e/screenshots.spec.ts`.
>
> Done = tests green; demo.spec green with `DEMO_UNTIL_STEP=4`; the runner works end to end with fakes and records `backend` in every result file. If `claude auth status` shows a logged-in CLI on this machine, also do one smoke run of `AI_BACKEND=claude-cli npm run eval` and report what you see. Don't tune prompts against it yet. **Never edit labels or score.ts.**

**Using your Claude subscription for real AI during development (optional, no key needed):**
1. Install the CLI once in PowerShell: `npm install -g @anthropic-ai/claude-code`. On Windows, the copy the Claude desktop app bundles is also found by itself (README, "Real AI on your own machine"). Then sign it in once with the team's own Claude account: `claude auth login`, or the exact `<path> auth login` command that AccessLoop's error message gives. `claude auth status` should show `"authMethod": "claude.ai"`. AccessLoop never signs in for you.
2. In `.env.local`, change **both** lines: `AI_BACKEND=claude-cli` and `FAKE_LLM=0`.
3. Then ask ultracode to tune prompts with `npm run eval`. Results are labelled `claude-cli`. In a PowerShell one-off: `$env:FAKE_LLM=0; $env:AI_BACKEND="claude-cli"; npm run eval`.

Limits (domain §6.1): this is for **your own development only**. Testers, judges and the demo audience count as users, so switch to `AI_BACKEND=api` with a key (or `fake`, labelled as simulated) for them. Answers vary between runs, so don't publish its eval numbers. It is slower (about one CLI start per call). It uses your subscription's limits.

### Phase 4: report generator and evidence check

> ultracode: Build Phase 4 of AccessLoop (domain §7 and §8), locally.
>
> 1. Snapshot and `manifestHash`; the fact compiler (all facts in §7) as pure tested functions.
> 2. Compute the report facts with the same `lib/metrics/` functions the dashboard uses (add any missing ones there, not in the report code). Claims and templates; `phraseClaims` (the fake returns the template text); `lib/report/validate.ts` with its fallback to the template; `checkProgressReport` as a live checklist region.
> 3. Text boxes for areas and consultations; sign-off (immutable after); the published page `/p/[orgSlug]/reports/[id]` with footnote source buttons and print CSS; plain-text export.
> 4. Build signature moments 2 and 3 from CLAUDE.md "UI quality bar" (the report building itself; the evidence chain). Then `/verify/[reportId]` using `verifyCaseChain` and the replay. The org comes from the staff session, or from `resolvePublishedReport()` for anonymous visitors. Layout as in domain §8 (one "Records" table row per case).
> 5. Tests:
>    - vitest for facts and the validator: an invented number is rejected; an uncited sentence is rejected; a foreign case ref is rejected.
>    - vitest for the replay: a replay of seeded events matches the snapshot.
>    - An e2e that alters `reports.snapshot` through `MIGRATION_DATABASE_URL` and expects `/verify` check 1 to turn red. It also checks that an UPDATE on `case_events` raises an error.
>
> Done = the full `npm run e2e` green (no `DEMO_UNTIL_STEP`). After this, scope is frozen: only fixes.

### Phase 5: harden

> ultracode: Phase 5 of AccessLoop.
>
> 1. Fix every open entry in `docs/a11y-issues.md` and mark each one fixed, with how you verified it.
> 2. Add `e2e/keyboard.spec.ts`, which completes the whole reporter flow and re-test with the keyboard only, asserting focus after each step. Add reflow at 320 px and forced-colors checks.
> 3. Finish the dashboard: wire the report-readiness card to real drafts and make the evidence-integrity card link to the latest `/verify`. Then build `/trust` and `/accessibility`. Optional: `/api/metrics` (domain §10).
> 3b. **UI polish pass:** review `e2e/screenshots/` at desktop and mobile, light and dark. Fix spacing, hierarchy, empty states, loading states and copy until every key screen looks finished. Keep the axe checks green throughout.
> 4. Then run a review workflow over the whole project with three dimensions. Reviewers are read-only and may run in parallel. Each finding is verified adversarially before it is reported:
>    - correctness vs docs/domain.md;
>    - security (tenancy, PII in logs, receipt codes, rate limits, injection, local auth never reachable off localhost);
>    - accessibility.
>
> Fix what is confirmed, one fix at a time (one writer).

**Humans (Oct 23–24):** second tester session; review the screenshots and list anything that doesn't look finished (give it to ultracode as one more polish round); then a full rehearsal of the 2-minute demo.

## Going live prompts

### Real AI with an API key

> ultracode: An Anthropic key is now in .env.local. Run `npm run eval`, tune `lib/ai/prompts/*` until no visible-set PII leaks before human review, both injections are resisted and F17 abstains. Save results and report the metrics, including where they fall short.

### Clerk, a hosted database and a deploy

> ultracode: Going live (docs/handoff.md). Add the Clerk adapter behind `AUTH_MODE=clerk` exactly as CLAUDE.md's Clerk bullets describe (proxy, `<SignIn />` at /sign-in, select-org, role mapping, an upsert that never overwrites names), keeping local mode working. Run migrations, security SQL and seed on Supabase, deploy with `npx vercel deploy`, and run the full e2e against the preview URL.
