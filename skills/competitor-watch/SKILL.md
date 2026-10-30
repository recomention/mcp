---
name: competitor-watch
description: See which products AI engines name in a category and how a product compares with its competitors, from recomention's public rankings and the user's own reports. Use when the user asks who ChatGPT/AI recommends for a category, how they compare with a competitor in AI answers, or whether that changed since the last check.
---

# Competitor watch

Uses the `recomention_*` MCP tools. Everything here is read-only and free unless the user asks for a
new report.

## Steps

1. **Public rankings first.** Call `recomention_rankings_list`; for each ranking that matches the
   category, call `recomention_rankings_get`. Present the ranked products as "named in n of m answers"
   with the average position, per engine where it differs, and the date it was checked.
2. **The user's own reports.** Call `recomention_reports_list` and pick COMPLETE reports in the same
   category (non-simulated). For each, `recomention_report_get` and read `competitors` (share of
   answers, average rank) and per-engine `runsMentioned` of `runsTotal`.
3. **Compare like with like.** Only compare runs that asked the same questions (a re-check of the same
   report does; two unrelated reports usually do not) — say so when they differ. Put the user's product
   and its named competitors side by side: share of answers, engines that name each, average position.
4. **What changed.** If there are two or more comparable reports, list who moved up or down between the
   dates, and by how many answers. Small moves (one or two answers) are within run-to-run variation;
   call them that.
5. **Offer, don't start.** If nothing current covers the category, suggest a new report via the
   `ai-visibility-check` skill — and say that starting one spends a credit or the user's provider keys.

## Rules

- Rates, never yes/no. Always give the denominator and the date.
- Engines that were skipped or calls that failed are excluded, never counted as "not named".
- Simulated reports are test data: leave them out of any comparison.
- Name products only as the engines did; do not add your own opinion of which is better.
