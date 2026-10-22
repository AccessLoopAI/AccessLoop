# Holdout set: humans only

The holdout fixtures do **not** live in this folder. An agent can read any file in the project folder or in one of its git worktrees, even a file git ignores. Keep them **outside the project folder** and every worktree:

```
..\accessloop-holdout\reports.json
```

That is `../accessloop-holdout/reports.json`, a folder next to the project. `npm run local:setup` sets `HOLDOUT_PATH` to it.

Set `HOLDOUT_PATH` in `.env.local` to that file. Agents must never read, generate or edit it. Headline eval numbers come from this set because nobody tuned anything against it.

To build it, a human writes **at least 10** fixtures in the same format as `../fixtures/reports.json`.

1. Ideally, ask your testers with disabilities to write 3–5 of them in their own words (typed, dictated or however they normally write), and pay them for it.
2. Cover what the visible set has fewer of: French, a second quasi-identifier, staff names in an unusual format, an address in the text, a third injection that uses a different trick, and a report that mentions two priority areas.
3. All PII must be fake: phone numbers in 555-01xx, emails at `example.com`/`example.org`, and the published sample SIN `046 454 286` or another Luhn-valid number that isn't yours.
4. Two teammates label `primaryArea` and `acceptableAreas` independently. Record the agreement (Cohen's kappa) in `..\accessloop-holdout\labels.md`, then settle the disagreements.

To run it (a human starts this):

```bash
npm run eval -- --set holdout
```

The project already uses local git, and nothing has been pushed. When you publish the GitHub repo in Phase 6, the holdout stays out of it because it lives outside the folder (`.gitignore` also ignores everything in `eval/holdout/` except this README). Publish just the scores.
