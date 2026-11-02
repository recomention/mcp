/**
 * What the MCP ranking tool returns. The public ranking JSON carries every answer's
 * text, products and citations for every prompt (about 270 KB for ai-search-engine,
 * over 300 KB for the largest), more than an agent's tool result can hold, so the tool
 * gave agents nothing usable. By default it now returns the ranking without the
 * answers: its prompts numbered from 1 with each engine's usable answers, and the
 * top products as "named in n of m usable answers", overall and by engine. One
 * prompt's answers come back when the agent asks for that question by its number,
 * optionally narrowed to one engine's answers (a whole prompt can run to 65 KB).
 *
 * Questions are numbered from 1 in the order the ranking lists its prompts, the same
 * numbering the ranking's answers use (`prompt: 1` is the first), and the same as
 * recomention_report_get.
 *
 * Counting follows the ranking's honesty rules: only answered runs are in a
 * denominator. Failed calls, runs that were never made and searches with no AI
 * Overview are not answers that named nobody, so they are reported apart.
 * Pure; operates on the public API's JSON, so the API stays unchanged.
 * Kept in step with core's application/mcp-ranking.ts (the hosted server); this package ships without core.
 */
import { QuestionNotFoundError } from "./report.js";

type Coverage = { engine?: unknown; answered?: unknown; failed?: unknown; notRun?: unknown; noAnswer?: unknown; skipped?: unknown };
type Prompt = { text?: unknown; coverage?: Coverage[] };
type Brand = { name?: unknown; domain?: unknown; mentions?: unknown; avgPosition?: unknown; byEngine?: Record<string, unknown> };
type Answer = { prompt?: unknown } & Record<string, unknown>;
type RankingBody = { ranking?: { prompts?: Prompt[]; brands?: Brand[]; answers?: Answer[] } & Record<string, unknown> } & Record<string, unknown>;

/** Products shown with engine counts by default; the rest, mostly named once or twice, by name and count. */
export const TOP_BRANDS = 30;

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function engineRow(c: Coverage) {
  return {
    answered: n(c.answered), failed: n(c.failed), notRun: n(c.notRun),
    ...(n(c.noAnswer) ? { noAnswer: n(c.noAnswer) } : {}),
    ...(typeof c.skipped === "string" ? { skipped: c.skipped } : {}),
  };
}

function promptSummary(p: Prompt, number: number) {
  const coverage = Array.isArray(p.coverage) ? p.coverage : [];
  return {
    question: number, text: p.text,
    usableAnswers: coverage.reduce((sum, c) => sum + n(c.answered), 0),
    engines: Object.fromEntries(coverage.map((c) => [String(c.engine), engineRow(c)])),
  };
}

export function compactRanking(body: RankingBody, question?: number, engine?: string): RankingBody {
  const ranking = body?.ranking;
  if (!ranking || !Array.isArray(ranking.prompts) || !Array.isArray(ranking.answers)) return body;
  const { prompts, answers } = ranking;
  const head = { slug: ranking.slug, category: ranking.category, month: ranking.month, checkedAt: ranking.checkedAt, engines: ranking.engines, url: ranking.url };

  if (engine !== undefined && question === undefined) throw new QuestionNotFoundError("engine narrows one question's answers: pass question as well.");
  if (question !== undefined) {
    const match = Number.isInteger(question) && question >= 1 ? prompts[question - 1] : undefined;
    if (!match) throw new QuestionNotFoundError(prompts.length ? `No question ${question}; questions are numbered 1 to ${prompts.length}.` : `No question ${question}; this ranking has no questions.`);
    const coverage = (match.coverage ?? []).filter((c) => engine === undefined || c.engine === engine);
    if (engine !== undefined && !coverage.length) throw new QuestionNotFoundError(`${engine} is not one of this ranking's engines: ${(match.coverage ?? []).map((c) => String(c.engine)).join(", ")}.`);
    const { engines: _byEngine, ...summary } = promptSummary({ ...match, coverage }, question);
    return {
      ranking: {
        ...head,
        question: {
          ...summary,
          ...(engine !== undefined ? { engine } : {}),
          coverage: coverage.map((c) => ({ engine: c.engine, ...engineRow(c) })),
          answers: answers.filter((a) => a.prompt === question && (engine === undefined || a.engine === engine)).map(({ prompt: _prompt, ...a }) => a),
        },
      },
    };
  }

  // An engine's usable answers across every prompt: the denominator for its count of each product.
  const usableBy = new Map<string, number>();
  for (const p of prompts) for (const c of p.coverage ?? []) usableBy.set(String(c.engine), (usableBy.get(String(c.engine)) ?? 0) + n(c.answered));
  const usable = [...usableBy.values()].reduce((a, b) => a + b, 0);
  const brands = Array.isArray(ranking.brands) ? ranking.brands : [];
  return {
    ranking: {
      ...head,
      runsPerPrompt: ranking.runsPerPrompt,
      ...(ranking.engineCheckedAt ? { engineCheckedAt: ranking.engineCheckedAt } : {}),
      usableAnswers: usable,
      engineAnswers: Object.fromEntries(usableBy),
      questions: prompts.map((p, i) => promptSummary(p, i + 1)),
      products: brands.slice(0, TOP_BRANDS).map((b) => ({
        name: b.name, ...(b.domain ? { domain: b.domain } : {}),
        named: `${n(b.mentions)} of ${usable} usable answers`,
        ...(typeof b.avgPosition === "number" ? { avgPosition: b.avgPosition } : {}),
        byEngine: Object.fromEntries(Object.entries(b.byEngine ?? {}).map(([engine, count]) => [engine, `${n(count)} of ${usableBy.get(engine) ?? 0}`])),
      })),
      // The rest by name and count only, so a product past the top is never mistaken for one no answer named.
      otherProducts: brands.slice(TOP_BRANDS).map((b) => `${String(b.name)} (${n(b.mentions)})`),
      productsShown: `products: the ${Math.min(TOP_BRANDS, brands.length)} most-named of ${brands.length} products, in the ranking's order. otherProducts: the rest, each with the number of usable answers that named it.`,
      ...(Array.isArray(ranking.merged) && ranking.merged.length ? { merged: ranking.merged } : {}),
      answersOmitted: "Answer texts, products and citations are left out to fit an agent's context. Call again with question set to a question's number (1 is the first) for its answers. Only answered runs are usable answers; failed, not-run and no-overview runs are counted apart, never as answers that named nobody.",
    },
  };
}
