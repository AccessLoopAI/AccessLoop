# AccessLoop: rules for every agent

AccessLoop turns accessibility feedback into fixes that the person affected confirms. It also drafts the Feedback section of the Accessible Canada Act progress report, with every sentence linked to its records. It was built for Build North 2026, whose submission deadline (Oct 25, 8 PM EDT) has passed. Work now follows the team's v2 plan ("AccessLoop v2: real AI, a live demo, near-zero cost"), tracked as GitHub issues by lane (see "Lanes" below).

**Local-first.** The prototype runs entirely on the dev machine with **no accounts**: a real Postgres from `embedded-postgres`, local sign-in instead of Clerk (`AUTH_MODE=local`), fake AI (`FAKE_LLM=1`) and logged email (`FAKE_EMAIL=1`). `npm run local:setup` then `npm run local` runs everything. Clerk, Vercel and the real API key come only in the "Going live" step of docs/handoff.md, and everything must keep working in local mode after that.

Read before any task:
- `docs/domain.md`: what the product does, the legal text, the state machine, security. **It wins every disagreement.**
- `e2e/demo.spec.ts`: the acceptance test. Its accessible names are the UI contract.
- `docs/handoff.md`: which phase you are in and what "done" means for it.

## Frozen files (do not edit without a human saying so in this task)

`db/schema.ts`, `db/client.ts`, `db/tenant.ts`, `db/sql/0100_security.sql`, `lib/case-events.ts`, `lib/state-machine.ts`, `lib/crypto.ts`, `lib/receipt-code.ts`, `lib/cases/create.ts`, `lib/report/headings.ts`, `lib/auth/local-session.ts`, `eval/score.ts`, `scripts/local.ts`, and the labels in `eval/fixtures/reports.json`.

`lib/redaction/patterns.ts` and `tests/redaction.patterns.test.ts` may only grow: add patterns or cases, but never remove or loosen any.

If a frozen file blocks you, stop and say exactly what change you need and why. Do not work around it. Code that bypasses these files is a bug, for example writing `cases.status` directly, inserting into `case_events` without `appendCaseEvent`, or querying tenant tables outside `withOrg`.

## Stack (pinned, no new dependencies without a human OK)

- **Next.js 16.x** (App Router, TypeScript strict). There is **no `src/` dir**, and `tsconfig` paths map `"@/*": ["./*"]`. Deploy on **Vercel**. Next 16 renamed middleware to **`proxy.ts`** and removed `next lint`.
- **Postgres** through `postgres` (postgres.js) + `drizzle-orm` / `drizzle-kit`. Migrations live in `db/migrations/`. `db/sql/0100_security.sql` is applied after them.
- **Auth: one interface, two modes.** All staff pages call `getStaff()` from `lib/auth/staff.ts`, which returns `{ orgId, memberId, role, displayName } | null`. `orgId` is our `orgs.id`, never a Clerk ID.
  - **`AUTH_MODE=local` (now):** `/sign-in` renders only when `localAuthAllowed(host)` is true (otherwise 404). It reads `orgs`, then lists each org's members with `withOrg({ orgId, role: "system" })`, as `<form method="post">` buttons named exactly "Sign in as {display name} ({org name})". The POST sets the cookie from the frozen `lib/auth/local-session.ts` (httpOnly, SameSite=Lax, path `/`, max-age `LOCAL_SESSION_MAX_AGE_S`). It then redirects leads and auditors to `/app/dashboard` (`/app/inbox` until Phase 3) and owners to `/app/my-work` (a stub page in Phase 1). A "Sign out" button in the staff header is a `<form method="post" action="/sign-out">` that deletes the cookie and redirects to `/sign-in`. `getStaff()` verifies the cookie, finds `orgs` by `clerk_org_id` and `org_members` by `clerk_user_id`. Local auth must refuse to work unless `localAuthAllowed(host)` is true (localhost only, never on Vercel). `proxy.ts` checks the cookie for `/app/:path*`. No Clerk package is loaded in this mode.
  - **`AUTH_MODE=clerk` (Going live only, not before):** the rules below.
- **Clerk** (`@clerk/nextjs`, added at Going live): `clerkMiddleware()` exported from **`proxy.ts`**, async `auth()`, roles checked with `has({ role: "org:lead" })`. **No Pages Router, no `authMiddleware`.** `<ClerkProvider>` wraps only the staff layout `app/(staff)/layout.tsx`, so reporter pages never load Clerk UI. Pass `signInUrl="/sign-in"` (also in `NEXT_PUBLIC_CLERK_SIGN_IN_URL`). The proxy protects only `/app/:path*`; everything else stays public.
  - **Active org:** staff pages need `auth().orgId`. If it is null, redirect to `/app/select-org`, which shows Clerk's `<OrganizationList hidePersonal afterSelectOrganizationUrl="/app/dashboard" />`. The e2e helper sets the org itself.
  - **Org mapping:** look up `orgs` by `clerk_org_id`. With no row, show a plain "This organization isn't set up in AccessLoop yet" page (404 status). Never auto-create an `orgs` row.
  - **Roles:** only `org:lead`, `org:owner` and `org:auditor` mean anything. Any other Clerk role (e.g. the default `org:admin`/`org:member`) gets the same 404.
  - **`org_members` upsert on each staff request:** on insert, `display_name` = Clerk full name, else the email. **On conflict, update `role` only. Never overwrite `display_name`** (the seed and demo rely on names like "Facilities team").
- **@anthropic-ai/sdk**, **zod**, **resend**.
- **Tailwind CSS.** Native HTML elements only. No component library that renders custom selects, comboboxes, date pickers, drag-and-drop or toasts.
- **embedded-postgres@17.9.0-beta.16** (dev dependency; every release of this package is tagged "beta"; this one was tested on this machine Oct 19) for the local database. It is used only by `scripts/local.ts`.
- Tests: **vitest** (unit and eval), **@playwright/test** + **@axe-core/playwright** + **@clerk/testing** (e2e; Clerk helpers are only used in clerk mode), **tsx** for scripts, and **@electric-sql/pglite** + **@electric-sql/pglite-socket** (dev only, for `db:smoke`). **cross-env** and **rimraf** keep npm scripts cross-platform.

Every route or server action that touches the DB, crypto or AI must declare `export const runtime = "nodejs"`.

**Env loading outside Next.js** (no dotenv): `tsx` scripts use Node's `--env-file-if-exists=.env.local` flag; `drizzle.config.ts` starts with `try { process.loadEnvFile(".env.local") } catch {}`; `playwright.config.ts` already does the same.

## Required npm scripts

Scripts must work in Windows PowerShell and in bash: no `rm -rf`, no inline `VAR=x`, no `&&` chains that assume bash.

| script | does |
|---|---|
| `dev`, `build`, `start`, `typecheck` (`tsc --noEmit`) | as usual |
| `lint` | `eslint .` (create-next-app's flat config). Fix code, don't add disable comments without a reason |
| `test` | `vitest run` |
| `local:setup` | `tsx scripts/local.ts setup`: creates `.env.local` (random secrets), inits Postgres in `.data/pg`, migrates, applies security SQL, seeds. Idempotent |
| `local` | `tsx scripts/local.ts dev`: Postgres + `next dev` on http://localhost:3000 |
| `local:serve` | `tsx scripts/local.ts serve`: Postgres + `next build` + `next start` (Playwright's webServer uses this) |
| `local:db` | `tsx scripts/local.ts db`: only Postgres, foreground |
| `local:reset` | `tsx scripts/local.ts reset`: delete `.data/pg` and set up again |
| `e2e` | `playwright test`. Against localhost it starts `local:serve` itself, with fakes forced. It does **not** reuse a running app unless `E2E_REUSE=1`. Gates: `DEMO_UNTIL_STEP=1` in Phase 1, `4` in Phases 2–3, unset from Phase 4 (PowerShell: `$env:DEMO_UNTIL_STEP=1; npm run e2e`) |
| `eval` | `tsx --env-file-if-exists=.env.local eval/run.ts` → prints metrics JSON and writes `eval/results/` |
| `db:generate`, `db:migrate` | drizzle-kit, using `MIGRATION_DATABASE_URL` |
| `db:security` | `tsx --env-file-if-exists=.env.local scripts/apply-sql.ts db/sql/0100_security.sql` (owner URL) |
| `db:seed` | `tsx --env-file-if-exists=.env.local db/seed.ts` (add `-- --reset` only where `SEED_ALLOW_RESET=1`) |
| `db:smoke` | `tsx scripts/db-smoke-run.ts`: a runner that serves an in-memory PGlite on 127.0.0.1:5544 (8 connections) through the `@electric-sql/pglite-socket` library, runs `node node_modules/tsx/dist/cli.mjs scripts/db-smoke.ts` against it, then stops the server and exits with the smoke test's exit code. It replaces the literal `pglite-server --run` command, because that CLI (every release up to 0.2.13) never exits after a green run: it keeps serving, so the script never ended and held port 5544 (docs/decisions.md, 2026-10-19). Checks migrations, security SQL, seed, chains, trigger, RLS, guards (57 checks). **Must stay green.** |

Now the database is the **local one** in `.data/pg`: agents may freely migrate, seed and reset it (`npm run local:reset`). At Going live, the Supabase project is the dev/demo database, and agents may use its `MIGRATION_DATABASE_URL` the same way.

## Routes

| Route | Who | Notes |
|---|---|---|
| `/o/[orgSlug]/report` → `/o/[orgSlug]/receipt` | public | 4-step reporter flow (domain §4) |
| `/r/[code]`, `/check` | public (receipt code) | GET renders only; verdicts are POST |
| `/p/[orgSlug]` and `/p/[orgSlug]/reports/[id]` | public | Feedback-process description + published reports |
| `/verify/[reportId]` | public if published, staff of the org if draft | Chain check. Signed-in staff: org from Clerk. Anonymous: org from `resolvePublishedReport()` (null → 404) |
| `/trust`, `/accessibility` | public | Data handling; our own conformance notes plus a link into our own feedback form |
| `/sign-in` | public | Local mode: "Sign in as …" buttons (localhost only). Clerk mode: `<SignIn />` at `/sign-in/[[...sign-in]]`. The e2e helper starts here |
| `/app/select-org` | signed in | Clerk mode only: shown when no org is active |
| `/app/outbox` | lead | Messages logged to `outbound_messages` (what would have been emailed) |
| `/app/dashboard` | lead, auditor | Staff home (domain §10). Owners are sent to `/app/my-work` |
| `/app/inbox`, `/app/cases/new` | lead | `cases/new` = staff-logged phone/mail/email intake. The inbox accepts filter query params (status, area, channel, month, attention) so dashboard links land on exactly the cases behind a number |
| `/app/cases/[ref]` | lead (full); owner (only if assigned, else 404; never "Show original"); auditor (read-only) | `ref` is unique per org only: always look it up inside the active org |
| `/app/my-work` | owner | Assigned cases only |
| `/app/reports`, `/app/reports/new`, `/app/reports/[id]` | lead (auditor read-only) | |
| `/app/settings` | lead | Org settings (ACR s.9(1), s.14(2) fields) |
| `/app/eval` | lead | Latest saved eval results |

## UI quality bar: make it impressive AND accessible

The UI is judged ("UI & Design") and it carries the demo. Accessibility rules are the floor, not the ceiling: impressive here means **beautiful, calm and obviously crafted, while it passes axe and works with a screen reader**.

**Two personalities, one design system**
- **Reporter side:** calm and warm, with big type (18 px+ body), generous spacing, one question per screen, high contrast (aim for AAA on body text), and nothing that moves unless asked. It should feel like the kindest form the person has ever filled in.
- **Staff side:** a crafted "command centre", with a dashboard of metric tiles, a case timeline that shows the evidence chain, and a report that looks like a finished publication.

**Design system first (Phase 1), used everywhere after**
- Design tokens as CSS variables (colour, type scale, spacing, radius, shadow, motion), with light and dark themes, a deliberately designed focus ring, and correct forced-colors mode.
- Fonts via **`next/font/local`** only, never `next/font/google`: the build must work offline. Use **Atkinson Hyperlegible Next** for body text (designed for low-vision readers, which is part of the story) and one distinctive OFL-licensed display face for headings. Download the WOFF2 files once in Phase 1 into `app/fonts/`, with their licence files.
- Accessible primitives in `components/ui/`: Button, Field, RadioGroup (fieldset/legend), Select, Table, StatusBadge, Card, PageHeader, Disclosure, Timeline, Stat, EmptyState. Every page builds from these, so design changes stay one-file changes.
- If the `frontend-design` skill is available to you, load it before designing.

**Signature moments the demo leans on (build these with care)**
1. **The verified moment:** when the reporter answers "Yes, it works now", the case timeline completes and the status badge turns to "Verified by reporter" with a short, tasteful transition (none under `prefers-reduced-motion`). The staff case page shows the same.
2. **The report building itself:** "Generate draft" fills sections in order while the "Report checks" list ticks green. A sentence's sources open as cards beside it.
3. **The evidence chain:** `/verify` draws each case as a chain of linked records with short hash chips. When tampered, the broken link turns red with a plain-language explanation. It stays a real `<table>` underneath for screen readers.
4. **The dashboard** (`/app/dashboard`, domain §10): the staff home page and the demo's opening and closing shot. It has a verified-fix-rate ring, metric tiles, the loop funnel, monthly and per-area charts (hand-built SVG, using domain §10's chart accessibility pattern), a "Needs attention" list, and report-readiness and evidence-integrity cards. Every number comes from `lib/metrics/`, which the report also uses, and clicking any number shows the cases behind it.

**Allowed extras for this:** `lucide-react` (icons, always `aria-hidden` next to visible text) and `motion` (animations that must respect `prefers-reduced-motion`). No chart libraries: hand-built SVG plus data tables.

**Visual QA:** `e2e/screenshots.spec.ts` saves full-page screenshots of the key screens (desktop 1440 px and mobile 390 px, light and dark) to `e2e/screenshots/` after each phase, for humans to review. These are not pixel assertions.

## Accessibility contract (CI fails on any violation)

The product's own accessibility is what the pitch rests on. Treat these as hard requirements, not polish.

- Every page and state passes `expectNoAxeViolations` (WCAG 2.0/2.1/2.2 A+AA) in `e2e/`.
- **Native elements only:** `<button>`, `<a>`, `<label for>`, `<fieldset>` + `<legend>` for radio groups, native `<select>`, `<input type="date">`. No `div onClick`. No `aria-label` where a visible label works (WCAG 2.5.3).
- One `<h1>` per page. After every step change or submit, **move focus to the new heading**. One polite live region (`role="status"`) for status messages. Never stream AI output into a live region.
- **Never:** modals in the reporter flow, drag-and-drop (2.5.7), toasts as the only feedback, timeouts, CAPTCHAs, auto-advancing steps, or placeholder text used as a label.
- Targets are at least 44×44 px. Focus is always visible and never hidden under sticky headers (2.4.11). The layout reflows at 320 px and 400% zoom, and works in forced-colors mode.
- The same "Get help" link appears in the same place on every page (3.2.6). No redundant entry (3.3.7). Sign-in allows paste and has no cognitive test (3.3.8).
- Reporter copy targets a grade 6–8 reading level and never uses the words "priority area" or "barrier classification".
- Owner queues and inboxes are `<table>`s with `<th scope>`, not boards.
- Generated reports: correct `<h2>` headings and footnote-style source buttons named "Sources for this sentence (N records)", never bare "R-012" links.

Automated checks catch only part of this. Humans test with NVDA, VoiceOver and keyboard after each slice (docs/handoff.md).

## AI contract

- All LLM calls live in `lib/ai/` as typed functions (`structure`, `flagPii`, `phraseClaims`; see domain §6) with zod-validated JSON output and prompts in `lib/ai/prompts/*.md`. Each prompt file's sha256 is recorded in event payloads.
- **Effective AI backend = `FAKE_LLM=1` ? `fake` : `AI_BACKEND`.** To get real AI you must set BOTH `FAKE_LLM=0` and `AI_BACKEND` (`claude-cli` or `api`); `npm run local:setup` writes `FAKE_LLM=1` and `AI_BACKEND=fake`. Playwright's local web server always forces `FAKE_LLM=1`, `FAKE_EMAIL=1`, `AI_BACKEND=fake`, whatever `.env.local` says.
- **Three backends behind `AI_BACKEND`** (domain §6.1), in `lib/ai/backends/{fake,claude-cli,api}.ts`, sharing prompts, schemas and fallbacks:
  - `fake` (default) reads `lib/ai/fakes/*.json`.
  - `claude-cli` spawns the user's logged-in Claude Code CLI. It is for the team's own local use only, with the exact flags, isolation and hard limits in §6.1, and it refuses to run off localhost.
  - `api` uses `@anthropic-ai/sdk` (tool use with `tool_choice: auto`, no temperature sent because the current models reject one, 10 s timeout).
- E2E and CI always use fakes (Playwright forces them). Never let one backend fall back silently to another.
- Reporter text is **untrusted data**. Wrap it in `<report>…</report>` delimiters, put it in the user turn and never in the system prompt, and tell the model to ignore instructions inside it.
- AI output never changes case state, never writes report numbers (domain §7), and never sees unmasked text: layer-1 redaction runs first.
- Model IDs come from env (`MODEL_*`). Never hard-code them elsewhere.

## Security rules

- Tenant tables are touched only through `withOrg()`. The org always comes from the server: the Clerk org mapped to `orgs.clerk_org_id`, a slug lookup, or `resolveReceipt()`. Never from a request body or query string.
- Owners get 404 (not 403) for cases not assigned to them. Cross-tenant access → 404.
- Never log raw report text, emails, receipt codes or IPs. `console.log` of request bodies is a bug.
- Any free text a person types that goes into an event payload passes through layer-1 redaction first. `transition()` already does this for its fields; do the same for any `note_added` or other event you append.
- Staff-logged intake: the receipt code goes to the reporter by the system (email), or is shown once with "Read this code to the person; it won't be shown again". Mark it in the `submitted` payload (`codeRelayedByStaff: true`). Report facts count those verifications separately (domain §3).
- Public routes are rate-limited with the `rate_limits` table, keyed by `hmacHex("IP_SALT", ip + date)`.
- Photos: strip EXIF on the server before storing; alt text is required.
- Never write "compliant", "certified" or "guarantees" in UI copy. Write "helps you meet your obligations".

## Definition of done (every task)

1. `npm run typecheck`, `npm run lint`, `npm test` and `npm run db:smoke` all pass.
2. The relevant `e2e/` tests pass with `FAKE_LLM=1` against the **local production build** (`npm run e2e` starts `local:serve`), not only against `next dev`. After Going live, they must also pass against the Vercel preview URL (`E2E_BASE_URL`); preview deployments have `FAKE_LLM=1` and `FAKE_EMAIL=1`.
3. No new axe violations; any new page has an axe check in a spec.
4. If you touched `lib/ai/prompts/*` or `lib/redaction/*`, an eval run is saved in `eval/results/`.
5. Your final report lists what you changed and what you did **not** verify.

Do not report "done" against mocks alone. If something can't be verified (missing env or account), say so plainly.

## Working rules

- **GitHub with pull requests; parallel agents in separate worktrees.** The repository is `AccessLoopAI/AccessLoop` on GitHub. It has two maintainers, Alireza Abedini and Yasin Dehfouli, who are code owners of every path (`.github/CODEOWNERS`), so each one's pull request is reviewed by the other. Work happens on one branch per issue, named `<lane>/<issue>-<topic>` (e.g. `docs/25-readme`), rebased on `origin/main` and merged into `main` only through a reviewed pull request. Agents that edit files in parallel each work in their own git worktree: a separate checkout folder on its own branch, with its own `node_modules`, `.env.local`, app and Postgres ports and database (`.data/pg`). **Never two writers in one folder**: an agent edits only its own worktree, and read-only agents (reviews, research, eval reading) may share one. Commit only green work, never `.env*`, `.data`, `node_modules`, `.next` or test output (`.gitignore` covers them). **Never push or open a pull request without a human asking. Never push to `main`, and never force-push anything but your own branch (`--force-with-lease`).**
- **Lanes.** Each issue carries a `lane:*` label: `ai` (`lib/ai`, prompts, model settings), `guard` (spend ledger, budgets, AI caps), `eval` (datasets, runner, studies, eval page), `platform` (env, hosting, scripts, deploy), `demo` (sign-in, proxy, demo mode), `qa` (components, pages, e2e, accessibility), `ci` (workflows, CODEOWNERS, templates), `docs` (README, `docs/`, CLAUDE.md, SECURITY.md) or `mobile` (the Expo app). A branch stays inside its issue's lane, and the issue's assignee owns it. `lib/ai/**`, the AI guardrails and `.github/**` are Alireza's: when other work needs a change there, put it on its own branch for his review instead of mixing it in.
- **Never leave processes running.** Stop any `npm run local` or `local:db` you started before running e2e and before you report done (Postgres must not be left holding its port: 54329 in the main folder, the worktree's own port elsewhere). Stop only what listens on your own ports, never processes by name: other worktrees' servers may be running.
- Rollback is a human-made checkpoint zip (docs/handoff.md). Before a large or risky change, stop and ask a human to make one.
- Never upload or print `.env*` files or secrets. `.vercelignore` keeps them out of deploys; don't edit it to include them.
- Never read anything outside this folder, especially `HOLDOUT_PATH`, except through `npm run eval -- --set holdout` when a human asks for it.
- Never create third-party accounts, change dashboard settings or handle production keys. Ask a human. Before Going live, nothing needs an account: if something seems to, you're off-spec, so stop and say so.
- When the spec is ambiguous, follow `docs/domain.md`. If it's silent, choose the simpler, more accessible, more private option, and note the decision in `docs/decisions.md` (date, decision, why).
