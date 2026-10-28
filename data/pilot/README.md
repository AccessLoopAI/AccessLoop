# Pilot tenant: Northbound Rail & Ferry (made up)

A fourth made-up organization with 50 made-up reports, so the dashboard, inbox, report and `/verify` can be tried on
data shaped like real feedback. No person sent any of them. Each one takes one barrier theme from a public source and
says it again in our own words (`submissions.json`, checked by `lib/pilot.ts`):

- published Feedback sections (the same reports as `data/scenarios.json`, checked in
  `data/benchmark/verification-notes.md`);
- Canadian Transportation Agency accessibility decisions, with nobody in them named;
- Statistics Canada survey releases that list the kinds of barriers people meet.

Each case page shows "Scenario derived from public report: …; wording ours; not a real submission", and `/sources`
lists every case with its source.

## Run it (local only)

```bash
npm run local:db       # in one terminal (or have npm run local running)
npm run pilot:ingest   # in another
```

It refuses to run unless `AUTH_MODE=local`, `SEED_ALLOW_RESET=1` and `DATABASE_URL` points at this machine. It sends
every report through the real intake (redaction, `flagPii`, `structure`, `createCase`) with whatever AI backend
`.env.local` selects, then plays each case's planned steps through `transition()`. Run it again and it adds only what
is missing; `npm run local:reset` starts from nothing. Sign in as **Morgan Tremblay (Northbound Rail & Ferry)**.

With the fake backend most summaries and areas are canned. With `claude-cli` they are real Claude answers, which are
internal only: never quote them as the product's numbers (docs/domain.md §6.1).

## What the file holds per report

`source` (an id in this file or in `data/scenarios.json`), `theme`, `text` (our wording; any names and numbers in it
are made up), `channel`, `locationKind`, `locationDetail`, `anonymous` with a made-up `contact`, `wantsRetest`, `area`
(where the made-up lead files it), `publicSummary` (empty: the case stays new) and the planned `owner`, `steps` and
`duplicateOf`. Submission N becomes case BAR-000N, so keep the order.
