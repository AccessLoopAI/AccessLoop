# AccessLoop: Ship-Readiness Review

Oct 20, 2026 · @Yasin

## Verdict

**The engineering core is unusually strong; the product is not yet shippable, demoable on a live URL, or credible as "real AI".** Six parallel reviewers (reporter UX, staff workflow, security and privacy, AI and eval, deployment, market and data) read the whole repo (about 42,000 lines). One of them built and ran it.

**What we measured:** typecheck and lint clean, 666/666 unit tests, 24/24 database security checks, production build in about 40 s, pages at 17–155 ms. The Playwright e2e suite could not run here (no browser download), so its 143-test claim is unverified.

**Five problems would lose the top 10 if left alone:**

1. **No one can sign in on a deployed URL.** Auth is local-only; the Clerk adapter was never built. Deployed, the staff side and the public `/verify` page break.
2. **Real AI fails on every call with the shipped defaults.** The API request forces a tool and sets temperature 0, which Sonnet 5.5 rejects with HTTP 400. Every case would silently fall back to "no summary".
3. **Nothing is deployed, and there is no CI, health check, env validation or background job.** Re-test rounds never expire because nothing runs `expire_retest`.
4. **The headline metric and the report can be gamed.** Closing a fixed case as spam or "no action possible" improves the verified-fix rate and erases it from the report. The sentence validator also accepts "we are fully compliant" and swapped numbers.
5. **The loop doesn't close for the people it's meant for.** Phone, mail and in-person reporters can't re-test, staff are told "the reporter is asked" when nobody is, and there is no mobile app, French, photo upload or QR intake.

All five are fixable by October 24 with four people working in parallel (plan in the last section). The architecture — forced row-level security, an append-only hash-chained log, metrics replayed from events, a "compiled, not generated" report — is the best argument we have, and none of it needs to be rewritten.

## How it is built today

One Next.js 16 web app with a disciplined core; the dashed parts are what stands between it and a live, multi-tenant product.

&#91;embedded content: AccessLoop as built on Oct 19 · dashed red = not built\]

The build was spec-driven in phases from `docs/domain.md`, with security-critical files frozen and the demo written as a test first (`e2e/demo.spec.ts`). That discipline is why the core holds up. It also explains the gaps: the spec deliberately postponed accounts, keys and hosting to an optional "Going live" phase that hasn't started.

## Requirements coverage

Against the plan of October 18: the web loop and report are done; the mobile app, French, uploads and every sponsor integration are missing.

| Area | Done | Partial | Missing |
| --- | --- | --- | --- |
| Mobile app (M1–M8) | — | M2, M3, M6 exist as web equivalents | No Expo app at all; no JSON API for one to call |
| Web reporter (W1–W5) | W2 re-test page, W5 public feedback page | W1: text and OS dictation, no upload | W3 QR posters, W4 widget |
| AI (A1–A9) | A3 cited report sentences | A1: confidence stored but never shown; A2: names left to the AI, several PII classes missed | A4 duplicates, A5 CAN-ASC clauses, A6 memory, A7 translation, A8 owner suggestion, A9 ticket sweep |
| Staff (S1–S8) | S3, S5, S6 | S2: no due dates, search or filter controls; S4: email simulated | S1 Clerk, S7 overdue alerts, S8 export |
| Report (P1–P4) | P1, P2, P3 | P4: HTML and print only | PDF button, French |
| Org (O1–O2) | O2 seeded demo | — | O1: only the seed script can create an org or user |
| Non-functional | N4 auditability, N10 tests | N1 (automated only, no tester sessions), N2, N3, N5, N8 | N6 French, N7 unmeasured with real AI, N9 retention never enforced, CI |

**Sponsor prizes today: none qualify.** Clerk, Expo, Eon Era and SurrealDB are all absent from the runtime code (`@clerk/testing` is a dev dependency only).

## Component findings

Each item names the file to change and the effort for one developer; severities follow the reviewers' scale (Blocker, High, Medium).

### Reporter side and accessibility

**Strong:** native controls, focus moved to each step's heading, no timeouts, anonymous by default, a leaked receipt code reveals no report text, POST-only re-test answers, a real design system (Atkinson Hyperlegible, light and dark, forced-colours CSS, 48 px targets).

| Severity | Finding | Fix | Effort |
| --- | --- | --- | --- |
| High | Phone, mail and in-person reporters can't re-test: the verdict needs the 16-character code typed into a web page, and the re-test request goes by email only (`lib/email/case-emails.ts:63`) | Staff-relayed verdict counted separately (frozen state machine, needs team approval); phone keypad re-test as roadmap | 4 h |
| High | Staff see "The reporter is asked to check it" even when no email exists (`cases/[ref]/actions.ts:425`) | Return the email result and say "No contact on file" | 1 h |
| High | `/help`, `/check` and the error page say "contact the organization" but show no phone or email; `/p/{org}` isn't linked from any reporter page | "Other ways to reach {org}" block on the form, `/r`, `/check`, `/help`; footer link | 2 h |
| High | No sessions with disabled testers logged (`docs/a11y-issues.md` is empty); Chromium only, so Safari/VoiceOver untested | Two paid sessions; add a WebKit project and a text-spacing test | 3 h + sessions |
| Medium | Step 3 asks three questions on one screen (follow-up, re-test, AI opt-out) | One question with three answers; move the AI choice to review | 3 h |
| Medium | "Step N of 4" isn't announced; summary choices are toggle buttons instead of radios; French text read with an English voice | Fix the heading, use a fieldset, set `lang` on user text | 3 h |
| Medium | Draft with report text kept 7 days in localStorage; receipt cookie readable by the next person on a kiosk for 15 min | sessionStorage by default; clear the cookie on first view | 2 h |

### Staff workflow, dashboard and report

**Strong:** one source of truth for every number, each linked to its cases; metrics replayed from events; only the reporter can produce "verified"; every server action re-checks role, org and case and answers 404.

| Severity | Finding | Fix | Effort |
| --- | --- | --- | --- |
| High | Closing a fixed case as spam or "no action possible" improves the verified-fix rate and drops it from the report (`lib/state-machine.ts:122`, `lib/metrics/compute.ts:230`) | Count closes after a fix as "not verified"; allow spam only before triage; report "N closed as not feedback" | 3 h |
| High | The validator accepted "…we are fully compliant", "every barrier was removed", and two numbers swapped (`lib/report/validate.ts:153`) | Numbers in template order, length cap, banned words — before real AI is on | 3 h |
| High | Cases get stuck: an unanswered re-test stays open forever, a wrong public summary can't be fixed, verified and closed can't be reopened | Daily cron for `expire_retest`; `retriage` and "stop waiting" actions (frozen, needs approval) | 4–5 h |
| High | `/verify` can't detect tampering by whoever controls the database, and the lead's written sections aren't covered by the hash | Sign a root over all chain heads at sign-off (Ed25519, no new dependency), publish the public key, offer an offline evidence bundle | 6 h |
| High | Week-one gaps: no due dates, no owner notifications, no internal notes, no evidence files, no location model, no inbox search or filters, no duplicate link | Notes, inbox filters and owner email now (7 h); due dates and locations need a schema change | 7 h+ |
| High | A new organization can only be created by the seed script (O1) | "Set up AccessLoop" form for a Clerk lead with no org; invitations via Clerk | 5 h |
| Medium | Acknowledgement time uses a typed date, so a late acknowledgement can look prompt | Show when it was recorded next to the date claimed | 1.5 h |

### AI layer and evaluation

**Strong:** three backends behind one contract with no silent fallback, exact-substring PII contract, sealed preview token, fail-closed intake, prompt hash on every event, honest "simulated" labels.

| Severity | Finding | Fix | Effort |
| --- | --- | --- | --- |
| Blocker | Default request forces a tool and temperature 0 (`lib/ai/backends/api.ts:69,73`); Sonnet 5.5 rejects both with HTTP 400, Haiku 5.5 rejects the temperature | Default to `auto` (or structured outputs with length limits stripped from the schema), no temperature, `effort: low`, one retry on 429/529, then a live smoke test | 3–4 h |
| High | Never run against a real model; 20 fixtures and 3 simulated results; `/app/eval` shows a 16% score a judge will misread | Real eval of about 150 cases, two annotators, holdout, three repeats, cost and latency (about $15–30) | 14 h |
| High | Confidence is stored but never shown, and a 0.3 guess is pre-selected in triage (`lib/cases/triage.ts:18`) | Show "low confidence"; don't pre-select below 0.5 | 2 h |
| High | Layer-1 redaction missed lowercase or dictated addresses, "boul.", OHIP numbers, bank transit numbers, "My SIN is…" and dates of birth (probed live) | Keyword-anchored patterns in EN and FR | 3–4 h |
| High | Latency unmeasured: three sequential calls with a 10 s timeout each, so up to about 30 s before fallback | Run redactions in parallel, `effort: low`, log latency and tokens | 1–2 h |
| Medium | Only 2 injection cases, both aimed at summaries; nobody tests "tell the PII check to return nothing" | 30-case injection suite in the eval | 3 h |

## Security, privacy and trust

The data layer would pass most of a bank's security review today; what fails is everything around it once it leaves localhost.

**Strongest answers we already have:** forced row-level security that fails closed, an app role with no BYPASSRLS and no DELETE, an append-only trigger that holds even for the database owner, 80-bit peppered receipt codes, AES-256-GCM for original text and contact details readable by the lead only, every "Show original" logged, no IDOR found on any server action.

| Severity | Finding | Fix | Effort |
| --- | --- | --- | --- |
| Blocker | No staff auth on a public URL; with `AUTH_MODE=clerk`, every staff page and the public `/verify` throw (`lib/auth/staff.ts:71`, `app/verify/[reportId]/page.tsx:38`) | Build the Clerk adapter; `/verify` treats "no adapter" as signed out | 8–12 h |
| High | Local sign-in trusts the Host header, so a tunnel or proxy that rewrites Host (ngrok, nginx) exposes "Sign in as the lead" and every original report to the internet (`lib/auth/local-session.ts:18`) | Refuse local auth when any forwarding header is present or `NODE_ENV=production` | 1 h |
| High | No AI spend cap: 120 previews per 10 min per IP, each 2–3 model calls; IPv6 gives unlimited buckets. A bot could drain the credits during online judging | IPv6 /64 buckets, a global AI budget, lower limit, Anthropic console spend cap | 2 h |
| High | Database connection: no TLS required, no boot check that the role lacks superuser/BYPASSRLS; `orgs` and `rate_limits` have no RLS and Supabase's Data API would expose them | `sslmode=require`, role check at boot, Data API off | 1.5 h |
| High | `/trust` claims become false once deployed: "we never store your IP" (host logs do), receipt codes in `/r/CODE` URLs land in host logs, no notice that text goes to a US AI provider at the point of collection | Reword, move the code to the URL fragment, one-line notice, sub-processor table | 2.5 h |
| Medium | No security headers (CSP, frame-ancestors, Referrer-Policy, HSTS) | `headers()` in `next.config.ts` | 1 h |
| Medium | Personal data in the immutable log can't be corrected or erased; retention end is computed but never enforced; reporter email kept 7 years | Purge job for private data after retention; drop email 30 days after closure; crypto-shredding as roadmap | 3 h |
| Medium | Settings changes (contact email, phone) aren't audited; signed-off reports are updatable by the app role | Append-only org audit table; trigger blocking edits after sign-off | 3 h |
| Medium | One encryption key, no key ID or rotation; ciphertext not bound to its case | Key ID in the prefix, case/org as associated data (frozen file) | 2 h |

### What a bank or federal buyer will ask

- **Data residency.** Disability-related feedback is likely Protected B for federal departments, which must stay in Canada; Anthropic, Resend and Vercel's default region are US. Offer an org-level "AI off, Canada only" mode (the AI opt-out path already exists, about 1 h) and say so on Devpost.
- **The vendor's own accessibility conformance report** (VPAT, EN 301 549 edition). Federal guidance strongly encourages requiring one. A one-page self-assessed draft from our axe, keyboard and forced-colours evidence takes 4–6 h.
- **French.** Federal institutions must offer services in both official languages, and four of the eleven organizations whose reports we read are Quebec-based.
- **A one-page `SECURITY.md`:** SOC 2 roadmap, SSO via Clerk, MFA for leads, backups and recovery targets, incident response under PIPEDA, sub-processor list, data export at exit. About 2 h, and it turns "prototype" into "credible path to production" for the investor and CTO judges.

## Production and deployment readiness

The code builds and runs fast; what is missing is every piece that lets it live somewhere other than one laptop.

**What we ran** (Node 22, from a clean install):

| Check | Result |
| --- | --- |
| Typecheck, lint | Pass |
| Unit tests | 666 / 666 pass |
| Database security smoke test | 24 / 24 pass |
| Local setup (embedded Postgres) | Fails on minimal Linux until an `en_US.UTF-8` locale is installed; refuses to run as root |
| Production build | Pass in about 40 s; fails with no `DATABASE_URL` set (thrown at import) |
| Page timings | 17–155 ms; inbox 100 requests at 20 concurrent, average 0.67 s |
| Sign-in with a non-localhost Host | `/sign-in` is 404, `/app/*` redirects: no staff access |
| e2e | Not run (no browser download available here) |

**Gaps, in the order they bite:**

1. **No deploy pipeline:** no `.github/` workflow, no `vercel.json`, no migrate script outside `scripts/local.ts`, no health route.
2. **No background jobs:** re-test expiry, the reminder and overdue alerts never run on their own.
3. **No env validation at boot:** a missing `IP_SALT` deploys green and then fails every public submission in front of judges.
4. **No observability:** `console.error` only, no error tracking, no request IDs.
5. **Managed-Postgres differences are untested:** the two SECURITY DEFINER lookups (receipt and published report) silently return nothing if the owner role lacks BYPASSRLS, which would break `/check`, `/r` and `/verify`.
6. **Email is sent inside a database transaction with no timeout** (`lib/email/send.ts:96`), which ties up pooled connections on serverless.
7. **Build-time URL:** `NEXT_PUBLIC_APP_URL` is compiled into the server bundle as `http://localhost:3000`, so emails from a deployed build would link to localhost.
8. **No backups, staging or demo reset;** `.env.example` sets `SEED_ALLOW_RESET=1`.

**Recommended platform: Vercel + Supabase (ca-central-1).** The repo already expects it, which saves 6–8 hours over Cloud Run. Be honest that Vercel computes in the US; pitch Cloud Run in Montréal with Cloud SQL as the fully Canadian production path.

**Runbook (one person, Platform lane):**

- **Oct 20:** accounts (Supabase ×2, Vercel, Clerk with roles `org:lead`, `org:owner`, `org:auditor`, Resend domain); `scripts/migrate.ts`; run the security smoke test against Supabase as the app role; `lib/env.ts` checked in `instrumentation.ts`; `/api/health`; GitHub Actions CI (install, typecheck, lint, test, smoke, build).
- **Oct 21:** Clerk adapter (shared with the Web lane) and seed with Clerk IDs.
- **Oct 22:** Vercel production and preview environments; daily cron route with `CRON_SECRET`; security headers; Sentry with no PII; email outside the transaction.
- **Oct 23:** e2e in CI against the preview URL; judge demo tenant with posted logins and a nightly reset; a load check recording p95 for the Devpost.

## Using real feedback data

There is no public dataset of raw accessibility complaints, but published progress reports give us real barriers, real organizations' own categories, and a benchmark nobody else has built.

**What 11 published Feedback sections actually say:**

| Organization | What its Feedback section reports |
| --- | --- |
| [Scotiabank 2025](https://www.scotiabank.com/content/dam/scotiabank/canada/en/documents/Scotiabank-Accessible-Canada-Act-Progress-Report-2025.pdf) | 1,550 client items (up 93%); 62% programs and services, 12% physical, 12% ICT; themes include text-based verification for Deaf clients |
| [Rogers 2024](https://www.rogers.com/accessibility/2024-accessibility-progress-report) | 199 items, no breakdown by area |
| [Veterans Affairs](https://veterans.gc.ca/en/about-vac/our-values/accessibility-veterans-affairs-canada/accessibility-action-plan-2025-2028/50-feedback) | 59 received, 35 in scope, counted by ACA area |
| [Health Canada 2024](https://www.canada.ca/content/dam/hc-sc/documents/corporate/accessibility/progress-reports/2024/2024-en.pdf) | 20 items with a table by area and an action per theme |
| [PC Financial 2025](https://www.pcfinancial.ca/api/v2/en-CA/assets/bank_accessibility_progress_report_2025.pdf) | No count; three barriers (card print, IVR timing, a portal), each with a fix |
| [National Bank](https://www.nbc.ca/content/dam/bnc/a-propos-de-nous/esg/pdf/accessibility-progress-report-lc.pdf), [BCE](https://pfo-www.bce.ca/accessibility/2025-bce-progress-report.pdf), [Air Canada](https://www.aircanada.com/ca/en/aco/home/plan/accessibility/progress-report.html), [Air Transat](https://www.airtransat.com/en-CA/travel-information/special-services/accessibility-plan/progress-report-year-2), [VersaBank](https://www.versabank.com/wp-content/uploads/2025/05/VersaBank-Accessibility-Progress-Report_2025-Accessible-Version.pdf), [WAGE](https://www.canada.ca/en/women-gender-equality/accessibility/progress-report/2024-report.html) | "A number of comments" or themes only; no counts |

**The tally is the pitch:** 6 of 11 give no total, only 3 break feedback down by ACA area, and none says whether the person who raised a barrier confirmed the fix. Federal guidance ([ESDC](https://www.canada.ca/en/employment-social-development/programs/accessible-canada-regulations-guidance/progress-reports/preparing.html)) recommends exactly those missing elements.

**Three ways to use it by October 24:**

1. **Realistic demo cases (4–6 h).** Add 10–15 cases paraphrased from these themes (IVR timeout, text verification for Deaf clients, motion-activated doors, airport assistance waits), each tagged "Scenario derived from public report: org, year, link; wording ours; not a real submission". Never name a real organization as a tenant.
2. **A silver-label eval set (6–8 h).** 60–100 one-line barrier statements labelled with the area the organization itself assigned (Health Canada and Veterans Affairs tables, Scotiabank's categories), plus pseudonymized [Canadian Transportation Agency decisions](https://otc-cta.gc.ca/eng/help-decision-search) for the transportation area, which is otherwise almost empty. Federal tribunal decisions may be reproduced without permission ([SI/97-5](https://laws-lois.justice.gc.ca/eng/regulations/SI-97-5/FullText.html)).
3. **A Feedback-section benchmark (8–12 h).** Score 25–40 published reports on the ESDC elements and show the lead "Your draft covers 6 of 6; the published median is 2." This is a dataset only we would have.

**Other sources:** Statistics Canada's [disability survey](https://www.statcan.gc.ca/o1/en/plus/5120-international-day-persons-disabilities-removing-visible-and-invisible-barriers) (72% met a barrier) for the market slide; [Calgary 311](https://data.calgary.ca/api/views/iahh-g8bj.json) has real accessibility request types and counts but no free text. Toronto's 311 dataset is retired and Ontario's AODA compliance data is restricted.

**Licences:** company reports are copyrighted, so use facts and themes in our own words with citations; canada.ca content is non-commercial reuse only unless it is on open.canada.ca under the [Open Government Licence](https://open.canada.ca/en/open-government-licence-canada).

## Features that take it to the next level

The differentiator is already proof, not AI: features that make the loop provable to a regulator and reachable by every reporter beat features that add more model calls.

| # | Feature | Why it's defensible | Moves | Effort |
| --- | --- | --- | --- | --- |
| 1 | **Regulator-checkable report:** signed root over every case chain at sign-off, public key at `/.well-known`, downloadable evidence bundle with an offline verifier, fingerprint placed in the notice to the Commissioner | "The first accessibility report a regulator can check without trusting us" | Innovation, Security | 6 h |
| 2 | **Feedback-section benchmark** from 25–40 published reports | A cited dataset nobody else has; turns the report screen into "you vs the field" | Innovation, Impact | 8–12 h |
| 3 | **Expo reporter app:** native text field (so OS dictation works), camera off by default, receipt codes kept in secure storage as "My reports", status and re-test in the app, VoiceOver/TalkBack checked | Reporters on phones; makes the Expo prize genuine | UI, Expo prize | 6 h API + \~24 h app |
| 4 | **QR posters per location:** a staff page prints a poster; the QR opens the form with the place filled in | Built-environment barriers (branches, doors) and a live on-stage moment: a judge scans and reports | Impact, UI | 3–5 h |
| 5 | **Auto-drafted feedback-process description** (ACR s.9) generated from settings and checked for title, anonymous option, channels | Fixes the regulator's most common inspection finding | Impact | 4–6 h |
| 6 | **Recurrence and duplicate detection:** "reported 3 times", "fixed before, came back" — Postgres history plus Haiku over a candidate list, refs validated against it | Owners stop re-fixing; report shows "N reports, 1 barrier" | Innovation, Tech | 6–8 h |
| 7 | **CAN-ASC-5.2.1 grounding:** clause 17 (receive, acknowledge, address, respond) coverage panel, plus clause suggestions with an exact quote validated as a substring | Grounded in the June 2026 national standard, never "compliant" | Innovation | 3–10 h |
| 8 | **Support-ticket sweep agent** on an Eon Era simulated Zendesk: flags accessibility complaints buried in general support and proposes staff-logged drafts; report precision and recall | Feedback that arrives through the wrong channel still counts under ACR s.9 | Eon prize, Tech | 10–16 h |
| 9 | **One-time re-test links** (signed, expiring, single-use) plus the expiry cron | Closes W2 and N3 properly | Security | 7 h |
| 10 | **French reporter flow and bilingual report** | Required for federal and Quebec buyers | Impact | 10–12 h |

**Sponsor strategy:** Clerk is required anyway for deployment, so it is a free prize entry. Expo is the second genuine fit. Eon Era is a stretch for whoever finishes early. Skip SurrealDB: "fixed before, came back" is a query over our own event log, and a second store would duplicate near-personal data outside row-level security and the hash chain.

**Roadmap only (say so honestly):** SMS or phone-keypad re-test, sign-language video intake, photo upload with EXIF stripping, an embeddable widget, Jira/ServiceNow hand-off.

## Action plan, October 20–25

Same four lanes as the team plan; each lane ships its Blockers by Oct 21, its Highs by the Oct 22 freeze, and only polish and evidence after that.

### Decisions the team must make today

- [ ] Approve changes to frozen files: `lib/state-machine.ts` (retriage, "stop waiting", staff-relayed verdict, spam only before triage), `db/sql/0100_security.sql` (owner and reporter row policies, sign-off lock), `lib/crypto.ts` (key ID, associated data), `lib/cases/create.ts`.
- [ ] Commit to deploying (Vercel + Supabase ca-central-1) and to Clerk.
- [ ] Pick the sponsor bets: Clerk and Expo; Eon Era only if someone finishes early.
- [ ] Book and pay two testers with disabilities for Oct 21 or 22 and Oct 24.

### By person

| Lane | Oct 20–21 (Blockers) | Oct 22 (Highs, then freeze) | Oct 23–25 (prove and ship) |
| --- | --- | --- | --- |
| **A · Mobile** | JSON API routes for preview, submit and status (reusing the existing pipeline); Expo app shell with a development build | Report flow, "My reports" in secure storage, re-test screen, VoiceOver/TalkBack pass against the deployed API | Tester session on the app; record the mobile segment of the video |
| **B · Web** | Clerk UI: sign-in route, select-org, org setup form for a new lead; fix "the reporter is asked" copy; contact block on reporter pages | Inbox search and filters, internal notes, owner email on assignment; QR posters; step-3 split; screen-reader fixes; show AI confidence in triage | Accessibility pass from tester notes; edit the video; rehearse |
| **C · Platform** | Accounts, migrate script, security smoke test on Supabase, env validation, health route, CI; Clerk middleware and role mapping with B; local-auth forwarding-header guard; `/verify` guard | Vercel production and preview; daily cron (expiry, reminder, overdue); security headers; DB TLS and role check; AI spend cap and IPv6 buckets; email outside the transaction; Sentry | e2e and load test against the live URL; judge demo tenant with nightly reset; `SECURITY.md` and the Devpost write-up |
| **D · AI** | Fix the API request shape and run a live smoke test; tighten the validator (order, length, banned words); honest metrics (closes after a fix count as not verified) | Redaction patterns (EN/FR, SIN, OHIP, transit, DOB); injection suite; seed cases and silver-label set from published reports; signed evidence bundle | Real eval of about 150 cases with holdout, cost and latency; make it the headline on `/app/eval` and Devpost; benchmark page if time allows |

### Cut on purpose

Photo upload, SMS re-test, the embeddable widget, full French UI, SurrealDB. State each one on Devpost as roadmap, with the reason.

### If something slips

- **Clerk not working by end of Oct 22:** deploy the public side only, label it honestly, and demo the staff side from the laptop.
- **Real AI eval not done by Oct 23:** keep the fake backend for the demo, labelled "simulated", and show the smoke-test numbers only.
- **Expo app not stable by Oct 23:** drop it from the video; QR posters become the mobile story.
