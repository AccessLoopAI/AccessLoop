# Handoff guide: from this spec to a shipped demo

**The prototype runs entirely on this machine.** It needs no accounts, no keys, no Docker and no cloud. `npm run local` starts a real Postgres from `node_modules` and runs the app on http://localhost:3000. A local "sign in as…" page stands in for Clerk, the fake AI (`FAKE_LLM=1`) stands in for the Claude API, and email is logged, not sent. Everything is behind flags, so going live later is a configuration change, not a rewrite (see **Going live** at the end).

Build ultracode in phases: one phase per prompt, and humans check the result between phases. Each phase ends with part of `e2e/demo.spec.ts` passing against the **local production build** (`npm run e2e` starts it automatically). If a phase isn't green, don't start the next.

**Local git with parallel worktrees (human decision, 2026-10-19; it replaces the earlier "no git until submission" rule, and CLAUDE.md "Working rules" wins).** The project uses local git with no remote, so:
- **Never two writers in one folder.** Agents that edit files in parallel each work in their own git worktree: a separate checkout folder on its own branch, with its own `node_modules`, `.env.local`, app and Postgres ports and `.data/pg` database. One integration agent merges green branches into `main` one at a time. Agents that just read (reviews, research, eval reading) may share a folder. **Never push without a human asking.**
- **Rollback = the commit history on `main`** (commit green work, never `.env*`, `.data`, `node_modules`, `.next` or test output; `.gitignore` covers them) **and the human-made checkpoint zips** in `..\checkpoints\` (next to this folder; CLAUDE.md "Working rules"). A human makes a zip before and after every phase, and before any large or risky change:

```powershell
tar.exe -a -c -f "..\checkpoints\accessloop-phase1.zip" --exclude=node_modules --exclude=.next --exclude=.env.local --exclude=.data .
```

| Phase | When | Who | Done when |
|---|---|---|---|
| 0. Decisions | Oct 19 | Humans (no setup work) | The three decisions below are made |
| 1. Walking skeleton | Oct 19 | ultracode | A case created on the public form appears in the staff inbox, locally |
| 2. The loop (fake AI) | Oct 19–20 | ultracode, 3 slices **one after another** | demo.spec steps 1–4 green |
| 3. AI module + eval + dashboard | Oct 21 | ultracode | Real AI code built and tested with fakes; eval runs with fakes; the dashboard is live with seed data |
| 4. Report + verify | Oct 21–22 | ultracode | Full demo.spec green. **Features freeze at end of Oct 22** |
| 5. Harden + UI polish | Oct 23–24 noon | ultracode + human testers | Tester fixes merged; security and keyboard specs green; signature moments polished |
| 7. Prototype → shippable (Wave 1, no accounts) | Oct 20 (done) | ultracode, parallel worktrees | Every track merged on `main` and the full Definition of Done green (see **Phase 7** below) |
| G. Going live (optional) = Phase 7 Wave 2 | Oct 21–24 | Humans create accounts, ultracode wires them | Deployed URL, real AI numbers, Clerk (see **Phase 7: what is left for going live**) |
| 6. Ship | Oct 24–25 | Humans + ultracode | Submitted by 8 PM Oct 25 |

---

## Phase 0: decisions only (nothing to install or create)

Already done for you (Oct 19):
- [x] A real Postgres 17 runs locally without Docker (`embedded-postgres`). It was tested on this machine with the real security SQL: row-level security is enforced for the app's role, and all hash chains verify.
- [x] `npm run local:setup` creates `.env.local` with random secrets, so there are no keys for you to make.
- [x] The `..\checkpoints\` and `..\accessloop-holdout\` folders exist next to the project, and the first checkpoint zip is made.

Yours to decide (these aren't code):
- [ ] **Team size:** get written confirmation from the organizers (aryan@georgian.io / Discord), or reduce the team to 4 registered members.
- [ ] **Kill test:** record the outcome (2 testers, 1 accessibility lead, competitor check), or switch to TradeExit.
- [ ] **Testers:** book 2 testers with disabilities for Oct 20, Oct 23 and a demo rehearsal on Oct 24. Pay them (at least $50/hour, stated openly), and get written consent for quotes and video. The local app can be shown on your laptop. Remote testers need the deployed URL from **Going live**.

Optional, any time: write the **holdout eval set** in `..\accessloop-holdout\reports.json` (`eval/holdout/README.md`).

---

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

---

## Phase 7: from local prototype to shippable product

The prompt is `docs/phase7-prompt.md`; the review behind it is `docs/phase7-review.md`. The team ticked the approved changes in its "Human decisions" block (D1–D4, D6–D8, D10 and N1, N2, N4; not D5, D9 or N3). **Wave 1 (everything that needs no account) is built and merged on `main`** (Oct 20, local git, nothing pushed). On `main` after the final docs pass (Oct 21): typecheck and lint clean, 1339 unit tests, 57 db:smoke checks, 237 e2e tests (209 in Chromium, 27 in WebKit, the setup step), every demo step and every axe check green. Everything still runs locally with fakes; the rows of `docs/decisions.md` dated 2026-10-20 say what each track did and did not verify.

### What Phase 7 built

| Track | What it added |
|---|---|
| T1 AI layer | The `api` request shape from Anthropic's current docs (one strict tool, `tool_choice: auto`, no temperature, effort `low` for the summary, one retry on 429/529, tokens and latency in eval results); the two name checks in parallel inside one intake time budget; "AI suggestion" with a plain confidence word, not pre-selected below 0.5; keyword-anchored layer-1 patterns (SIN/NAS, dates of birth, bank transit, OHIP, PO Box, French street words, ticket IDs); a 33-case prompt-injection suite (`--set injection`); a stricter report validator (number order, length, banned words) |
| T1c eval page | `--repeats N`, `--layer1-only`, and `/app/eval` showing a measured run first, with intervals, cost and latency; fake runs labelled simulated |
| T2 staff workflow | State-machine rows D1–D4 (spam only before assignment, retriage, stop waiting, reopen from verified or closed); the honest verified-fix rate (D6) and "closed as not accessibility feedback"; truthful re-test copy; internal notes and interim accommodations; duplicates that name their original; acknowledgement honesty; "Hide a detail that was missed" |
| T2q queues | Inbox search, filters, sort and 50 to a page; due dates on assign (D8); the "A barrier was assigned to you" email |
| T2c | "Similar past barriers" on the case page (the AI may only pick from the org's own candidates; nothing is merged) |
| T3 platform | `lib/env.ts` startup check and the database-role check at boot, `/api/health`, local sign-in refused behind proxies and tunnels, `/verify` without an auth adapter, security headers, IPv6 /64 and platform-aware rate limits, a global hourly AI budget and a per-org daily cap, email sent after commit, run-time `APP_URL`, one-round re-test links (`/r/t/{token}`), the daily job (`/api/cron/daily`), owner-run retention (`npm run db:retention`), `npm run db:deploy`, the Linux wrapper, RLS forced on `orgs` and `rate_limits` (D7(b), (c)), the CI workflow |
| T4 reporter | "Other ways to reach {org}" on every org page; step 3 as one question; screen-reader fixes ("Step N of 4" in the heading, radio groups, French marked `lang="fr"`); receipt safeguards (spelled-out code, print, a calendar reminder without the code, a 2-minute cookie cleared on view, drafts in this tab by default); QR posters per location (N1, D8); the reporter JSON API `/api/v1`; a WebKit project and a WCAG 1.4.12 text-spacing check |
| T5 evidence | An Ed25519-signed org root at sign-off, the public key at `/.well-known/accessloop-signing-keys.json`, the evidence bundle, the offline checker `tools/verify-bundle.mjs`, `/verify`'s fifth check, and the sign-off lock (D7(a)) |
| T6 data | Kestrel Bay Group, a third made-up org with 14 scenario cases from published reports (cited on `/sources`); a DRAFT silver-label set (68 statements); the Feedback-section benchmark (11 rows, none verified yet, so its card stays hidden); the ACR s. 9 checklist on Settings; the CAN-ASC-5.2.1 clause 17 panel |
| T7 | The `claude-cli` backend made to work with the installed CLI 2.1.299 (flags from its `--help`; the exact sign-in command when it is signed out) |
| T8 | The Expo reporter app in `mobile/` (local prototype; web build checked, no real device yet) |
| T9 ops | `npm run db:remote-smoke` (32 read-only checks for a hosted database) and `npm run load:check` (`docs/load-check.md`) |
| T10 and the final docs pass | `/trust` made true for hosting (IP addresses and host logs, the planned services table), `SECURITY.md`, `docs/acr.md`, the architecture docs; then the point-of-collection sentence on the report form (where the words go when AI is on), README and Devpost brought up to date |

**Not built, on purpose:** the scope cuts (photo upload, SMS or phone re-test, an embeddable widget, a full French interface, SurrealDB, Jira/ServiceNow), the unapproved decisions D5 (staff-relayed verdict), D9 (encryption key ID) and N3 (Sentry), and an org-level "AI off" setting (it needs a schema change nobody approved). The Clerk adapter (D10, N2) waits for Wave 2 because it needs a Clerk account.

### Phase 7: what is left for going live

Only people can do the steps marked **(human)**; the agent steps follow the Wave 2 prompt in `docs/phase7-prompt.md`. Local mode must keep working after each one.

1. **Real AI on the team's own machine, first (human, optional, no key):** sign in the Claude Code CLI once with the team's own claude.ai account (`claude auth login`, or the exact `<path> auth login` AccessLoop prints; the desktop app's copy, 2.1.299, is already found), set `FAKE_LLM=0` and `AI_BACKEND=claude-cli` in `.env.local`, then ask an agent to run `npm run eval -- --backend claude-cli` (also `--set injection` and `--layer1-only`). Those numbers are for prompt work only and are never published.
2. **Anthropic (human):** an API key with a spend limit set in the console; decide whether to send `inference_geo: "us"` (our code sends none today; there is no Canadian option). Then the agent runs one live call per AI function and the eval with `api` (3 repeats), and a human runs `npm run eval -- --set holdout`.
3. **Supabase (human):** two projects in ca-central-1 (demo/production and preview), the `accessloop_app` role (`NOSUPERUSER NOBYPASSRLS`), the Data API turned off, both URLs with `?sslmode=require`. Then the agent runs `npm run db:deploy`, the seed, and `npm run db:remote-smoke` as the app role.
4. **Vercel (human):** link the project; choose the function region (`yul1` keeps compute in Canada; nothing sets it yet); paste every secret (`SESSION_SECRET`, `ENCRYPTION_KEY`, `RECEIPT_PEPPER`, `IP_SALT`, `RETEST_LINK_SECRET`, `CRON_SECRET`, `REPORT_SIGNING_KEY` from `node tools/signing-key.mjs --write <file>`) and `APP_URL`; production `AUTH_MODE=clerk`, `AI_BACKEND=api`, `FAKE_LLM=0`; preview `FAKE_LLM=1`, `FAKE_EMAIL=1`; a Protection Bypass secret for e2e. Keep `CRON_EXPIRE_RETEST` unset until after the demo.
5. **Clerk (human, then the agent):** Organizations on, the roles `org:lead`, `org:owner` and `org:auditor`, the three orgs and seven users of **Going live** step 2 below, sign-in path `/sign-in`, MFA required for leads. Then the agent writes the Clerk adapter (D10's "Set up AccessLoop" form included) and runs e2e against the preview URL.
6. **Email (human, optional):** a Resend domain, `RESEND_API_KEY` and `EMAIL_FROM`. Until then the Outbox shows what would be sent.
7. **Decisions only people can make (human):** an org-level "AI off" setting for organizations that need Canadian-only processing (a schema change: approve it, or keep "Don't use AI on my report" and `AI_GLOBAL_HOURLY_LIMIT=0`); how long the host keeps request logs (for `/trust`); backup targets (RPO/RTO) and one restore drill; where `ENCRYPTION_KEY` and `REPORT_SIGNING_KEY` are backed up apart from the database; a security contact (`SECURITY.md`) and an accessibility contact (`docs/acr.md`); a licence.
8. **Reviews only people can do (human):** check each line of `/trust`'s "Services we plan to use" table again; review `eval/fixtures/public-silver.draft.json` and rename it `public-silver.json`; verify each row of `data/benchmark/feedback-sections.csv` (`verified_by_human`); write the holdout set.
9. **Testing with people (human):** tester sessions with NVDA, VoiceOver and TalkBack, on the web and in the Expo app on real phones (`mobile/A11Y-TESTING.md`); findings into `docs/a11y-issues.md`.
10. **Ship (human):** push to GitHub (the CI workflow then runs for the first time), the video, the Devpost submission (`docs/devpost.md`), and the hosted demo logins once Clerk is live.

---

## Going live (optional, but it affects judging)

The local prototype is complete and demo-able on a laptop, but three judging-relevant things need accounts:

| Without it | What you lose | Account (free tier is enough) |
|---|---|---|
| Real AI | The demo runs on canned AI answers, so you **can't present them as real AI** (the rules forbid faked functionality), and there are no real eval numbers | Anthropic API key from your **$100 Build North credits** |
| A public URL | Judges can't try the app themselves during online judging (Oct 26): weaker "Tech & Deployment" | Vercel + Supabase (Canada) |
| Clerk | No "Best Use of Clerk" prize | Clerk |

The minimum worth doing is **just the Anthropic key**. In `.env.local`, set three lines: `ANTHROPIC_API_KEY=...`, `AI_BACKEND=api` and `FAKE_LLM=0`. The local app then uses real AI. Then ask ultracode:

> ultracode: An Anthropic key is now in .env.local. Run `npm run eval`, tune `lib/ai/prompts/*` until no visible-set PII leaks before human review, both injections are resisted and F17 abstains. Save results and report the metrics, including where they fall short.

If you also want a public URL and Clerk, the human steps are:
1. **Supabase** (ca-central-1): create the `accessloop_app` role with `CREATE ROLE accessloop_app LOGIN PASSWORD '<strong>' NOSUPERUSER NOBYPASSRLS;`. Use the transaction pooler (port 6543) for `DATABASE_URL` and the **session pooler** (port 5432; the direct host is IPv6-only) for `MIGRATION_DATABASE_URL`.
2. **Clerk:**
   - Turn on Organizations and create the roles `org:lead`, `org:owner` and `org:auditor`.
   - Create the 3 orgs and the users "Alex Rivera" (lead), "Facilities team" and "Web team" (owners), "Internal audit" (auditor) in Maple Harbour Bank; "Other org lead" (Lakeview lead); and "Riley Brennan" (lead) and "Operations team" (owner) in Kestrel Bay Group, using `+clerk_test` emails. Put each user in exactly one org. Their IDs go in the `SEED_*` lines of `.env.example`.
   - Set the sign-in path to `/sign-in`.
3. **Vercel:**
   - Run `npx vercel login` and `npx vercel link`.
   - Add the env vars, with `AUTH_MODE=clerk` on Vercel. Production: `AI_BACKEND=api`, `FAKE_LLM=0`. Preview: `FAKE_LLM=1`, `FAKE_EMAIL=1`.
   - Create a Protection Bypass secret.
4. **Resend:** only if you want real emails. Otherwise the Outbox page shows what would be sent.

Then:

> ultracode: Going live (docs/handoff.md). Add the Clerk adapter behind `AUTH_MODE=clerk` exactly as CLAUDE.md's Clerk bullets describe (proxy, `<SignIn />` at /sign-in, select-org, role mapping, an upsert that never overwrites names), keeping local mode working. Run migrations, security SQL and seed on Supabase, deploy with `npx vercel deploy`, and run the full e2e against the preview URL.

---

## Phase 6: ship (mostly humans)
- [ ] **Publish the GitHub repo (Oct 24 morning).** Devpost requires a public repo. Local git is already set up: `main` holds the build's commit history (a baseline commit, then green work merged from the worktree branches) and nothing has been pushed. Nothing is pushed until a human asks (CLAUDE.md "Working rules"); a human decides when, once the team says so. Start by reviewing `.gitignore`: it must exclude `.env*`, `.data`, `.vercel`, `node_modules`, `.next`, test output and the holdout (`eval/holdout/README.md` is the one tracked file there). Then, in the main project folder, run:
  ```powershell
  git status            # should be clean: every green change is committed on main
  git ls-files | Select-String -Pattern "\.env|\.data/|\.vercel/"   # expect just .env.example
  git log --oneline     # read the history that will be public
  ```
  Then create an empty **public** GitHub repo (no README or licence, so the push needs no merge), add it with `git remote add origin <the repo URL>` and, when the team says so, run `git push -u origin main`. (Done on Oct 25: the public history was re-created that day before the first push, so its commit times are reconstructed; the dated checkpoint zips are the record. See "Prior work" in docs/overview.md.)
- [ ] Record the 2-minute video (≤ 2:00, public, captioned) with the real tester. Also record a backup of the screen-reader segment with NVDA Speech Viewer captions.
- [ ] Ask ultracode to write the README (problem, users, **how to run it locally in one command**, how to test, architecture diagram, eval table, privacy and limits) and the Devpost text from docs/domain.md. Humans edit it.
- [ ] Devpost disclosures:
  - AI tools used: Claude Code / ultracode for spec and implementation; Claude models in the product (or "AI responses are simulated in this build" if you never added a key).
  - Prior work: none. The spec was written Oct 18–19, the build ran Oct 19–25, and the public git history was re-created on Oct 25 before the first push (commit times are reconstructed; the dated checkpoint zips are the record).
  - Sponsors: Clerk only if you did Going live.
- [ ] Judge access: the deployed URL (if any) plus the one-command local run instructions.
- [ ] Submit by 8 PM EDT, Oct 25.

---

## Demo-day failure plan

| Failure | Fallback |
|---|---|
| Venue Wi-Fi / LLM slow | Run the laptop copy with `npm run local` (no internet needed) and `FAKE_LLM=1`; say so honestly if asked |
| Screen-reader audio inaudible | Play the captioned backup clip for that segment |
| Email question | The receipt page is the acknowledgement; show the Outbox page |
| Sign-in issue | Local mode's "Sign in as…" page always works on the laptop |
