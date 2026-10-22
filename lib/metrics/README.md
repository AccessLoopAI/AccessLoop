# lib/metrics: one source of truth for numbers

docs/domain.md §10: every number on the dashboard and every fact in the progress report (§7.2) comes from these
functions, so the two can never disagree. No number is computed in a component, a page, the report code or by the AI.

- `lib/metrics/index.ts` (import `@/lib/metrics`): pure and client-safe. No database, no Next, no AI.
- `lib/metrics/load.ts` (import `@/lib/metrics/load`): server only. Reads the org's cases and events inside `withOrg`.
- `lib/metrics/load-tx.ts` (import `@/lib/metrics/load-tx`): `loadMetricCasesTx(tx, orgId, { caseIds? })` for code that
  already holds a withOrg transaction. It imports only `type Tx` (never `db/client`), so lib/report and PGlite tests can
  import it without `DATABASE_URL`; load.ts re-exports it.
- Tests: `tests/metrics.seed.test.ts` reproduces domain §10's expected-values table EXACTLY on a freshly seeded
  PGlite (`tests/support/seeded-db.ts`: migrations, security SQL, `db/seed.ts --reset`, as `npm run db:smoke` does),
  with `now = zonedNoon("2026-10-19")`. `tests/metrics.test.ts` covers the rules the seed does not exercise.
  `e2e/inbox-filters.spec.ts` checks that the inbox links list exactly the counted cases on the live database.

## Inputs

```ts
interface MetricEvent { seq: number; type: string; payload: Record<string, unknown>; createdAt: Date; hash?: string }
interface MetricCase  { id: string; ref: string; events: readonly MetricEvent[] }   // the case's WHOLE chain
interface Period      { start: string; end: string }                               // inclusive YYYY-MM-DD
interface MetricInput { cases: readonly MetricCase[]; period: Period; now: Date }
```

- **Everything is computed from events** (domain §8: a case's reportable state can be replayed from its events
  alone). `replayCase(c)` gives a `ReplayedCase`: receivedAt/receivedOn, channel, isAnonymous, codeRelayedByStaff
  (from `submitted`), status (the `to` of the last status-changing event), closedReason, priorityArea and
  publicSummary (from `triaged`), triagedAt, firstAssignedAt, firstFixLoggedAt, verifiedAt, assignedSince,
  redactionApprovedAt, acks, ackInIntakeChannelAt, retestRounds (each with its outcome), ai (backend and the
  reporter's summarySource), headHash. The `cases` projection is never read (only `id` and `ref`).
- For /verify check 3, replay the events **up to the snapshot's headHash** (`{ ...c, events: c.events.filter(e => e.seq <= headSeq) }`)
  and run the same functions on the result: the recomputed facts must equal the snapshot's.
- Pass the inputs as immutable objects: the replay is memoized per `MetricCase` object (`replayed(c)`).

**Dates.** All calendar arithmetic is in the display time zone (`lib/format.ts`, America/Toronto): "received in
March", "25 days", period edges. "Days" are whole calendar days between the two dates. Use `zonedNoon("YYYY-MM-DD")`
for a fixed `now` in tests.

**The period universe.** A period metric counts "feedback received in the period": received on a date in
`start..end` **and not closed as spam** (`inPeriod`). Exceptions: `needsAttention` looks at every case (spam
excepted), whatever the period: it is work to do now; `notFeedback` (Phase 7 D6) counts exactly the spam closes the
period leaves out, and `receivedCases` (every case received in the period, spam included) is a report snapshot's
cases, so F_NOT_FEEDBACK can cite them.

Period helpers: `thisYear(now)`, `last90Days(now)` (today included), `customPeriod(start, end)` (null when invalid),
`periodMonths(period, now)` (first month to the end or today, whichever is earlier), `monthLabel`, `monthShortLabel`,
`periodLabel`, `daysBetween`, `addDays`, `todayOf`.

## Outputs: numbers with the cases behind them

```ts
interface CaseSet  { count: number; caseIds: string[]; filter: InboxFilter } // count === caseIds.length
interface RoundSet { rounds: number; caseIds: string[]; filter: InboxFilter } // re-test ROUNDS; caseIds = their cases
type Rate = number | null                                                     // null = denominator 0: never show 0%
```

`caseIds` keep the input order (the loader orders by case seq). `filter` opens exactly those cases in the inbox:
`inboxHref(set.filter)`. A unit test walks every set in `computeDashboardMetrics()` and checks it.

| Function (`MetricInput` →) | Returns | Dashboard / report |
|---|---|---|
| `totalReceived` | `{ total, byChannel: Record<web\|email\|phone\|mail\|in_person\|other, CaseSet> }` | F_TOTAL |
| `intakeChannels` | rows `{ channel, label, cases }`: web, email, phone, mail, in person always; other when used | Intake channels chart (ACR s.9(3)) |
| `anonymousReceived` | `CaseSet` | F_ANON |
| `notFeedback` | `CaseSet`: received in the period and closed as not accessibility feedback (spam); filter `notFeedback=yes` | Dashboard footnote; F_NOT_FEEDBACK (only when count > 0) |
| `statusCounts` | `Record<CaseStatus, CaseSet>` (all 7) | |
| `openBarriers` | `{ total, byStatus: { new, triaged, assigned, retest_open } }` | Open barriers tile |
| `outcomes` | `{ verified, verifiedStaffRelayed, fixedUnverified, inProgress, closed }` (they split the period's cases) | F_OUTCOME |
| `fixedCases` | `{ caseId, ref, status, publicSummary, priorityArea, receivedAt, verifiedAt, codeRelayedByStaff }[]` for verified and fixed cases | F_CASE:<ref> |
| `verifiedFixRate` | `{ verified, verifiedStaffRelayed, notVerified, waiting, fixedUnverified, backInProgress, closedAfterFix, fixLogged, rate }` (D6) | Headline ring |
| `medianDaysToVerifiedFix` | `{ days: number \| null, cases, perCase: { caseId, days }[] }` | Tile; F_VERIFY_TIME (only when `days !== null`) |
| `acknowledgementCompliance` | `{ required, acknowledged, missing, recordedLate, rate, medianHours }` (`recordedLate`: Phase 7, filter `anonymous=no&ack=late`) | Tile (and its "recorded more than 7 days after the date given" line); F_ACK |
| `reporterCorrectionRate` | `{ kind: "no_real_ai_yet", label: "No real-AI summaries yet", count: 0, ... }` or `{ kind: "measured", count, reviewed, corrected, rate }` | Tile |
| `retestResponseRate` | `{ requested, answered, unanswered, sentBack, rate }` (RoundSets) | Tile; F_RETEST = `sentBack` |
| `retestOutcomeCounts` | rounds per outcome (open, fixed, partly, not_fixed, cant_check, opted_out, expired) | |
| `loopFunnel` | `{ reported, triaged, assigned, fixLogged, verified }` (reached that stage) | Funnel chart |
| `receivedVsVerifiedByMonth` | rows `{ month: "2026-03", received, verified }` | Monthly chart |
| `priorityAreas` | `{ byArea: Record<PriorityArea, CaseSet>, notClassified, rows: { area, heading, cases }[] }` | Area chart; F_AREA:<area> |
| `needsAttention` (`{ cases, now }`) | `{ items: { caseId, ref, reason, since, days }[], byReason, all }` | "Needs attention" list |
| `computeDashboardMetrics` | all of the above in one object (`DashboardMetrics`), plus `period` and `asOf` | `/app/dashboard` |
| `periodCases` | the period's `ReplayedCase[]` (spam not counted) | Every period metric |
| `receivedCases` | every case received in the period, spam included (D6) | Report snapshot rows (§7.1) |

Server: `loadMetricCasesTx(tx, orgId, { caseIds? })` (inside your own `withOrg` transaction, e.g. while freezing a
snapshot; `caseIds` limits the read, e.g. /verify reading only a snapshot's cases),
`loadMetricCases(ctx)` (its own `withOrg`), `loadDashboardMetrics(staff, period, now?)` → `{ cases, metrics }`.
The org always comes from the server (`requireStaff()`, `resolvePublishedReport()`).

## The dashboard's extra pieces

- `lib/metrics/dashboard.ts` (server): `loadDashboard(staff, period, now?)` → `{ metrics, integrity, deadline,
  entityClass }` in ONE `withOrg` transaction: the org's entity class (`orgs`, not tenant-scoped), the cases and
  events, `computeDashboardMetrics`, and the evidence-integrity check. `/app/dashboard` uses only this.
- `lib/metrics/integrity.ts` (server): `verifyPeriodChains(tx, orgId, period, set, cases, now?)` runs the frozen
  `verifyCaseChain` over every case of `set` (the period's cases, `metrics.total.total`) → `{ checked, intact, broken:
  { caseId, ref, brokenAtSeq }[], checkedAt }`. Cached 60 s per server process, keyed by org + period + every chain head
  as loaded (a new event is checked at once; an edited row with unchanged stored hashes is found within 60 s).
- `lib/metrics/deadline.ts`: `nextDeadline(entityClass, now)` → domain §1.5's next deliverable with `daysLeft` (whole
  calendar days, display time zone) and the banner `sentence` = `lead` + ": " + `countdown` ("Progress report due June
  1, 2027: 225 days"; "… today"; "… was due …: 3 days ago").
- `lib/metrics/dashboard-period.ts`: `parseDashboardPeriod(searchParams, now)` for the GET form (`period=year|90d|custom`,
  `start`, `end`): unknown values → this year; custom dates that do not make a period keep what was typed and give
  `problem` ("missing" | "order", `CUSTOM_PERIOD_ERRORS`), and the numbers fall back to this year. `dashboardHref()`.
- `lib/metrics/format.ts`: numbers as words, so components never round: `percentLabel(rate)` ("88%", null for no
  data), `decimalLabel`, `daysLabel`, `hoursLabel`, `countLabel`, `NO_DATA_YET`, `attentionReasonLabel`,
  `attentionWaitLabel` ("Re-test open 25 days", "Assigned 40 days, no fix logged").
- `monthShortYearLabel("2026-09")` → "Sep 2026" (a chart table on a phone).

## Definitions (decided here; docs/decisions.md 2026-10-19)

- **Verified-fix rate** (Phase 7 D6, docs/decisions.md 2026-10-20) = `verified / fixLogged`. `fixLogged` = the
  period's cases with at least one `fix_logged` event (`fixLogged(s)`: `firstFixLoggedAt !== null`), whatever their
  status now; it is the funnel's "Fix logged" set, filter `{ from, to, stage: "fix_logged" }`. `verified`
  (numerator) = status verified with a code that never passed through staff. `verifiedStaffRelayed`
  (submitted.codeRelayedByStaff) is shown apart: it stays in the denominator, so the rate can only be understated.
  `notVerified` = fix logged and not verified now, split into `waiting` (retest_open), `fixedUnverified`,
  `backInProgress` (new/triaged/assigned: sent back, or reopened, D4) and `closedAfterFix`: a close or a stopped wait
  after a fix counts as not verified. A reopened verified case leaves the numerator from the reopen on (the replay
  clears its `verifiedAt`). Seed: 7 / 12. (Before D6 it was verified / cases offered a re-test that were now verified
  or fixed-not-verified: 7 / 8.)
- **Closed as not accessibility feedback** (`closedAsNotFeedback(s)` = `isSpam(s)`: status closed, reason spam):
  received in the period (`receivedInPeriod`, spam included). Never counted by another number. Seed: 0.
- **Median days to verified fix**: calendar days received → the `retest_verdict` that verified it, over every verified
  case (staff-relayed included). Even count: the mean of the two middle values.
- **Acknowledgement compliance**: non-anonymous cases with an `ack_recorded` whose channel is the intake channel
  (`web` → `web_screen`). A staff-recorded acknowledgement counts from the day it was given (`payload.on`).
  `medianHours` (F_ACK): received → that acknowledgement, one decimal, never below 0.
  **Recorded late** (Phase 7, acknowledgement honesty; `ackRecordedLate(s)`, `ACK_RECORDED_LATE_DAYS` = 7): that same
  counted acknowledgement is a staff record whose own time (`recordedAt`, the event's `createdAt`) falls MORE than 7
  calendar days after the day it gives (`givenOn` = `payload.on`). It still counts as acknowledged, on the day typed;
  `recordedLate` says how many were written down late. The on-screen receipt and AccessLoop's own emails carry no
  typed day, so they are never late. Each replayed ack is `{ channel, at, recordedAt, givenOn }`.
- **Reporter-correction rate**: only `ai_structured` with backend `claude-cli` or `api` AND a summary the reporter
  reviewed (summarySource ai_confirmed, ai_edited, reporter_words; staff-logged "staff" summaries are left out).
  Corrected = ai_edited or reporter_words. None → `kind: "no_real_ai_yet"`, count 0, rate null.
- **Re-test response rate**: answered rounds / requested rounds. Answered = any verdict ("I can't check right now"
  included) or "Don't contact me about this again" while the round is open; an expired round is not answered.
- **Funnel**: each stage counts cases that ever reached it (a `triaged` / `assigned` / `fix_logged` event; verified =
  status verified, staff-relayed included).
- **By priority area**: the area confirmed at triage; never triaged = "Not classified yet" (new cases, cases closed
  from new). `rows`: areas with cases, most first, ties in ACA s.5 order, then "Not classified yet".
- **Needs attention**: `redaction` = new with no `redaction_approved`; `retest` = the open round was requested more
  than 14 days ago; `stalled` = assigned for 30+ days with no fix logged (the clock starts when the case entered
  "assigned"; a reassignment does not restart it; a fix sent back does); `unacknowledged` = non-anonymous with no
  acknowledgement in the intake channel. Items: by reason in that order, longest waiting first.

## Inbox filters (`lib/metrics/filters.ts`)

`parseInboxFilter(searchParams)` (zod; unknown keys and invalid values are dropped, repeated or comma-separated
values allowed), `inboxHref(filter)`, `applyInboxFilter(cases, filter, now)` → case IDs, `matchesInboxFilter`,
`describeInboxFilter(filter, { memberName? })` → plain-words lines (the member's name for `assignee`), `isFilterActive`.
The inbox's search, sort and pages are not filters: `lib/cases/inbox-query.ts`. Keys (AND; list values OR):

| key | values |
|---|---|
| `from`, `to` | the period (both or neither; spam not counted) |
| `status` (list) | the 7 statuses |
| `area` (list) | priority area keys, or `none` (not classified yet) |
| `channel` (list) | web, email, phone, mail, in_person, other |
| `assignee` (list) | org_members ids, or `none` (nobody): the replayed `assignedTo` (Phase 7 T2 item 5) |
| `age` | under_7, 7_29, 30_89, 90_plus: whole days since received (`caseAgeDays`, lib/metrics/queue.ts) |
| `month` | YYYY-MM received |
| `verifiedMonth` | YYYY-MM the reporter confirmed the fix |
| `attention` (list) | redaction, retest, stalled, unacknowledged |
| `stage` | triaged, assigned, fix_logged (reached) |
| `anonymous` | yes, no |
| `ack` | yes, no, late (acknowledged, but the staff record was written more than 7 days after the day it gives) |
| `retest` | requested, answered, unanswered, sent_back |
| `code` | staff, direct |
| `ai` | real, corrected |
| `notFeedback` | yes: only the submissions closed as not accessibility feedback (spam); with `from`/`to`, spam is otherwise never in the period (D6) |

## The staff queues (`lib/metrics/queue.ts`, Phase 7 T2 items 5 and 6, decision D8)

One definition of age and due dates for the inbox, My work, the case page and the filters above:
- `ageInDays(receivedAt, now)` / `caseAgeDays(s, now)`: whole calendar days since received (display time zone);
  `AGE_FILTERS`, `AGE_FILTER_LABELS`, `inAgeRange`, `ageLabel` ("Today", "1 day", "12 days").
- `dueAtForDate("2026-11-03")`: the instant stored in `cases.due_at` and the `assigned` event (`dueAt`, ISO): the last
  millisecond of that day in the display time zone, so "past due" starts when the day is over and `due_at <= now`
  (the daily job on main) agrees with the calendar. `dueDateOf(dueAt)` gives the date back.
- `pastDue(status, dueAt, now)` / `isOverdue(s, now)`: **overdue** = the due date has passed while the case is
  `assigned` (no fix logged, not closed). `dueState(status, dueAt, now)` → none / overdue / today / upcoming, with the
  days, for `components/ui/DueDate.tsx`. Only an assigned case shows a due date (after a fix it is history).
- The replay adds `assignedTo` (the latest `assigned` event's member) and `dueAt` (the latest `assigned` event that
  carries `dueAt`; one written before D8 keeps the earlier date); a reopen from closed clears both, as in the row.

## Report facts as thin wrappers (Phase 4)

A fact is `{ id, kind, values, caseIds }` (§7.2). With `input = { cases: snapshotCases, period, now }`:

```ts
const t = totalReceived(input);
F_TOTAL   = { values: { total: t.total.count, ...Object.fromEntries(Object.entries(t.byChannel).map(([k, v]) => [k, v.count])) }, caseIds: t.total.caseIds }
F_ANON    = from anonymousReceived(input)                                   // { anonymous: count }
F_NOT_FEEDBACK = notFeedback(input), only when count > 0                    // { notFeedback: count } (D6)
F_AREA:a  = from priorityAreas(input).byArea[a]                             // one per plan area
F_OUTCOME = from outcomes(input)                                            // verified, verifiedStaffRelayed, fixedUnverified, inProgress, closed
F_VERIFY_TIME = medianDaysToVerifiedFix(input)                              // only when .days !== null; caseIds = .cases.caseIds
F_ACK     = acknowledgementCompliance(input)                                // acknowledged.count, required.count, medianHours
F_RETEST  = retestResponseRate(input).sentBack                              // rounds, caseIds
F_CASE:ref = fixedCases(input)                                              // one per entry, with publicSummary
```

Never add a number to a report that does not come from one of these; add a function here instead. Built in Phase 4:
`lib/report/facts.ts` `compileFacts()` (values and ids in lib/report/README.md).
