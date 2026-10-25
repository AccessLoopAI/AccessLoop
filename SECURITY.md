# AccessLoop security

**Status (October 21, 2026): a local prototype. Nothing is hosted.** AccessLoop runs on one computer with an embedded
Postgres, local staff sign-in (`AUTH_MODE=local`), simulated AI (`FAKE_LLM=1`) and logged email (`FAKE_EMAIL=1`).
Each section says what is true now and what changes at hosting. There are no backups, no SSO and no audits yet; this
page never claims otherwise. Every claim cites the file that does it, and was checked against `main` after every
Phase 7 track was merged; a claim that depends on the hosting step (Wave 2) says "at hosting".

**Report a security problem:** contact the team privately, never in a public issue. <!-- TODO (team): a security contact address before the repository is public. -->
Do not test against any other organization's data, and do not run load against a hosted copy without asking.

## Tenancy and row-level security

- Every tenant table has `org_id`, and row-level security is **enabled and forced** on it; policies compare `org_id`
  with the transaction's `app.org_id`, so a query without an org context returns nothing (fails closed).
  `case_private` (the encrypted original) also requires `app.role = 'lead'`. `orgs` and `rate_limits` have forced
  RLS too, open only to the app role and the owner; Supabase's `anon` and `authenticated` roles, where they exist,
  get every privilege revoked (decision D7). Source: `db/sql/0100_security.sql` (idempotent, applied after the
  migrations).
- All tenant access goes through `withOrg({ orgId, role }, tx => …)` (`db/tenant.ts`); the org always comes from the
  server (session, slug, `resolve_receipt()` or `resolve_published_report()`, two SECURITY DEFINER lookups that
  return at most one org), never from a request. Owners get 404 for cases not assigned to them; another org's case is
  a 404 (`e2e/security.spec.ts`).
- The app connects as `accessloop_app`: NOSUPERUSER, NOBYPASSRLS, no DELETE anywhere except expired rate-limit rows,
  no UPDATE on the event log. At boot the server refuses to start if its role is a superuser or has BYPASSRLS
  (`lib/boot-checks.ts`, `lib/db-role.ts`, from `instrumentation.ts`). `npm run db:deploy` (`scripts/migrate.ts`)
  checks the app role before migrating and that every public table has forced RLS after.
- **Evidence:** `npm run db:smoke` (57 checks on an in-memory PGlite: migrations and security SQL twice, seed, every
  hash chain (the scenario org's too), the append-only trigger, the sign-off lock, cross-org isolation, the lead-only private table, the two
  lookups, the Supabase-role revokes, the boot role check, retention; `scripts/db-smoke.ts`, also in CI).
  `npm run db:remote-smoke` runs 32 of the same RLS, guard, sign-off-lock and lookup checks **read-only** against `DATABASE_URL` as
  the app role (every transaction rolled back; refuses a superuser or BYPASSRLS role; `scripts/remote-smoke.ts`).
  It has run only against the local embedded Postgres; running it against the hosted database is an at-hosting step.

## Encryption and hashing

| What | How | File |
|---|---|---|
| Reporter's original words, email, contact details | AES-256-GCM, random 96-bit IV, `v1:` prefix; one key, `ENCRYPTION_KEY` | `lib/crypto.ts` (frozen) |
| Receipt codes | 80 random bits; only `HMAC-SHA256(RECEIPT_PEPPER, code)` is stored | `lib/receipt-code.ts` (frozen) |
| Rate-limit keys | `HMAC-SHA256(IP_SALT, address or IPv6 /64 + UTC date)`; no raw IP stored; rows pruned after 2 days | `lib/rate-limit.ts` |
| Staff session (local mode) | HMAC-signed, httpOnly, SameSite=Lax cookie, 12 hours | `lib/auth/local-session.ts` (frozen) |
| One-round re-test links | HMAC (`RETEST_LINK_SECRET`) over org, case, round and expiry (30 days at most); never stored or logged | `lib/retest-link.ts` |
| Case history | Append-only, per-case SHA-256 hash chain; a trigger blocks UPDATE and DELETE even for the owner | `lib/case-events.ts` (frozen), `db/sql/0100_security.sql` |
| Signed-off reports | Ed25519 signature over a root of every case-chain head of the org, the manifest, the lead's text and the content | `lib/report/signing.ts` |
| Receipt codes in the Expo app | Kept only in `expo-secure-store` ("My reports"), never in a URL or a log; sent to `/api/v1` only in an `Authorization` header | `mobile/src/reports-store.ts`, `mobile/src/api.ts` |

The redacted copy staff work from is not encrypted (it holds no contact details by design). In the prototype the key
sits on the same computer as the database, which protects a copied database but not a copied computer; at hosting
the keys live in the host's environment settings, apart from the database. On Vercel the database URL must use
`sslmode=require` or `verify-full` (`lib/env.ts`).

## Keys and secrets

- Secrets live in `.env.local` (generated with random values by `npm run local:setup`; never committed,
  `.gitignore`; never uploaded, `.vercelignore`), and at hosting in the host's environment settings, pasted by a
  human. Nothing prints a secret: `lib/env.ts` checks every setting at boot and names only the variable.
- **Derivation:** in `AUTH_MODE=local` on this computer (VERCEL unset), a missing `RETEST_LINK_SECRET`, `CRON_SECRET`
  or `REPORT_SIGNING_KEY` is derived with HKDF-SHA256 from `SESSION_SECRET` (info = the variable's name), so an
  existing `.env.local` keeps working. Anywhere else each must be set, or the server refuses to start
  (`lib/env.ts` `secretFromEnv`, `deriveLocalSecret`, `canDeriveSecrets`).
- **Signing key:** `node tools/signing-key.mjs --write <env file>` makes an Ed25519 key (prints only the key ID and
  public key). The public key is served at `/.well-known/accessloop-signing-keys.json`; the key ID is derived from
  the public key (`lib/report/signing-key.ts`).
- **Rotation (none is automated):** `IP_SALT` and `CRON_SECRET` can change at any time (counts restart; update the
  cron's header). `SESSION_SECRET` signs everyone out (and in local mode changes the derived secrets).
  `RETEST_LINK_SECRET` stops outstanding links (receipt codes keep working). `RECEIPT_PEPPER` must not change: codes
  are not stored, so every existing code would stop working. `ENCRYPTION_KEY` has no key ID, so rotating it means
  re-encrypting every row with a tool that does not exist yet (decision D9, a key ID and case-bound AAD, was not
  approved for now). `REPORT_SIGNING_KEY`: only the current key is published, so after a rotation reports signed with
  the old key show "unknown key" online until retired keys are listed (roadmap); the offline checker still works
  with a saved key list.

## Staff sign-in

- **Now:** local sign-in only. `/sign-in` lists seeded staff and works only when `AUTH_MODE=local`, the host is
  loopback, no forwarding header points elsewhere and the app is not on Vercel; otherwise it is a 404 and a session
  counts for nothing (`lib/auth/local-request.ts`, `proxy.ts`, `e2e/platform.spec.ts`). `npm run local` listens on
  127.0.0.1. There are no passwords and no MFA: it is not an authentication system for a network. **Never put a
  local-mode copy behind a reverse proxy or tunnel.** The forwarding-header check catches only proxies and tunnels
  that add `X-Forwarded-For`, `X-Real-IP` or `Forwarded` (ngrok, cloudflared and Caddy do); a plain nginx
  `proxy_pass` on the same computer that rewrites `Host` and adds none of them looks exactly like a direct local
  request, and nothing in the app can tell them apart. The same check guards the `claude-cli` AI backend, so the
  team's Claude subscription is never used for a request that came through a tunnel (`lib/ai/context.ts`).
- **Planned (at hosting, Wave 2, not built):** Clerk Organizations behind `AUTH_MODE=clerk`, roles `org:lead`,
  `org:owner`, `org:auditor` only (any other role gets a 404), SSO through Clerk, and MFA required for leads (a Clerk
  setting a human turns on). No Clerk package is installed today; with `AUTH_MODE=clerk` every staff page is signed
  out. Reporters never get accounts and the reporter pages never load sign-in code.

## Web and abuse protections

- Headers on every response (`next.config.ts`): `nosniff`, `X-Frame-Options: DENY` and `frame-ancestors 'none'`,
  `Permissions-Policy` with no camera, microphone or location, `Referrer-Policy` same-origin (public) and
  strict-origin-when-cross-origin (staff), an enforced CSP for `frame-ancestors`, `object-src`, `base-uri` and
  `form-action`, the full CSP baseline report-only (`e2e/csp.spec.ts`), HSTS on Vercel builds.
- Every server action re-checks role, org and case. `/sign-out` refuses cross-site POSTs. Public routes are
  rate-limited per address; a global hourly AI budget (`AI_GLOBAL_HOURLY_LIMIT`, default 300) and a per-org daily
  cap on web reports (`ORG_DAILY_SUBMISSION_LIMIT`, default 200) sit on top (`lib/rate-limit.ts`). No CAPTCHA.
  The address a per-address limit counts is Vercel's `x-real-ip` on Vercel; anywhere else it is the **last**
  `X-Forwarded-For` entry, and `next start` keeps a value the client sent. So a self-hosted copy must sit behind a
  reverse proxy that appends the client's address to `X-Forwarded-For` (nginx `proxy_add_x_forwarded_for`, Caddy, a
  cloud load balancer): without one, a client picks its own bucket on every request and the per-address limits
  (`/check`'s code guessing, the preview) do nothing; the global AI budget and the per-org cap still hold. A setting
  for the number of trusted proxies is roadmap.
- Logs never hold report text, emails, receipt codes or IP addresses; the Anthropic SDK's own logging is off
  (`lib/ai/backends/api.ts`). `GET /api/health` reports modes and database reachability only.
- `GET /api/cron/daily` answers only `Authorization: Bearer ${CRON_SECRET}` (constant-time; 401 before anything is
  read; `e2e/cron.spec.ts`).

## Backups and restore (planned; owned by the hosting step)

**None today.** The local database (`.data/pg`) is on one laptop and the checkpoint zips exclude it and `.env.local`.
At hosting: Supabase in `ca-central-1` with its backups; the recovery point and recovery time targets, the plan that
provides them, and one tested restore drill are decided and recorded by the hosting step. <!-- TODO (team): set the targets at hosting; no number is promised here. -->
`ENCRYPTION_KEY` and `REPORT_SIGNING_KEY` must be backed up apart from the database: without the first, original
words can't be read again; without the second, new reports can't be signed under the published key ID.

## Incident response (PIPEDA)

Under PIPEDA the organization in control of the personal information (generally the AccessLoop customer, for its
reporters' feedback) reports a breach of security safeguards to the Office of the Privacy Commissioner of Canada
and notifies the people affected as soon as feasible when it creates a real risk of significant harm, notifies
others who can reduce the harm, and keeps a record of every breach for at least two years. As the host we would: contain (rotate
the affected secrets, revoke the database role's password, set `AI_GLOBAL_HOURLY_LIMIT=0`, take the site down if
needed), work out what was exposed from the append-only case logs and the host's logs, tell each affected
organization without delay with what it needs for its own assessment, and keep our own record. Federal departments
follow the Privacy Act and Treasury Board policy instead. Today there is no alerting or error tracking (Sentry, N3,
was not approved) and no on-call rota. <!-- TODO (team): named contacts and the customer contract terms at hosting. -->

## Sub-processors (planned when hosted)

Vercel (runs the app; can run in Montréal, defaults to Washington, D.C.), Supabase (database, `ca-central-1`),
Anthropic (AI; data at rest in the US, inference global unless set to US-only; masked text only), Resend (email; US),
Clerk (staff sign-in; US). What each would receive from our code, and where, is the table on `/trust`
(`app/trust/page.tsx`, checked against each provider's public page on October 20, 2026; unconfirmed items say so).
None is used in the prototype. Two choices are open for the hosting step: the Vercel function region (`yul1` keeps
compute in Canada; nothing sets it yet) and Anthropic's `inference_geo` (our code sends none, so Anthropic's
default, "global", would apply; there is no Canadian option). **Canadian-only processing:** there is no org-level
"AI off" setting (it needs a schema change that was not approved in Phase 7; a human decides at hosting). Today each
reporter can choose "Don't use AI on my report", and `AI_GLOBAL_HOURLY_LIMIT=0` turns the AI of the public form and
of the Expo app's `/api/v1` preview off for a whole deployment (staff-logged feedback, report wording and "Similar
past barriers" still use the configured backend).

## Data export and deletion

- **Retention:** each case keeps its feedback 7 years (ACR s.19). The app never deletes. `npm run db:retention`
  (`scripts/retention.ts`, owner only, dry run by default, `-- --apply` writes) wipes the private copy after the
  keep-until date and removes reporter contact details 30 days after a case is verified or closed, each recorded on
  the case's log. Nothing runs it on a schedule yet.
- **Export today:** a published report's plain-text export and its evidence bundle (public-safe fields only). A full
  per-organization export (cases, events, reports) and offboarding deletion at contract end are **not built**
  (roadmap); until then the database owner can dump an organization's rows.
- Personal details a reporter typed that every redaction layer missed stay in the immutable log in redacted form
  (known gap; crypto-shredding is roadmap).

## SOC 2 roadmap (not started)

No audit, attestation or penetration test has been done. Planned order after hosting: written policies (access,
change, incident, vendor), quarterly access reviews, the hosting providers' own reports collected as vendor evidence,
an external penetration test, then a SOC 2 Type I readiness review, then Type II.

## AI governance

- **Suggest-only:** AI output never changes a case's state or writes a report number; people decide
  (`lib/state-machine.ts`, `docs/domain.md` §6–7). Only the reporter's own answer makes a case "verified".
- **Masked text only:** layer-1 patterns run on the server before any model call (`lib/redaction/patterns.ts`);
  reporter text is untrusted data inside `<report>` delimiters; the reporter can opt out of AI entirely.
- **Confidence shown:** the triage form shows "AI suggestion" with high, medium or low confidence and the uncertain
  list, and pre-selects nothing below 0.5 (`lib/cases/triage.ts`).
- **Prompt hashes logged:** `structure`'s prompt sha256 is in every `ai_structured` event, `phraseClaims`' in the
  report's content, and every eval result records the sha256 of the prompts it ran (`structure`, `flagPii`;
  `eval/results/`); `flagPii`'s is not in case events yet (known gap, frozen `lib/cases/create.ts`).
- **Report sentences are validated** against their cited facts (`lib/report/validate.ts`): every number must be a
  value of a cited fact, in the template's order; a reworded sentence may have at most 1.3 times the template's words;
  and an overclaiming word from `BANNED_WORDS` (the compliance, certification and guarantee words, fully, every, all,
  100%, satisfied, resolved, and the French ones) is refused unless the template already has it. A rejected sentence falls back to its template.
- **Eval:** `npm run eval` (fake runs are labelled simulated and never quoted as model results); a prompt-injection
  suite, `--set injection` (33 attacks in English and French with per-case checks, `eval/fixtures/injection.json`,
  `eval/injection.ts`; run so far on the fake backend only); real-model numbers come only from the `api` backend at
  hosting. `claude-cli` is for the team's own machine only and refuses to run off localhost (`docs/domain.md` §6.1);
  on this machine the CLI is found (2.1.299) but not signed in, so no real model has been called.
- **Point of collection:** the report form says where the words go when AI is on, true for the running copy (with
  `api`: Anthropic, an AI company in the United States, after contact details and ID numbers are taken out), on step
  3 before the summary is made and again under "Don't use AI on my report" (`lib/public-info/ai-where.ts`).
- **Similar past barriers:** the model may only pick refs from a candidate list of the same org's redacted public
  summaries, any other answer is dropped, and nothing is merged automatically (`lib/ai/similar.ts`, `docs/domain.md` §6.2).
- **Spend:** the global hourly AI budget above, plus an Anthropic console spend limit a human sets at hosting.

## Known gaps

One encryption key with no key ID; receipt codes appear in `/r/{code}` page addresses, so a host's request logs would
hold them; the Expo app's AI notice does not yet say where the words go (the web form does; `mobile/src/copy.ts`);
no org-level "AI off" setting; settings changes are not audited; most of the CSP is report-only; CI (`.github/workflows/ci.yml`) has not
run on GitHub yet (the last push predates it); no external security review has been done. See also `/trust` "What is not finished yet" and `docs/decisions.md`.
