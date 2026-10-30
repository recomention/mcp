---
name: distribution-kit
description: Turn a finished recomention report into distribution work: read its kit (product, competitors, AI visibility, where to get mentioned, channel plan) and work through the channel plan with the user, one channel at a time. Use when the user asks how to get their product recommended by AI engines, where to get mentioned, or what to do with a recomention report.
---

# Distribution kit

Reads a finished report's Distribution Kit with the `recomention_*` MCP tools. Costs nothing: it only reads.

## Steps

1. **Load the kit.** Get the slug (the last path segment of a `/r/<slug>` link, or pick from
   `recomention_reports_list`) and call `recomention_distribution_kit`. A 409 means the report is not
   finished: call `recomention_report_status`, say where it is, and stop.
2. **Read every file, `README.md` first.** If the files say SIMULATED TEST DATA, tell the user and stop:
   a test run's answers are made up.
3. **Summarise in five lines:** the score, each engine's "named in n of m answers", skipped engines and
   why, the top rivals, and the top three channels from `channel-plan.md`.
4. **Work the channel plan in order, one channel at a time.** For each, take the pages for that channel
   from `where-to-get-mentioned.md`, open them, and confirm they are still relevant before suggesting
   anything. Then draft the first task (a reply, a pitch email, a review request, a page on the user's
   own site) and show it to the user. Nothing is posted or sent without their yes.
5. **Close the loop.** Suggest a new report in about a month with the same questions, to see whether
   the engines' answers changed.

## Rules

- Be openly the product's maker everywhere: no fake reviews, no posing as a customer, no paid placement
  dressed as editorial, no vote manipulation.
- The kit counts citations; it did not read the pages. Check a page before acting on it.
- Quote counts as "n of m". An engine listed as skipped did not run; it is not a zero.
- Never promise traffic or rankings.
