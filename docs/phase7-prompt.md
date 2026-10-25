# Phase 7 for ultracode: from local prototype to a shippable AccessLoop

## How to use this file (humans, before pasting)

1. **Make a checkpoint zip first** (CLAUDE.md "Working rules"):
   `tar.exe -a -c -f "..\checkpoints\accessloop-pre-phase7.zip" --exclude=node_modules --exclude=.next --exclude=.env.local --exclude=.data .`
2. **Edit the "Human decisions" block below.** Untick anything the team does not approve. ultracode treats the ticked items as a human saying so in this task, which CLAUDE.md requires before it touches frozen files, adds dependencies or changes the spec.
3. Paste everything from "ultracode:" down into the ultracode session in the `accessloop` folder.
4. ultracode runs **Wave 1** (no accounts needed) and stops. When the humans have created the accounts in Wave 2's list, paste the short **Wave 2** prompt at the end. Then **Wave 3** (Expo app) and **Wave 4** (ship).

---

```text
ultracode: Phase 7 of AccessLoop — "from local prototype to shippable product".

First read CLAUDE.md, docs/domain.md, docs/handoff.md and docs/decisions.md in full. Then read this whole prompt
before starting. It comes from an independent six-part review of the repo as of Oct 19 (reporter UX, staff workflow,
security and privacy, AI and eval, deployment, market and data). Every finding below was checked against the code;
file:line references are to that snapshot, so re-locate them before editing.

What the review confirmed is strong — keep it and don't regress it: forced fail-closed RLS, the append-only hash-chained
case log, metrics replayed from events with case IDs behind every number, the compiled-not-generated report, only the
reporter can produce "verified", every server action re-checks role/org/case and answers 404, fail-closed AI intake,
the design system, the axe/keyboard/reflow/forced-colors suites. Baseline measured on a clean machine: typecheck and
lint clean, 666/666 vitest, 24/24 db:smoke, production build OK.

======================================================================
HUMAN DECISIONS (the team edited this block before pasting; ticked = approved for this task)
======================================================================
Frozen-file and spec changes:
[x] D1  lib/state-machine.ts + domain §3: `close` with reason `spam` or `out_of_scope` only from `new`/`triaged`
        (not after triage-and-fix). From `assigned`/`fixed_unverified`, only `duplicate` and `no_action_possible`.
[x] D2  lib/state-machine.ts + domain §3: new lead action `retriage` (triaged|assigned → same status) that replaces
        priorityArea and/or publicSummary, with a required reason; layer-1 redacted like other free text.
[x] D3  lib/state-machine.ts + domain §3: new lead action `stop_waiting` (retest_open → fixed_unverified) allowed only
        14+ days after the latest `retest_requested`, reason "reporter unreachable". Counts as not verified.
[x] D4  lib/state-machine.ts + domain §3: lead `reopen` also from `verified` and `closed` (→ assigned for verified,
        → triaged for closed), required reason; a reopened verified case leaves the verified numerator from that time.
[ ] D5  lib/state-machine.ts + domain §3: staff-relayed verdict (lead records a verdict the reporter gave by phone),
        stored with via:"staff_relayed", never counted in the headline verified-by-reporter numerator.
[x] D6  domain §10 + lib/metrics: verified-fix-rate denominator = cases with at least one `log_fix` event in the
        period (whatever their current status); a close or stop_waiting after a fix counts as "not verified".
        Add report fact "N submissions closed as not accessibility feedback" with citations. Update domain §10's
        expected-values table and every seed test in the same commit.
[x] D7  db/sql/0100_security.sql: (a) trigger blocking UPDATE on signed-off `reports` rows except setting
        `published_at` from null once; (b) ENABLE+FORCE RLS on `orgs` and `rate_limits` with policies that keep
        today's app behaviour; (c) REVOKE ALL on public tables/functions from `anon` and `authenticated` IF those
        roles exist (Supabase), as a no-op elsewhere. Keep the file idempotent and db:smoke green (add checks).
[x] D8  db/schema.ts + new migration: `cases.due_at timestamptz null` (lead sets it on assign) and an
        `org_locations` table (id, org_id, name, kind, detail, active) under the same RLS pattern.
[ ] D9  lib/crypto.ts: key ID in the `v1:` prefix + AAD = caseId|orgId. (Recommended NOT now: roadmap.)
[x] D10 CLAUDE.md "Clerk" rules: a signed-in Clerk `org:lead` whose Clerk org has no `orgs` row may see an explicit
        "Set up AccessLoop for {org}" form that creates the row (this is not auto-creation). Wave 2 only.
New dependencies:
[x] N1  `qrcode` (server-side SVG for location posters)
[x] N2  `@clerk/nextjs` (Wave 2 only)
[ ] N3  `@sentry/nextjs` (Wave 2; only if a human creates the Sentry project)
[x] N4  An Expo app in a separate `mobile/` folder with its own package.json (Wave 3): expo, expo-router,
        expo-secure-store, react-native and what `create-expo-app` brings. Not part of the Next build.
Scope cuts (stated on Devpost as roadmap, do not build): photo upload, SMS/phone re-test, embeddable widget,
full French UI, SurrealDB memory, Jira/ServiceNow hand-off.
======================================================================

GLOBAL RULES FOR THIS PHASE
- Everything in CLAUDE.md still holds: frozen files (except the ticked items above), never push, never create
  accounts, never two writers in one folder, local mode must keep working, e2e with fakes against local:serve.
- Each track below runs in its OWN git worktree and branch. One integration agent merges green branches into main
  one at a time in this order: T3, T1, T5, T2, T6, T4. Re-run the full Definition of Done after each merge.
- File ownership to avoid conflicts: T2 owns app/(staff)/app/inbox, cases/[ref], lib/cases, lib/metrics; T4 owns
  app/o, app/r, app/check, app/help, components/layout; T6 owns db/seed.ts and eval/fixtures (new files only);
  T3 owns next.config.ts, proxy.ts, instrumentation.ts, lib/env.ts, lib/rate-limit.ts, lib/email/send.ts,
  lib/app-url.ts, .github/, scripts/ (new files only). If a track needs a file another track owns, it writes the
  change as a small follow-up commit after that track merges, never in parallel.
- Every spec change goes into docs/domain.md AND a dated entry in docs/decisions.md in the same commit.
- `e2e/demo.spec.ts` accessible names are the UI contract. Change one only where a task below says so, list every
  change in decisions.md, and keep all 5 demo steps green.
- Never write "compliant", "certified" or "guarantees" in UI copy.

======================================================================
WAVE 1 — no accounts needed (six parallel tracks)
======================================================================

T1 · AI layer: make real AI work, honest and safe
1. BLOCKER — fix the api request shape. lib/ai/backends/api.ts:69,73 default to a forced tool_choice and
   temperature 0. Anthropic's Sonnet 5.5 migration guide says forced tool_choice ("tool"/"any") and any non-default
   temperature return HTTP 400; Haiku 5.5 rejects temperature != 1. With today's defaults every real call falls
   back. Verify against the current docs (platform.claude.com) before choosing, then:
   - default AI_API_TOOL_CHOICE=auto and send no temperature; default AI_API_EFFORT=low for `structure`;
   - OR use structured outputs (output_config.format / strict tools) if the docs confirm support for these
     models; if so, strip minLength/maxLength/minimum/maximum/maxItems from the JSON schema sent to the model
     (structured outputs reject them) and keep zod as the real validator;
   - a plain-text answer with no tool call stays an AiOutputError (already handled);
   - one retry with jittered backoff on 429/529, inside the existing time budget;
   - record latency and token usage per call in eval results (never report text).
   Update .env.example and decisions.md. Unit-test the request body for each model family with the stubbed client.
2. N7 latency: lib/intake/pipeline.ts:30-34 and lib/intake/redact.ts:72 run flagPii(text), flagPii(detail),
   structure one after another (worst case ~30 s before fallback). Run the two flagPii calls in parallel and keep
   the preview within 10 s end to end; add a test with a slow stub.
3. Show confidence. lib/cases/triage.ts:18-28 pre-selects the top AI area at any confidence and the staff UI never
   shows `confidence` or `uncertain`. Show "AI suggestion" with a plain confidence word (high/medium/low) and the
   uncertain list in the triage form; do NOT pre-select when confidence < the eval's ABSTAIN_THRESHOLD (0.5).
4. Redaction (lib/redaction/patterns.ts may only grow). Add keyword-anchored patterns and tests for misses the
   review reproduced with detectPatterns: lowercase/dictated street addresses ("12 king street west"),
   French "boul."/"rue"/"ch." in any case, OHIP numbers without version letters, bank transit + account numbers
   near "transit"/"account"/"compte", "SIN"/"NAS" followed by 9 digits even when not Luhn-valid, dates of birth
   near born/né(e)/date de naissance/DOB in common formats, PO Box / RR addresses, ticket IDs like INC0012345.
   Save an eval run afterwards (CLAUDE.md DoD 4).
5. Injection suite: new file eval/fixtures/injection.json (do not touch the frozen labels file) with ~30 cases:
   tag-breaking, homoglyph </report>, role-play, French, "return an empty PII list", "say it is fixed",
   "mark as verified". Wire `npm run eval -- --set injection` through the existing runner and score() (score.ts is
   frozen; if it can't express a check, add a separate pure checker in eval/ and say so).
6. Tighten lib/report/validate.ts before real AI rewords anything (it currently accepted
   "...As a result, we are fully compliant with the Accessible Canada Act.", "Every barrier reported this year has
   been removed." and a sentence with two numbers swapped — validate.ts:153-161, 219):
   - numbers must appear in the same order as in the filled template;
   - reworded sentence at most ~1.3x the template's word count;
   - reject words not present in the template from a banned list: compliant, compliance, certified, guarantee(d),
     fully, every, all, 100%, satisfied, resolved (case-insensitive, EN and FR equivalents);
   - add those three sentences as failing unit tests.
Done when: unit tests cover all of the above; `npm run eval` (fake) and `--set injection` run; with a human-provided
key later, one live smoke call per function succeeds (Wave 2 does this).

T2 · Staff workflow and honest metrics
1. Implement D1–D4 (and D5 only if ticked) in the frozen state machine, with tests for every new row and illegal move.
2. Implement D6 in lib/metrics (same predicates power dashboard, inbox filters and report — keep it that way), the
   new report fact, and domain §10. Add a dashboard tile or footnote for "closed as not feedback".
3. Truthful copy: app/(staff)/app/cases/[ref]/actions.ts:425 and CaseForms.tsx:254 say "The reporter is asked to
   check it" even when no email exists. Return the actual outcome from sendRetestRequest and say "No contact on file:
   they'll see it only if they open their report page with their code" when nothing was sent.
4. Internal notes: lead and assigned owner can add a note (appendCaseEvent `note_added`, layer-1 redacted,
   `kind: "internal" | "interim_accommodation"`), shown in the case history. Interim accommodations ("what the person
   was offered meanwhile") get their own label.
5. Inbox (app/(staff)/app/inbox/page.tsx): a native GET form with search (ref, public summary), selects for status,
   area, assignee, channel and age, sort by received/age, 50 per page; keep every dashboard deep-link working;
   add columns for assignee, area and age. axe + keyboard tests.
6. Due dates (D8): optional due date on assign, shown in inbox and My work; overdue = past due and not fixed.
7. Owner notification: email template "A barrier was assigned to you" on assign (Outbox in FAKE_EMAIL mode), no
   report text, link to the case.
8. Duplicates: closing as `duplicate` requires choosing the original ref (validated in the same org); record it,
   show a link both ways.
9. Acknowledgement honesty: show "recorded on {date}" next to the claimed acknowledgement date, and add a metric
   "acknowledgements recorded more than 7 days after the date given" (lib/metrics/replay.ts:107-110 uses the typed
   date today).
10. Recurrence panel (stretch, after 1–9 are merged): "Similar past barriers" on the case page: candidates =
   same org, same area, same location kind, last 24 months (max 40, redacted public summaries only); an AI call
   (Haiku via MODEL_PII or a new MODEL_SIMILAR env) returns refs that MUST be in the candidate list or the answer is
   dropped; fake backend fixture; never auto-merge. If T1's request-shape work isn't merged yet, build on fakes.

T3 · Platform hardening (local-testable)
1. lib/env.ts (zod) validated from instrumentation.ts `register()`: DATABASE_URL; SESSION_SECRET, ENCRYPTION_KEY
   (decodes to 32 bytes), RECEIPT_PEPPER, IP_SALT; RESEND_API_KEY + EMAIL_FROM when FAKE_EMAIL!=1;
   ANTHROPIC_API_KEY when effective backend is api; Clerk keys when AUTH_MODE=clerk; refuse AUTH_MODE=local when
   VERCEL is set; refuse SEED_ALLOW_RESET=1 when VERCEL_ENV=production. Clear startup error, no secret values printed.
2. At boot (nodejs runtime), query `select rolsuper, rolbypassrls from pg_roles where rolname = current_user` on the
   app connection and refuse to start if either is true. Document `?sslmode=require` in .env.example for remote DBs.
3. GET /api/health: `select 1` through the app role; returns { ok, db, aiBackend, emailMode, authMode, commit } and
   no secrets; `cache-control: no-store`.
4. Local-auth hardening without editing the frozen lib/auth/local-session.ts: in proxy.ts and the /sign-in page,
   refuse local auth when a `forwarded` or `x-forwarded-host` header names a non-local host, or when
   `x-forwarded-for`/`x-real-ip` contains any non-loopback address. First check empirically whether `next start`
   itself injects x-forwarded-* on local requests, so local:serve and e2e keep working. Add an e2e test that sends
   `Host: localhost` with `X-Forwarded-Host: evil.example` and expects 404.
5. /verify must never throw when no auth adapter is available: app/verify/[reportId]/page.tsx:38 calls
   getStaffOrg() unguarded, and AUTH_MODE=clerk currently throws in lib/auth/staff.ts:71-75. Treat "no adapter" as
   signed out.
6. Security headers in next.config.ts `headers()`: X-Content-Type-Options nosniff; X-Frame-Options DENY and
   CSP frame-ancestors 'none'; Referrer-Policy no-referrer on public routes and strict-origin-when-cross-origin on
   staff; Permissions-Policy camera=(), microphone=(), geolocation=(); a Content-Security-Policy-Report-Only
   baseline (enforce only if every page works under it). axe and e2e stay green.
7. Abuse and spend: lib/rate-limit.ts — bucket IPv6 by /64; lower the preview limit from 120 to 20 per 10 min;
   add a global hourly AI-call budget (`AI_GLOBAL_HOURLY_LIMIT`, default 300) after which intake uses the manual
   path with a plain message; a per-org daily submission cap (default 200) surfaced on the dashboard; platform-aware
   client IP (Vercel: x-real-ip; never trust the first x-forwarded-for hop elsewhere).
8. Email: lib/email/send.ts calls Resend inside the caller's withOrg transaction with no timeout (send.ts:96-99).
   Record the outbound_messages row in the transaction, send after commit with AbortSignal.timeout(5000), then
   update its status in a second short transaction.
9. URLs: NEXT_PUBLIC_APP_URL is inlined at build time (the localhost value was found in the server bundle).
   Add a server-only APP_URL with fallback VERCEL_PROJECT_PRODUCTION_URL → VERCEL_URL → localhost in lib/app-url.ts.
10. Receipt-code privacy: (a) clear the receipt cookie after the receipt page is first viewed and shorten its life to
    2 minutes (lib/intake/receipt-cookie.ts:5); (b) keep drafts in sessionStorage by default, with an explicit
    "Keep this draft on this device" option for localStorage (lib/intake/draft.ts:34).
11. One-time re-test links (closes W2/N3): re-test emails link to `/r/t/{token}` where token = HMAC (new secret
    RETEST_LINK_SECRET, validated in env) over caseId + round + expiry (30 days or round end). It opens that round
    only; the verdict stays single-use per round as today. `/r/{code}` and `/check` keep working (demo.spec).
12. Daily job: app/api/cron/daily/route.ts guarded by `Authorization: Bearer ${CRON_SECRET}`: (a) expire_retest for
    rounds older than 60 days through transition() with the system actor; (b) the single reminder email per round
    (domain §3 ethics rules); (c) owner overdue/stalled alerts to the Outbox. Domain §10 says no job expires re-tests
    before demo day: gate (a) behind CRON_EXPIRE_RETEST=1 and record the decision. Add vercel.json `crons`.
13. Retention: scripts/retention.ts (owner URL, never from the app role): after `retentionUntil`, wipe case_private
    and append a `retention_purged` event; null the reporter email 30 days after a case reaches verified/closed.
    Dry-run by default; `--apply` to write. Explain on /trust.
14. scripts/migrate.ts: drizzle migrate + db/sql/0100_security.sql against MIGRATION_DATABASE_URL (lifted from
    scripts/local.ts without editing it), plus a check that the app role exists with NOBYPASSRLS. npm script
    `db:deploy`.
15. CI: .github/workflows/ci.yml on push and PR — Node 22, npm ci, typecheck, lint, test, db:smoke, next build with a
    placeholder DATABASE_URL. A second job runs `npm run e2e` with Playwright Chromium + WebKit (non-root runner).
    .nvmrc = 22 and an `engines` field.
16. Local setup on minimal Linux: catch the embedded-postgres "invalid locale name" failure and print how to fix it
    (en_US.UTF-8) and that it can't run as root — in a new wrapper, since scripts/local.ts is frozen.

T4 · Reporter experience
1. Contact alternatives: an "Other ways to reach {org}" disclosure (phone, email, mail from org settings, plus
   /p/{org}) on the report form, receipt, /r and /check; /help and app/error.tsx show them when the org is known.
   Footer link to /p/{orgSlug} on every org-scoped page (W5 is currently orphaned).
2. Step 3 overload (ReportFlow.tsx:453-551): replace with ONE question "How can we follow up?" and three answers:
   "Don't contact me", "Let me check the fix with my code", "Email me, and let me check the fix". Move the AI opt-out
   to the review step. Update demo.spec/reporter/keyboard specs and list the name changes in decisions.md.
3. Screen-reader details axe can't catch: put "Step N of 4" inside the focused h2 (visually hidden prefix); make the
   summary choice a RadioGroup in a fieldset instead of aria-pressed buttons (ReportFlow.tsx:600-610,742); after
   "Change it", move focus to the revealed field and announce it once; set lang="fr" on reporter text the AI or a
   simple detector identifies as French.
4. Receipt safeguards: "Print receipt" (print CSS), "Add a reminder to my calendar" (.ics with the /check link and
   NO code), the code shown in two groups of eight with a spelled-out reading, copy strips hyphens.
5. QR posters (needs N1 + D8): lead page /app/settings/locations to manage org_locations and print a poster per
   location (print CSS): large heading, plain instructions, server-rendered QR SVG to
   /o/{slug}/report?loc={locationId}, the URL printed under it. The form pre-fills the place and the reporter can
   change it. axe on the poster page; e2e that a QR link pre-fills.
6. Reporter JSON API for the Expo app (versioned, nodejs runtime, no cookies): POST /api/v1/orgs/{slug}/preview,
   POST /api/v1/orgs/{slug}/reports, GET /api/v1/status (code in an Authorization header, never the URL),
   POST /api/v1/retest. Reuse buildPreview/prepareCase/loadReporterCase and the same redaction, preview token and
   rate limits; zod inputs; return the receipt code exactly once. Unit + e2e tests (request-level).
7. Playwright: add a WebKit project for the reporter specs and a WCAG 1.4.12 text-spacing check.

T5 · Evidence a regulator can check without trusting us
The org (or we, as host) control the owner role, so /verify can't detect a rewritten chain today, and the lead's
area/consultations text is outside the manifest (lib/report/evidence.ts:167-178).
1. At sign-off compute an org root: sha256 over the sorted head hashes of ALL the org's case chains at that moment
   + manifestHash + sha256(area_text, consultations_text). Sign it with Ed25519 (node:crypto, no new dependency)
   using REPORT_SIGNING_KEY (PKCS8, base64; add generation to a new setup helper since scripts/local.ts is frozen;
   validated in lib/env.ts). Store the signature, key ID and root with the report (use an existing JSON column if one
   fits; otherwise ask for a schema change and stop).
2. Publish the public key at /.well-known/accessloop-signing-keys.json (key ID, algorithm, created).
3. "Download evidence bundle" on the published report: JSON with the snapshot, each cited case's chain as public-safe
   fields only (hashes, event types, timestamps, statuses, public summaries — never private or reporter text), the
   root and signature.
4. tools/verify-bundle.mjs: a dependency-free Node script a third party runs offline to verify the signature, the
   root, each chain and the report numbers. Document it on /verify and /trust.
5. /verify shows a fifth check, "Signed by AccessLoop at sign-off", and the report footer shows the fingerprint the
   lead should include in the ACR s.16 notice to the regulator.
6. D7(a) trigger, plus tests: tampering with a signed report row, a case chain, or the lead text turns the right
   check red; the offline verifier fails on the same bundle.

T6 · Real-world data, benchmark and compliance helpers
Sources (public; paraphrase only, cite, never name a real organization as a tenant, never copy passages):
  Scotiabank 2025 https://www.scotiabank.com/content/dam/scotiabank/canada/en/documents/Scotiabank-Accessible-Canada-Act-Progress-Report-2025.pdf
  Rogers 2024 https://www.rogers.com/accessibility/2024-accessibility-progress-report
  Veterans Affairs https://veterans.gc.ca/en/about-vac/our-values/accessibility-veterans-affairs-canada/accessibility-action-plan-2025-2028/50-feedback
  Health Canada 2024 https://www.canada.ca/content/dam/hc-sc/documents/corporate/accessibility/progress-reports/2024/2024-en.pdf
  PC Financial 2025 https://www.pcfinancial.ca/api/v2/en-CA/assets/bank_accessibility_progress_report_2025.pdf
  National Bank 2025 https://www.nbc.ca/content/dam/bnc/a-propos-de-nous/esg/pdf/accessibility-progress-report-lc.pdf
  BCE 2025 https://pfo-www.bce.ca/accessibility/2025-bce-progress-report.pdf
  Air Canada https://www.aircanada.com/ca/en/aco/home/plan/accessibility/progress-report.html
  Air Transat Y2 https://www.airtransat.com/en-CA/travel-information/special-services/accessibility-plan/progress-report-year-2
  VersaBank 2025 https://www.versabank.com/wp-content/uploads/2025/05/VersaBank-Accessibility-Progress-Report_2025-Accessible-Version.pdf
  WAGE 2024 https://www.canada.ca/en/women-gender-equality/accessibility/progress-report/2024-report.html
  ESDC guidance on what a Feedback section should contain:
  https://www.canada.ca/en/employment-social-development/programs/accessible-canada-regulations-guidance/progress-reports/preparing.html
If you can't fetch a source, work from the theme notes humans give you; never invent figures.
1. Scenario seed cases: 10–15 cases paraphrased from themes in those reports (IVR button timing, small card print,
   text-based identity verification for Deaf clients, motion-activated doors, airport assistance wait times,
   inaccessible PDFs, Teams/meeting accessibility, branch seating). Each carries a "Scenario derived from public
   report: {org}, {year}, {url}; wording ours; not a real submission" note shown on the staff case page, plus a
   public /sources page listing them. Prefer adding them to Maple Harbour (richer dashboard) ONLY if you update domain
   §10's expected-values table and every seed test in the same commit; otherwise seed a third made-up org.
2. Silver-label eval set: eval/fixtures/public-silver.draft.json with 60–100 one-line paraphrased barrier
   statements, each labelled with the ACA area the source organization itself assigned (Health Canada and VAC tables,
   Scotiabank's categories). Mark it DRAFT: humans review and rename it to public-silver.json before it is run or
   quoted. Add `--set silver` to the runner.
3. Feedback-section benchmark: data/benchmark/feedback-sections.csv scoring each source on the ESDC elements (total
   count; breakdown by ACA area; by channel; areas with no feedback; how feedback was considered; process changes;
   whether reporters confirmed fixes). Seed rows from the review's reading (6 of 11 give no total, 3 break down by
   area, 0 report reporter confirmation) with a `verified_by_human` column = false; humans verify each row. Then a
   "How your Feedback section compares" card on the report draft page: "Your draft covers N of 7 elements; published
   median is M" — computed only from rows with verified_by_human = true; hidden otherwise.
4. Feedback-process description helper: on /app/settings, a checklist for ACR s.9 (designated position title,
   anonymous option, mail/phone/email + other public channels, acknowledgement in the same manner) that flags what
   is missing and previews the generated /p/{org} description. (Check what /p already does first; extend, don't
   duplicate.)
5. CAN-ASC-5.2.1 clause 17 panel on the dashboard: receive / acknowledge / address / respond mapped to case-event
   counts for the period. Quote at most one short line of the standard, cite the URL, never say "compliant".

WAVE 1 STOP: when all six tracks are merged and the full Definition of Done passes on main, stop. Report per track:
what changed, test counts, axe status, anything not verified, every frozen-file and spec change made, and the exact
list of human actions needed for Wave 2. Do not start Wave 2.

======================================================================
WAVE 2 — going live (humans first create the accounts below)
======================================================================
Humans (not ultracode): Anthropic API key with a spend limit set in the console; two Supabase projects in
ca-central-1 (demo/prod and preview) with the `accessloop_app` role (NOSUPERUSER NOBYPASSRLS) and the Data API
turned off; Vercel project linked; Clerk app with Organizations on, roles org:lead / org:owner / org:auditor, the
demo orgs and users (+clerk_test emails), sign-in path /sign-in; optionally a Resend domain and a Sentry project.
Humans paste secrets into .env.local and Vercel themselves.

When those exist, the humans paste:

  ultracode: Phase 7 Wave 2 (going live). Accounts now exist; secrets are in .env.local and Vercel.
  1. Clerk adapter behind AUTH_MODE=clerk exactly as CLAUDE.md's Clerk bullets describe: clerkMiddleware in
     proxy.ts (keep the local branch), restructure /sign-in into /sign-in/[[...sign-in]] that renders <SignIn/> in
     clerk mode and the local buttons in local mode, /app/select-org, role mapping (only the three roles; others
     404), role taken from session claims on every request, org_members upsert that never overwrites display_name,
     MFA required for leads (Clerk setting — tell humans), the D10 "Set up AccessLoop" form, invitations through
     Clerk's <OrganizationProfile/>. Seed takes Clerk IDs. e2e via @clerk/testing.
  2. Run `npm run db:deploy` and the seed against Supabase. Write scripts/remote-smoke.ts that runs the db:smoke
     RLS/guard/definer assertions read-only against DATABASE_URL as the app role. If resolve_receipt or
     resolve_published_report return nothing (owner role without BYPASSRLS), fix with explicit policies in the
     security SQL and say so.
  3. Deploy with `npx vercel deploy`: Production AUTH_MODE=clerk, AI_BACKEND=api, FAKE_LLM=0; Preview
     FAKE_LLM=1, FAKE_EMAIL=1, preview Supabase. Run the full e2e against the preview URL with the bypass secret.
  4. Live AI smoke: one call per function on the production backend; record latency and tokens. Then run the eval on
     the visible set, `--set injection` and (if humans approved it) `--set silver`, 3 repeats each, plus the layer-1-
     only comparison; save results; make the latest REAL run the default view on /app/eval with confidence intervals,
     cost per report and p50/p95 latency; label any fake run "simulated" and move it below. Humans run
     `--set holdout` themselves.
  5. Judge demo: the seeded demo tenant, demo logins for lead/owner/auditor documented for Devpost, a nightly GitHub
     Actions job running `db:seed -- --reset` against the demo database only, and a load check (50 concurrent on /,
     the report form and the inbox) whose p95 goes into the README.
  Stop and report what is live, the URLs, the real eval table, and anything not verified.

======================================================================
WAVE 3 — Expo reporter app (N4; start once the Wave 2 production URL works)
======================================================================

  ultracode: Phase 7 Wave 3. Build the Expo reporter app in mobile/ (its own package.json; excluded from the root
  tsconfig, eslint, vitest and .vercelignore'd). It talks only to /api/v1 on EXPO_PUBLIC_API_URL.
  - Screens mirror the web flow: choose organization (by slug, or a deep link from a location QR code
    accessloop://report?org=…&loc=…), the four steps with one question each, review with "Your words" and the AI
    summary (confirm / change / keep my words / don't use AI), receipt.
  - Native TextInput so iOS and Android dictation work with no extra code. No camera, no photos, no location
    services (scope cuts).
  - Receipt codes stored only in expo-secure-store as "My reports"; status screen; in-app re-test with the five
    answers; codes never in URLs or logs.
  - Accessibility: every control has accessibilityRole/Label/Hint, focus moves to each step's heading, Dynamic Type
    up to the largest size without truncation, 44x44 targets, reduced motion respected, tested with VoiceOver and
    TalkBack (humans) — write a short test script in mobile/A11Y-TESTING.md.
  - Runs in Expo Go (no native modules beyond expo-secure-store) so judges can try it from a QR code.
  - README section and a 20-second clip plan for the video.
  Stop and report what was verified on a real device vs a simulator.

======================================================================
WAVE 4 — ship (Oct 24–25)
======================================================================

  ultracode: Phase 7 Wave 4 (ship). Feature freeze holds: fixes and documents only.
  1. /trust: replace "we never store your IP address" with what is true once hosted (our app stores only a daily-
     salted hash; the host keeps request logs for N days); a sub-processor table (Vercel, Supabase ca-central-1,
     Clerk, Anthropic, Resend: what each receives, where it is processed); and one sentence at the point of
     collection on the report form that text is processed by Anthropic in the United States, with the AI opt-out next
     to it. Offer an org-level "AI off" setting for organizations that need Canadian-only processing.
  2. SECURITY.md (one page): tenancy and RLS evidence, encryption, key handling, SSO/MFA via Clerk, backups and
     restore targets, incident response under PIPEDA, sub-processors, data export and deletion, SOC 2 roadmap, AI
     governance (suggest-only, confidence shown, prompt hashes logged, eval).
  3. docs/acr.md: a self-assessed Accessibility Conformance Report draft (EN 301 549 / WCAG 2.2 AA) from our axe,
     keyboard, reflow, forced-colors, WebKit and tester evidence, clearly labelled self-assessed.
  4. README and docs/devpost.md: the real eval table (holdout headline if humans ran it), live URL, demo logins,
     one-command local run, architecture diagram updated (API, Expo app, cron, signing), honest limits and roadmap
     (the scope cuts), prior-work and AI-tool disclosures as docs/handoff.md Phase 6 lists them.
  5. Final full run: typecheck, lint, test, db:smoke, e2e locally and against the preview, remote-smoke against
     production, screenshots refreshed. Report anything not verified. Do not push; humans push when ready.
```

---

## Notes for the team (not part of the prompt)

- **Why this order:** Wave 1 needs no accounts, so ultracode can start tonight while humans create accounts for Wave 2 in parallel. Wave 2's Clerk adapter is the single biggest risk (8–12 h); if it isn't working by the end of Oct 22, deploy the public side only, label it honestly and demo the staff side from the laptop.
- **What only humans can do:** tick the decisions block, create accounts and paste secrets, set the Anthropic spend limit, turn off Supabase's Data API, review the silver-label eval set and the benchmark rows, write and run the holdout, run the tester sessions (log them in `docs/a11y-issues.md`), record the video, push to GitHub, submit on Devpost.
- **How the four of you map to it:** Platform person supervises T3 then Wave 2; AI person supervises T1 and T6 review; Web person supervises T2 and T4; Mobile person writes the A11Y test script and owns Wave 3. Everyone reviews the decisions block together first.
