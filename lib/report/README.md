# lib/report: the progress report, compiled (not generated)

docs/domain.md §7 (report) and §8 (evidence chain). The flow is **choose period -> freeze snapshot -> compile claims ->
phrase -> validate -> store the draft**; the UI (`/app/reports*`, `/p/[orgSlug]/reports/[id]`, `/verify/[reportId]`)
renders what this folder produces. No number is computed here: every fact wraps a `lib/metrics` function (the
dashboard's), and the AI only rewords sentences that the validator then checks one by one.

| File | Kind | What it does |
|---|---|---|
| `headings.ts` | **FROZEN**, pure | ACR s.14 checker `checkProgressReport(sections, settings)`, `passes()`, `AREA_HEADINGS`, `PRIORITY_AREAS` |
| `types.ts` | types | `ReportSnapshot`, `SnapshotCase`, `Fact`, `ReportClaim`, `ReportSentence`, `ReportContent`, `ReportSection`, `ReportBlock`, `ReportSettings`, `PhraseMeta` |
| `period.ts` | pure | `parsePeriod(start, end)` (field errors), `reportPeriodLabel` ("2026" or "Jan 1, 2026 to Mar 31, 2026"), `periodYears`, `isCalendarYear` |
| `facts.ts` | pure | `compileFacts(input)`: every §7.2 fact from lib/metrics; `FACT` ids; `factKindOf` |
| `snapshot.ts` | server (node:crypto), takes a tx | `snapshotFromCases` (pure), `buildSnapshot(tx, orgId, period, now)` (+ `verifyCaseChain` per case), `manifestHash`, `toSnapshotCase` |
| `claims.ts` | pure | `compileClaims(snapshot, { planAreas })`: claims with digit-free templates; `CLAIM` ids; `fillTemplate` (= lib/ai `fillClaimTemplate`) |
| `phrase.ts` | server | `phraseOrTemplates(claims, ctx, phraseFn)`: AiError -> templates (`ok: false`, class name kept); AiConfigError and bugs rethrown |
| `validate.ts` | pure | `validateSentence`, `validationContext(snapshot)`, `chooseSentences` (template fallback), `exportBlockers`, `contentSentences`, `revalidateContent` (/verify check 1 for content), `numbersIn` |
| `compose.ts` | pure | `reportSettings(org, formUrl)`, `generalSentences`, `buildContent` (§7.7 structure), `toDraftSections`, `reportChecks` (checklist + sign-off guard), `leadPrompt`, `leadTextFor`, `sentenceSources`, `citedCaseIds`, `FEEDBACK_SUBHEADINGS` |
| `replay.ts` | server (canonicalJson) | `replaySnapshot(snapshot, loadedCases)`: §8 check 3 (replay to each headHash, compare fields, recompute facts) and check 4 (`laterUpdates`); `cutAtHead` |
| `prepare.ts` | takes a tx | `prepareReport(tx, { orgId, period, now })`: org settings + snapshot + claims, or `no_org` / `broken_chain` |
| `generate.ts` | server, opens withOrg | `generateReport({ orgId, memberId, period, now?, ai?, phrase? })`: prepare (tx 1) -> phrase (no tx) -> validate -> insert the draft (tx 2) |
| `view.ts` | pure, client-safe types | `reportView(content, snapshot)`: sections + each sentence's sources as indexes into the snapshot's cases; `checksView` / `checksSummary` / `toWriteLine` (the "Report checks" list); `leadLabel`, `leadParagraphs`, `receivedPhrase`, `reportState`, `REGULATOR_NAMES`, `regulatorNoticeDue` (ACR s.16) |
| `readiness.ts` | pure | `reportReadiness(row)`: the dashboard's report-readiness card (state, the "Report checks" first line and "N parts still need your text" from `reportChecks` over the stored content and lead text, `canSignOff`, a next-step sentence) |
| `labels.ts` | pure, no imports | `sourcesButtonName(n)` ("Sources for this sentence (N records)"), `LEAD_TEXT_MAX` (4000), `BUILT_COOKIE` |
| `edit.ts` | takes a tx | `saveLeadText`, `signOffReport` (also seals and signs: `content.signing`), `publishReport`: the only writes after generation; each locks the row and updates only `where status = 'draft'` (text, sign-off) or `status = 'signed_off' and published_at is null` (publish), so a signed-off report never changes |
| `access.ts` | server, opens withOrg | `loadStaffReport(staff, id)` (+ member names, the org's regulator), `listStaffReports`, `loadDashboardReports(staff, period)` (the dashboard's cards: the newest report for exactly that period with its `reportReadiness`, and the org's newest report for the /verify link; leads and auditors only), `listPublishedReports(orgId)`, `loadPublishedReport(slug, id)` (signed off AND published, else null), `loadPublishedBundle(slug, id, now)` (the evidence bundle of a published report), `loadStaffEvidence(staff, id)` (the org's lead or auditor; draft or published), `loadPublicEvidence(id)` (org from `resolvePublishedReport()`; signed off AND published) |
| `text.ts` | pure | `reportPlainText(...)`: headings in capitals, `[n]` after every sentence, SOURCES, RECORDS, the evidence-check URL and the fingerprint; `plainTextFilename(title)` |
| `export.ts` | server | `reportTextResponse(report)`: the text/plain attachment, refused (409) while `exportBlockers` is not empty |
| `evidence.ts` | pure (node:crypto) | /verify: `readStoredReport` (shape guards; the stored values are checked as stored), `checkEvidence(stored, savedHash, chains, verdicts)` = the four checks of domain §8, the chain drawing (derived from check 2's verdict) and `line` ("All records match" only when checks 1-3 pass, else "Problems found: ..."); `eventWord` (staff-internal records say "Internal record"), `refList`, `FIELD_WORDS` |
| `verify.ts` | takes a tx | `loadVerifyTarget(tx, orgId, id, { publishedOnly })`, `loadChains` (case_events only), `runEvidenceCheck` (the frozen `verifyCaseChain` once per cited case, pipelined), `loadOrgHeads` (every case history of the org, each verified: what a sign-off seals) |
| `signing.ts` | pure (node:crypto) | The signed root (domain §8 "Signed at sign-off"): `reportRoot`, `rootStatement`, `leadTextHash`, `contentHash` / `contentForSigning`, `signRoot`, `rootSignatureValid`, `buildSigning` (sign-off), `readSigning`, `checkSignature` (a stored row against its signature: root, signature, which part changed), `publicKeyFromSpki`, `groupedHex` |
| `signing-key.ts` | server (env, node:crypto) | `loadReportSigner()` (REPORT_SIGNING_KEY, or derived from SESSION_SECRET in AUTH_MODE=local only; `SigningKeyError` names the variable, never a value), `keyIdOf`, `publishedKey` (the /.well-known entry), `ed25519FromSeed`. Reads the key and its date only through lib/env.ts (`secretFromEnv`, `signingKeyCreatedIso`), so it accepts exactly what the boot check accepts |
| `bundle.ts` | pure | "Download evidence bundle": `buildEvidenceBundle` (allow-list: hashes, types, times, statuses, areas, public summaries), `publicEvent`, `bundleJson`, `bundleFilename` |
| `signed-check.ts` | pure (node:crypto) | /verify's fifth check "Signed by AccessLoop at sign-off": `checkSigned({ row, keys, headsNow, refsById, citedIds })` (draft = "Not signed yet"; `checkSignature` over the row as stored + every sealed head still found and intact + every cited case among the sealed heads), `rowSigned` (the Records column), `signedReasons` / `signedClause` (the words), `headsPhrase`, `NOT_SIGNED_YET` |

Testability: everything except `generate.ts` imports only `type Tx`, never `db/client` (which throws without
`DATABASE_URL`). The DB reader is `lib/metrics/load-tx.ts` `loadMetricCasesTx(tx, orgId, { caseIds? })`.
Tests: `tests/report-core.test.ts` (pure, synthetic chains) and `tests/report.seed.test.ts` (seeded PGlite, now =
2026-10-19: seed facts, validator, generated draft, replay, broken chain).

## The snapshot (reports.snapshot, reports.manifest_hash)

`{ version: 1, period: { start, end }, asOf, cases: SnapshotCase[], facts: Fact[] }`: domain 7.1's `{ cases, facts }`
plus version, period and asOf (decision). `cases` = every case **received in the period** (America/Toronto calendar
dates, inclusive) and not closed as spam, **replayed from its events** (lib/metrics `periodCases`), in case-seq order:
`{ id, ref, status, priorityArea, publicSummary, receivedAt (ISO), verifiedAt (ISO|null), headHash }`, where headHash
is the case's latest event hash. `manifestHash = sha256(canonicalJson(snapshot))` (frozen helpers; key order and the
jsonb round trip do not change it). Generation refuses when any in-period chain fails `verifyCaseChain`.

## Facts (domain 7.2): never depend on org settings or on `now`

| id | values | caseIds | lib/metrics |
|---|---|---|---|
| `F_TOTAL` | total, web, email, phone, mail, in_person, other | all period cases | `totalReceived` |
| `F_ANON` | anonymous, total | anonymous cases | `anonymousReceived` |
| `F_NOT_FEEDBACK` | notFeedback (submissions closed as not accessibility feedback); only when 1 or more (Phase 7 D6) | those spam closes (the only fact that cites them) | `notFeedback` |
| `F_AREA:<area>` (all 7, zeros included) | count, area (canonical heading) | that area's cases | `priorityAreas().byArea` |
| `F_OUTCOME` | verified (code never through staff), verifiedViaStaffCode, unverified, open (new/triaged/assigned/waiting), closed (non-spam) | all period cases | `outcomes` |
| `F_VERIFY_TIME` (only when >= 1 verified) | medianDays, verified | verified cases | `medianDaysToVerifiedFix` |
| `F_ACK` | nonAnonymous, acked (in the intake channel's means), medianHours (left out when none) | non-anonymous cases | `acknowledgementCompliance` |
| `F_RETEST` | requested, answered (rounds), partlyOrNotFixed (rounds sent back) | cases with a re-test | `retestResponseRate` |
| `F_CASE:<ref>` (per verified or fixed case, seq order) | publicSummary, outcome (verified / fixed_unverified), viaStaffCode (yes / no) | that case | `fixedCases` |

Seed (2026, now 2026-10-19): 16 (11/2/1/1/1); 12 anonymous; areas 1/3/5/2/1/2/0; outcome 7/0/4/4/1; 14 days; 4 of 4
in 24 h; 10 asked, 9 answered, 1 sent back; 11 F_CASE. Changing a lib/metrics definition later changes recomputed
facts, so it turns check 3 red for reports frozen before the change: treat the definitions as frozen once a report is
published (or version them via `snapshot.version`).

## Claims (domain 7.3) and where they go (domain 7.7)

Claim ids are `C:` + fact id (`C:F_OUTCOME:relayed` and `C:F_OUTCOME:none_fixed` cite F_OUTCOME). `place`:
`feedback:intro` (C:F_TOTAL, C:F_ANON, C:F_NOT_FEEDBACK), `feedback:outcome` (C:F_OUTCOME, :relayed, C:F_VERIFY_TIME),
`feedback:followup` (C:F_ACK, C:F_RETEST, C:F_AREA:<area outside the plan with feedback>),
`feedback:consideration` (C:F_CASE:<ref>, or C:F_OUTCOME:none_fixed), `area:<area>` ("Feedback received in this
area: {count}." for each plan area). Templates hold no digits; singular/plural words are chosen at compile time;
C:F_OUTCOME always contains "confirmed by the person who reported".

## Validation (domain 7.5) and fallback

`validateSentence({ text, factIds }, ctx, claim?)` refuses: `empty`; `no_facts`; `unknown_fact`; `placeholder`
(`[ ] { }`); `contact_detail` (layer-1 `detectPatterns`); `uncited_case_ref` (a `BAR-nnnn` not among the cited facts'
cases); `invented_number` (a number, in digits or in words such as "twenty", "twice" or "half", not among the cited facts' number values, the period's years allowed);
`dropped_slot` (a number slot not written as that exact number, a text slot not verbatim); and, against the claim's
filled template (Phase 7): `number_order` (its numbers not in the template's order), `too_long` (more than 1.3 times
the template's words) and `banned_word` (compliant, fully, every, all, 100%, resolved, ... and the French ones, more
often than the template has them; `BANNED_WORDS`). The cited facts' text
values (a public summary, an area heading) are quoted verbatim and skipped by the scans. `chooseSentences` keeps a
phrased sentence only when it passes, else its template (`fallback: true`, `rejected`); a template that fails is kept
with `blocked` (sign-off and export blocked). Only claim sentences are validated: General is the org's own words.

## Content (reports.content) and the checklist

`ReportContent = { version: 1, settings, sections, phrase }`. `settings` (name, slug, plan areas in ACA order,
designate title, mail, phone, email, form URL) is frozen at generation: rechecks of a draft use it (a settings change
needs a new draft). Sections: `general` (blocks `org`), `area:<a>` per plan area (`lead` then the cited claim),
`consultations` (`lead`), `feedback` (claims; `subheading` h3s "What happened to the feedback", "How we followed up",
"How feedback was taken into consideration"; a `claimList` of the F_CASE sentences). `reports.area_text` is keyed by
**priority area** (`{ ict: "..." }`), `reports.consultations_text` holds Consultations.

`reportChecks(content, areaText, consultationsText)` -> `{ results (store as heading_check), passes, toWrite,
blockers, canSignOff }`. With every box empty Maple Harbour passes (only warnings: 6 areas + Consultations), so the
region says "All required checks pass"; `canSignOff` also needs `toWrite === 0` and no blockers.

## The pages (built)

- `/app/reports` (lead; auditor read-only; owners 404): the list, and the lead's one "New report" link.
- `/app/reports/new` (lead): "Period start" / "Period end" (default: this calendar year; `?start=&end=` prefill, which the dashboard's "Generate report" link uses),
  "Generate draft" -> `generateDraft` (zod, `parsePeriod`, `generateReport` with `aiRequestContext(host)`); it sets the
  one-time `BUILT_COOKIE` (the new id) and redirects to the draft. A cookie, not `?built=1`: a query in the page's
  segment key made the first save's refresh remount the page and scroll it to the top.
- `/app/reports/[id]` (lead; auditor read-only): `.al-sheet` publication (PageHeader as the cover: state badge, the
  title as h1, the one "Verify evidence chain" link, "Download as plain text"), `ReportBody`, the fingerprint, and the
  rail: `ReportChecks` (region "Report checks") and the sign-off panel. Lead + draft: one text box per plan area and
  Consultations (`saveSectionText`, result under its button, focus stays). "Sign off" (`canSignOff`) and "Publish",
  then the ACR s.16 reminder. With `BUILT_COOKIE` = this id the server renders `data-building` (sections fill in, the
  rings close), `BuildReveal` announces "Draft ready", focuses the h1 and deletes the cookie.
- `/app/reports/[id]/text` (staff) and `/p/[orgSlug]/reports/[id]/text` (public, published only, rate-limited):
  plain text. `/p/[orgSlug]`: the feedback process (ACR s.9) and the published reports. `/p/[orgSlug]/reports/[id]`:
  the published report (refs as plain text), fingerprint, "Verify evidence chain", print CSS.

## /verify/[reportId] (built)

Public for a signed-off AND published report (`loadPublicEvidence`, rate-limited `verify_view`); a draft only for the
org's signed-in lead or auditor (`loadStaffEvidence`, in the staff shell; owners, other orgs and the public get 404).
h1 "Evidence check"; the verdict (`check.line`, shown and announced through the one StatusRegion); "The five checks"
with the saved and recomputed fingerprints; the "Records" table (components/report/EvidenceCheck.tsx): one row per
cited case, columns Report unchanged / Records intact (+ the `EvidenceChain` drawing) / Report matches records /
Later updates / Signed at sign-off; then "Check it yourself, offline" (the bundle, the keys, the script, the command). Check 1 = `manifestHash` of the stored snapshot (as stored) AND `revalidateContent`; check 2 =
`verifyCaseChain` (a cited case with no records fails); check 3 = `replaySnapshot` over case_events only; check 4 =
events after the head; check 5 = signed-check.ts with `loadSignedHeads` (verify.ts) for a signed-off report. Tests:
tests/evidence.test.ts (pure), tests/evidence.seed.test.ts (seeded PGlite: real tampering), e2e/verify.spec.ts (the
demo beat through MIGRATION_DATABASE_URL, restored in `finally`), tests/signed-check.test.ts,
tests/signed-verify.seed.test.ts, e2e/signed-verify.spec.ts (check 5 and the offline checker).

## Signed at sign-off (Phase 7 T5)

`signOffReport` runs the report's evidence check (checks 1-3) and `loadOrgHeads`; only when both pass does it write
`content.signing` (lib/report/types.ts `ReportSigning`) in the sign-off UPDATE: the root over every org head + the
manifest hash + the lead-text hash + the content hash (without `signing`), signed with Ed25519. Refusals:
`evidence_failed`, `signing_unavailable`. The root is the "Signed fingerprint" in both footers (the staff one for the
ACR s.16 notice) and the plain text. Public key: `app/.well-known/accessloop-signing-keys.json/route.ts`. Bundle:
`app/p/[orgSlug]/reports/[id]/evidence.json/route.ts` (`loadPublishedBundle` in access.ts). Tests:
tests/signing.test.ts, tests/signing.seed.test.ts, e2e/evidence-bundle.spec.ts. Built since (T5 items 4-6): /verify's
fifth check (above); the sign-off lock trigger (db/sql/0100_security.sql block 2b: a signed-off row never changes,
except `published_at` once from null; db:smoke checks it); and the offline checker **tools/verify-bundle.mjs**
(dependency-free; `node tools/verify-bundle.mjs <bundle> --keys <key list> [--expect-root <hex>] [--json]`; exit 0 / 1 /
2), served at `/verify/verify-bundle.mjs` (app/verify/verify-bundle.mjs/route.ts, read at build time). Tests:
tests/verify-bundle.test.ts (pure), tests/signed-verify.seed.test.ts (tampering: each change turns the right check
red online and the checker fails on the same bundle).

## For the UI and /verify (as planned before the pages were built)

- **Draft page**: one `<section aria-labelledby>` + `<h2>` per `content.sections[i]` with `heading` as its exact text;
  `subheading` blocks are plain `<h3>` (never regions: their text contains "feedback"); each sentence's Sources list =
  `sentenceSources(sentence, snapshot)` (ref, publicSummary, status). Show `content.phrase.ok === false` as "Wording
  comes from the templates (the AI wording step was not available)."
- **Generate action**: `parsePeriod`, then `generateReport({ orgId, memberId (session), period, ai:
  aiRequestContext((await headers()).get("host")) })`; `{ ok: false, message }` goes to the ErrorSummary.
- **/verify**: check 1 = `manifestHash(row.snapshot) === row.manifest_hash` and `revalidateContent(row.content,
  row.snapshot).ok`; check 2 = `verifyCaseChain` per `citedCaseIds(content, snapshot)`; check 3 =
  `replaySnapshot(row.snapshot, await loadMetricCasesTx(tx, orgId, { caseIds: snapshot.cases.map(c => c.id) }))`
  (rows `ok`, `differs`, `factsDiffer`, `headFound`); check 4 = `laterUpdates`. Never read the `cases` projection.
