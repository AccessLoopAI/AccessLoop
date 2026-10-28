# Benchmark check: evidence for each cell (for a person to sign off)

What `feedback-sections.csv` says, checked against each report's Feedback section on 2026-10-28. Nothing in the CSV
was changed: `verified_by_human` stays `false` on every row until a person reads this, fixes the CSV and signs.

- **Verdicts:** `confirmed` (the source supports the value), `wrong (should be …)` or `can't find`.
- **Evidence** is the place in the report plus what it says, in our own words. No passages or figures from the
  reports are copied beyond the counts the CSV is about.
- Column meanings are in [README.md](README.md).

## Summary

| Row | Loaded | Cells confirmed | Changes to consider |
|---|---|---|---|
| hc-2024 | yes | 7 of 7 | `process_changes` = yes rests on promotion campaigns; `partly` is also defensible |
| vac-2025 | yes | 7 of 7 | none |
| scotia-2025 | yes | 7 of 7 | none |
| rogers-2024 | yes | 7 of 7 | none |
| pcf-2025 | yes | 7 of 7 | none |
| nbc-2025 | yes | 6 of 7 | `total_count`: no → partly |
| bce-2025 | **no** | 0 of 7 | can't check: the server timed out again on 2026-10-28 |
| ac-2025 | yes | 7 of 7 | none |
| at-2025 | yes | 7 of 7 | none |
| versabank-2025 | yes | 7 of 7 | reword `notes` (see the row) |
| wage-2024 | yes | 6 of 7 | `how_considered`: partly → yes; reword `notes` |

The README's seed tallies still hold with these values: 6 of 11 reports give no total (NBC's approximate figure for
one channel is `partly`, not `yes`), 3 break feedback down by area, and none says whether reporters confirmed fixes.

## hc-2024 · Health Canada · 2024 progress report (PDF)

| Column | CSV | Verdict | Evidence |
|---|---|---|---|
| total_count | yes | confirmed | "What We Heard" (p. 19): a total of 20 submissions for Sept 2023 to Aug 2024, out-of-scope items excluded |
| by_area | yes | confirmed | "Barriers identified by priority area" table (p. 19), one row per area |
| by_channel | partly | confirmed | p. 19: all of it came by email or the online forms, with no count per channel; it also splits employees from the public |
| areas_without_feedback | yes | confirmed | The table shows 0 for Transportation and Programs and Services; pp. 23–24 say no feedback was received for either |
| how_considered | yes | confirmed | pp. 20–24: themes for each area, each followed by "Actions" |
| process_changes | yes | confirmed (borderline) | "How Feedback was Collected" (p. 18): social media campaigns and internal promotion of the feedback tool during the period. These promote the channels rather than change the process, so `partly` is defensible |
| reporters_confirmed_fixes | no | confirmed | Nothing in the section about reporters confirming fixes |

## vac-2025 · Veterans Affairs Canada · Accessibility Action Plan 2025–2028, 5.0 Feedback (web page, modified 2026-02-24)

| Column | CSV | Verdict | Evidence |
|---|---|---|---|
| total_count | yes | confirmed | 59 pieces from Oct 2024 to Sept 2025; 24 judged out of scope, 35 in scope |
| by_area | yes | confirmed | Figure 4 and its text description give the count per priority area |
| by_channel | partly | confirmed | Says everything came through the anonymous form and email, none by phone or mail, with no split between the two |
| areas_without_feedback | yes | confirmed | Figure 4 shows 0 for Transportation |
| how_considered | yes | confirmed | Each item is reviewed and, with consent, shared with the subject-matter experts; built-environment suggestions were passed on for action |
| process_changes | no | confirmed | Only a commitment to keep promoting and monitoring the mechanism; no change described |
| reporters_confirmed_fixes | no | confirmed | Not mentioned |

The `notes` are right that this is an action plan's Feedback section, not a progress report's.

## scotia-2025 · Scotiabank · 2025 ACA progress report (PDF)

| Column | CSV | Verdict | Evidence |
|---|---|---|---|
| total_count | yes | confirmed | "Feedback" (p. 7): 1,550 client and 93 employee pieces, Feb 2024 to Jan 2025 |
| by_area | yes | confirmed | p. 7: client feedback as percentages per area; p. 8: employee feedback by the bank's own categories |
| by_channel | no | confirmed | No split by channel anywhere in the section |
| areas_without_feedback | yes | confirmed | p. 7: none on procurement or transportation |
| how_considered | yes | confirmed | "How we address accessibility feedback" (p. 8): which team handles which feedback, and how insights become action items |
| process_changes | yes | confirmed | p. 8: says the process was improved, and an employee feedback survey launched in May 2024 |
| reporters_confirmed_fixes | no | confirmed | Not mentioned |

## rogers-2024 · Rogers · 2024 progress report (web page)

| Column | CSV | Verdict | Evidence |
|---|---|---|---|
| total_count | yes | confirmed | "Accessibility Feedback": 199 pieces in 2024 |
| by_area | no | confirmed | No breakdown by area; it only says three quarters came from wireless or internet/TV customers |
| by_channel | partly | confirmed | Most came by email or the online form, with no full split |
| areas_without_feedback | no | confirmed | Not mentioned |
| how_considered | yes | confirmed | People who left contact details were contacted; the rest went to the business; two "What we heard / What we did" pairs |
| process_changes | no | confirmed | No change to the feedback process described |
| reporters_confirmed_fixes | no | confirmed | Not mentioned |

## pcf-2025 · PC Financial · 2025 progress report (PDF)

| Column | CSV | Verdict | Evidence |
|---|---|---|---|
| total_count | no | confirmed | "4. Feedback received" (p. 11): says submissions came in during the year and names three new barriers, with no count |
| by_area | no | confirmed | No breakdown |
| by_channel | no | confirmed | No breakdown; only says nothing came from colleagues through the official mechanism |
| areas_without_feedback | no | confirmed | Not mentioned |
| how_considered | yes | confirmed | p. 11: the three barriers were taken into account in section 2.6, where each has an action |
| process_changes | no | confirmed | The mechanisms date from 2023; nothing changed in this period |
| reporters_confirmed_fixes | no | confirmed | Not mentioned |

## nbc-2025 · National Bank · 2025 progress report (PDF)

| Column | CSV | Verdict | Evidence |
|---|---|---|---|
| total_count | no | **wrong (should be partly)** | "7. Feedback" (p. 84): gives an approximate figure (fewer than 5 in the past year) for the employee channels only; no total for clients and the public |
| by_area | no | confirmed | Themes only (head office, banking services, staff interactions, buildings), no counts |
| by_channel | no | confirmed | Separates internal mechanisms from the public process in words, with no counts |
| areas_without_feedback | no | confirmed | Not mentioned |
| how_considered | yes | confirmed | pp. 82–83: an outside firm visited the head office with people with disabilities; comments shaped the bank's priorities |
| process_changes | yes | confirmed | p. 83: says it improved its processes by analysing feedback; p. 84: a 2025 employee campaign about the feedback channels |
| reporters_confirmed_fixes | no | confirmed | Not mentioned |

If `total_count` becomes `partly`, add "an approximate figure for employee channels only" to `notes`.

## bce-2025 · BCE · 2025 progress report (PDF)

**Can't check.** `https://pfo-www.bce.ca/accessibility/2025-bce-progress-report.pdf` timed out on 2026-10-28 (a
connection timeout, from two different fetchers), as it did on 2026-10-20. Every cell is `can't find`. The row
keeps its `unknown` values, so it can't be marked verified until someone opens the report from another network.

## ac-2025 · Air Canada · 2025 progress report (web page)

| Column | CSV | Verdict | Evidence |
|---|---|---|---|
| total_count | no | confirmed | "1.4 Feedback Received": the most common topics, with no count |
| by_area | no | confirmed | Topics only, not by area |
| by_channel | no | confirmed | Says feedback came through all the dedicated channels, with no split or counts |
| areas_without_feedback | no | confirmed | Not mentioned |
| how_considered | no | confirmed | Says feedback was acknowledged the way it came, and that customers are surveyed; nothing on what was done with the feedback |
| process_changes | partly | confirmed | 1.4: still refining how it guides customers to the right channel; no specific change named |
| reporters_confirmed_fixes | no | confirmed | Not mentioned |

## at-2025 · Air Transat · Progress report, year 2 (2024–2025, web page)

| Column | CSV | Verdict | Evidence |
|---|---|---|---|
| total_count | no | confirmed | "Feedback Received During the Past Year": "some feedback", no count |
| by_area | no | confirmed | No breakdown |
| by_channel | no | confirmed | No breakdown |
| areas_without_feedback | no | confirmed | Not mentioned |
| how_considered | yes | confirmed | Each item was followed up and analysed with the parties involved |
| process_changes | no | confirmed | The section describes no change; "How Feedback Is Analyzed" describes the existing process |
| reporters_confirmed_fixes | no | confirmed | Not mentioned |

## versabank-2025 · VersaBank · 2025 progress report, accessible version (PDF)

| Column | CSV | Verdict | Evidence |
|---|---|---|---|
| total_count | no | confirmed | No count anywhere in the report |
| by_area | no | confirmed | No breakdown |
| by_channel | no | confirmed | No breakdown |
| areas_without_feedback | no | confirmed | Not mentioned |
| how_considered | no | confirmed | Only the Consultations section says feedback from the working group and others shaped the report; nothing about feedback through the feedback process |
| process_changes | yes | confirmed | Completed action items: a process to record, categorize, assign and follow up each piece of feedback, and new employee channels |
| reporters_confirmed_fixes | no | confirmed | Not mentioned |

`notes` says it "reports no feedback received". The report doesn't say it received none; it just doesn't report
any. Suggested: "...but reports no feedback through the process (no count, no themes)."

## wage-2024 · Women and Gender Equality Canada · 2024 progress report (web page, dated 2024-12-19)

| Column | CSV | Verdict | Evidence |
|---|---|---|---|
| total_count | yes | confirmed | "Feedback": two individuals used the process this year |
| by_area | no | confirmed | No breakdown |
| by_channel | no | confirmed | Points to the online form, but doesn't say how the two came in |
| areas_without_feedback | no | confirmed | Not mentioned |
| how_considered | partly | **wrong (should be yes)** | It accounts for both items: the first was forwarded to the employee it praised; the second is identified as unrelated to accessibility |
| process_changes | no | confirmed | "Beyond 2024" is about the plan, not the feedback process |
| reporters_confirmed_fixes | no | confirmed | Not mentioned |

If `how_considered` becomes `yes`, change `notes` "Says what happened to one item, not the other" to "Says what
happened to each item (one thank-you, one out of scope)."

## What a person still has to do

1. Read each row's report and this page, fix any value you disagree with in `feedback-sections.csv`.
2. Set `verified_by_human` to `true` with `verified_by` and `verified_on` (README "How to verify a row").
3. BCE: open the report from another network, or leave the row unverified.
