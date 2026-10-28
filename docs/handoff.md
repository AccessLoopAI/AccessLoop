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

## Phase prompts (archived)

The agent prompts that built Phases 1–5, and the two Going live prompts, are kept as they were written and run in [docs/archive/handoff-prompts.md](archive/handoff-prompts.md). The code they describe is built and merged on `main`.

---

## Phase 7: from local prototype to shippable product

The prompt is `docs/archive/phase7-prompt.md`; the review behind it is `docs/archive/phase7-review.md`. The team ticked the approved changes in its "Human decisions" block (D1–D4, D6–D8, D10 and N1, N2, N4; not D5, D9 or N3). **Wave 1 (everything that needs no account) is built and merged on `main`** (Oct 20, local git, nothing pushed). On `main` after the final docs pass (Oct 21): typecheck and lint clean, 1339 unit tests, 57 db:smoke checks, 237 e2e tests (209 in Chromium, 27 in WebKit, the setup step), every demo step and every axe check green. Everything still runs locally with fakes; the rows of `docs/decisions.md` dated 2026-10-20 say what each track did and did not verify.

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

Only people can do the steps marked **(human)**; the agent steps follow the Wave 2 prompt in `docs/archive/phase7-prompt.md`. Local mode must keep working after each one.

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

The minimum worth doing is **just the Anthropic key**. In `.env.local`, set three lines: `ANTHROPIC_API_KEY=...`, `AI_BACKEND=api` and `FAKE_LLM=0`. The local app then uses real AI. Then an agent runs the eval and tunes the prompts (the original prompt is in [docs/archive/handoff-prompts.md](archive/handoff-prompts.md)).

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

Then an agent adds the Clerk adapter, sets up the hosted database and deploys (the original prompt is in [docs/archive/handoff-prompts.md](archive/handoff-prompts.md)).

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
