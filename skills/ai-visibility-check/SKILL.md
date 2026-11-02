---
name: ai-visibility-check
description: Check whether AI engines (ChatGPT, Claude, Perplexity, Gemini, Grok) recommend a product, using the recomention MCP server. Use when the user asks "is my product recommended by ChatGPT/AI for <category>?", wants an AI visibility or AI search check, or names a domain and a category to check.
---

# AI visibility check

Uses the `recomention_*` MCP tools. Starting a report spends money (an agency credit, or calls on the
user's own provider keys), so this skill always asks before it starts one.

## Steps

1. **Collect the inputs.** You need the product's domain, the category buyers search for (e.g.
   "meeting scheduling"), and one line on what it does. Ask for whatever is missing; read it from the
   repository's README or landing page if the user is working in the product's own repo, and confirm.
2. **Look for free evidence first.** Call `recomention_rankings_list`. If a public ranking matches the
   category, call `recomention_rankings_get` and tell the user where the product appears (as "named in
   n of m answers", from `products` or `otherProducts`), or that it is absent from both. This costs nothing.
3. **Draft the questions.** Call `recomention_suggest_prompts` and show the list. Let the user edit,
   add or remove questions. None may contain the product's name — a question that names it measures
   nothing. Remove any that do and say why.
4. **Confirm spend, then start.** Say what will run: plan (credits run `FULL`), the engines, the
   funding (`credits` or `byok`). Only after the user agrees, call `recomention_report_start` with the
   edited questions as `prompts` and a fresh `idempotencyKey` (random, 16+ characters). Reuse that key
   if you have to retry the same start.
5. **Wait.** Poll `recomention_report_status` about once a minute and report progress
   ("answers stored / planned"). Do not start a second report for the same product meanwhile.
6. **Read it out.** When COMPLETE, call `recomention_report_get` and summarise:
   - the overall score (0–100) and, per engine, `runsMentioned` of `runsTotal` answers;
   - the top competitors named instead (share of answers);
   - the sources the engines cited most, and whether the product is on them;
   - the top three items of the fix list;
   - the report link (`url`) for the full detail.

## Honesty rules

- Rates, never yes/no: "ChatGPT named it in 4 of 9 answers", not "ChatGPT recommends it".
- An engine in `enginesSkipped` did not run. Give its reason (e.g. "provider rejected the key"). Never
  call it an engine that did not mention the product, and never count it as zero.
- An answer with `failed: true` was excluded from every count; do not treat it as "not mentioned".
- `simulated: true` means test data with made-up answers. Say so first, and draw no conclusions.
- Every report is a dated snapshot. Say the date when you quote numbers.
- If the report FAILED, say so and show its `error`. Credit-funded reports that fail get their credit
  back automatically; do not retry more than once without asking.
