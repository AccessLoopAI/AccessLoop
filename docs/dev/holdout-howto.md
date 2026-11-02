# Writing the holdout set: a checklist for people

The holdout is the eval set nobody tuned anything against, so its numbers are the ones we publish. That only holds
if **no AI agent ever sees it**: agents can read any file in the project folder, in its worktrees and in any folder
they are working in, so the holdout lives somewhere none of them works. This page is the whole procedure; nothing
here needs an agent, and you should not use one for any step.

## Before you start

- [ ] Pick a folder **outside every project folder an agent works in**. On this Mac that means not inside
      `~/AccessLoop`, any of its worktrees, or `~/AccessLoop-main`. The default is `~/accessloop-holdout/`
      (next to the clone), which `.env.local` already points at: `HOLDOUT_PATH=../accessloop-holdout/reports.json`.
- [ ] Never open that folder in Claude Code or any other coding agent, never paste a holdout report into a chat, and
      never commit it. `.gitignore` ignores `eval/holdout/` except its README, but the file must not be there at all.
- [ ] Write the reports **yourselves**. Don't start from `eval/fixtures/reports.json`, `e1-candidates.json`,
      `injection.json` or the silver set: agents wrote or read all of those, so anything close to them is not held out.

## Write at least 10 reports (`reports.json`)

- [ ] Same format as `eval/fixtures/reports.json`: a JSON array of objects with `id`, `lang` (`en` or `fr`),
      `inputMode`, `locationKind`, `tags`, `text` and `expected` (`primaryArea`, `acceptableAreas`, `pii`, `notPii`,
      and `injection: true` or `abstain: true` where they apply). Use ids like `H01`, `H02` so they never clash.
- [ ] Ideally 3 to 5 come from testers with disabilities, in their own words and their own way of writing (typed,
      dictated, AAC), paid for their time and with their written OK to use the text this way.
- [ ] Spread them: at least 3 French; at least 3 that are not about a website (a building, a phone line, a policy,
      a job); one dictated or AAC-style; one that names two areas; one too vague to file (`primaryArea: null`,
      `abstain: true`); and one prompt-injection report whose trick is **not** in the injection suite.
- [ ] Personal details are all made up: phone numbers `555-0100` to `555-0199`, emails at `example.com` or
      `example.org`, the published sample SIN `046 454 286`, and street names nobody lives on. List each one in
      `expected.pii` with its type (`PERSON`, `STAFF_NAME`, `PHONE`, `EMAIL`, `STREET_ADDRESS`, `POSTAL_CODE`, `SIN`,
      `QUASI_ID`, `ACCOUNT_NUMBER`, `HEALTH_CARD`, `OTHER_ID`, `DOB`, `URL`), spelled exactly as in the text.
- [ ] Words that look like a detail but aren't (a guide dog's name, a screen reader, the organization's own address)
      go in `notPii`.

## Label them, two people apart

- [ ] Leave `primaryArea` and `acceptableAreas` out of the file you share. Each labeller works alone, in a copy of
      the sheet format: copy the header row of `eval/fixtures/e1-labelling.csv` into
      `~/accessloop-holdout/labelling.csv` and add one row per report (person A fills `a_primary` and `a_acceptable`,
      person B fills `b_primary` and `b_acceptable`; a primary label is an area key or `none`).
- [ ] Measure the agreement from the project folder, without opening anything in an agent:

      npm run eval:e1 -- kappa ../accessloop-holdout/labelling.csv

      It prints the agreement, Cohen's kappa and the ids to settle, never the texts.
- [ ] Write the kappa and the date in `~/accessloop-holdout/labels.md`, settle every disagreement together, then put
      the agreed labels into `reports.json`.

## Run it and publish only scores

- [ ] A person runs `npm run eval -- --set holdout` (with `--backend api` once a key exists). The result file keeps
      scores, ids, types and latencies only, never text.
- [ ] Results from `claude-cli` are internal and never published (docs/domain.md §6.1). Publish the `api` run.
- [ ] Back the folder up somewhere private (not the repo, not a shared drive an agent can reach).
