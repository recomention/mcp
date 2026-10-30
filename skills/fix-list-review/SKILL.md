---
name: fix-list-review
description: Turn a finished recomention report into a prioritised, honest plan of work — what to change on the site, which third-party pages matter, and what to re-measure. Use when the user has a recomention report slug or link and asks what to do about it, how to improve their AI visibility, or to review the fix list.
---

# Fix list review

Reads a finished report with the `recomention_*` MCP tools. Costs nothing: it only reads.

## Steps

1. **Load the report.** Get the slug (the last path segment of a `/r/<slug>` link, or pick from
   `recomention_reports_list`). Call `recomention_report_get`. If `status` is not COMPLETE, call
   `recomention_report_status`, say where it is, and stop.
2. **State the baseline** in one short paragraph: overall score, per-engine `runsMentioned` of
   `runsTotal`, skipped engines with their reasons, the check date, and whether it is simulated.
3. **Walk the fix list** (`actionPlan`) in order. For each item give: what to do, why the report
   suggests it (point at the evidence: a competitor's share of answers, a cited source the product is
   missing from, a question where it never appears), and the effort.
4. **Ground it in the answers.** For the two or three questions where the product is absent most
   often, quote one short excerpt of an engine answer and the products it named instead. Use
   `questions[].answers[]`; skip answers with `failed: true`.
5. **Separate what the user controls from what they don't.** Their own site and docs: concrete edits
   they can make now (if you are in the product's repository, offer to draft them). Third-party pages
   (`sources` the engines cite): who to contact and what an honest inclusion request looks like.
6. **Say how to know it worked.** A later report with the same questions shows the change; suggest
   re-checking in about a month rather than days, since engines' answers move slowly.

## Rules

- Never suggest fake reviews, paid placements dressed as editorial, posing as a customer, or any
  other way of presenting the product as an unrelated third party. Community threads: answering
  openly as the founder is the honest option.
- Do not promise ranking outcomes. The report measures what engines said and where they looked.
- Quote counts as "n of m". An engine in `enginesSkipped` is not a zero.
- A simulated report has made-up answers: do not build a plan on it.
