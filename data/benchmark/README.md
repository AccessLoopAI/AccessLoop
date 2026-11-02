# Feedback-section benchmark (DRAFT until a person checks each row)

`feedback-sections.csv` scores published accessibility progress reports on what their **Feedback** section covers
(docs/archive/phase7-prompt.md T6 item 3). It is read by `lib/benchmark/` and shown to a lead as the "How your Feedback
section compares" card on a progress report's page, **computed only from rows with `verified_by_human` = `true`**.
While no row is checked, the card is hidden. Nothing else reads this file.

## The seven elements (one column each)

Six come from ESDC's guidance on preparing a progress report
(https://www.canada.ca/en/employment-social-development/programs/accessible-canada-regulations-guidance/progress-reports/preparing.html,
"Feedback" heading, page dated 2023-03-17, read 2026-10-20); the seventh is AccessLoop's own.

| Column | The section... | Where it comes from |
|---|---|---|
| `total_count` | says how much feedback was received in the period | ESDC, recommended |
| `by_area` | breaks it down by the areas of ACA s.5 | ESDC, recommended (breakdown by topic, such as the s.5 areas) |
| `by_channel` | says how much came through each way of giving feedback | ESDC, recommended (breakdown by submission method) |
| `areas_without_feedback` | says which areas or parts of the plan got no feedback | ESDC, recommended (feedback gaps) |
| `how_considered` | says how the feedback was taken into consideration | ACA s.71(5), required |
| `process_changes` | describes changes made or planned to the feedback process | ESDC, recommended (other relevant information) |
| `reporters_confirmed_fixes` | says whether the people who reported barriers confirmed the fixes | AccessLoop (not in the ESDC guidance) |

Values: `yes`, `partly`, `no`, `unknown`. Only `yes` counts towards a report's score (so a report's score is how many
of the 7 it covers fully); `partly` is kept so a reader sees the nuance. `unknown` means nobody has read that part yet.

## Other columns

- `source_id`, `organization`, `year`, `report_url`: the published report. The organization is only ever a source,
  never a tenant. The ids match `data/scenarios.json` where the same report was used.
- `read_by`: `review` = the values come from the Oct 20 ship-readiness review (docs/archive/phase7-review.md, "Using real
  feedback data"); `review+agent` = an agent also read the report's Feedback section on 2026-10-20 to fill the
  elements the review did not cover.
- `notes`: what the section does, in our own words. No passages and no figures are copied from any report.
- `verified_by_human`: `false` on every row as seeded. A person sets it to `true` only after reading the row's
  report and correcting every value. A `true` row must have no `unknown` value, and needs `verified_by` (initials or
  a name of someone on the team) and `verified_on` (YYYY-MM-DD); otherwise the whole file is refused and the card
  stays hidden (the server logs a short warning naming the row).

## How to verify a row (humans)

1. Open `report_url` and find the Feedback section.
2. For each of the 7 columns, set `yes`, `partly` or `no` from what the section says (use the table above).
3. Correct `notes` if needed (your own words, no figures copied).
4. Set `verified_by_human` to `true`, and fill `verified_by` and `verified_on`.
5. Run `npm test` (tests/benchmark.test.ts parses this file) and restart the app: the card appears on report pages
   once at least one row is verified, showing "Your draft covers N of 7 elements; published median is M".

Seed reading (from the review): 6 of the 11 reports give no total, 3 break feedback down by ACA area, and none says
whether the people who reported barriers confirmed the fixes. The rows reproduce those tallies.
