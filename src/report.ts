/**
 * What the hosted MCP's report tool returns. The full report JSON carries every
 * answer's text, brands and citations for every question (800 KB for a Full
 * report), more than an agent's tool result can hold, so the tool gave agents
 * nothing usable. By default it now returns the report without the answers and,
 * per question, "named in n of m usable answers" by engine; one question's
 * answers come back when the agent asks for that question by its number.
 *
 * Questions are numbered from 1 in the order the report lists them (the API sorts by the stored
 * `order`, which starts at 0): question 1 is the first. Users say "question 2" for the second
 * question, so the 0-based order is not shown. The `question` argument counts the same way; 0 is
 * deprecated and also reads as the first question (tool lists and agents from before 0.1.2 sent 0
 * for it), so 0 and 1 name the same question on purpose.
 *
 * Counting follows the report's honesty rules: a failed call or an engine that
 * gave no answer is not a usable answer, so it never counts as "not named".
 * Pure; operates on the public API JSON. Kept in step with core's
 * application/mcp-report.ts (the hosted server); this package ships without core.
 */
type Answer = { engine?: unknown; failed?: unknown; noAnswer?: unknown; mentioned?: unknown };
type Question = { order?: unknown; text?: unknown; intent?: unknown; stage?: unknown; answers?: Answer[] };
type ReportBody = { report?: { questions?: Question[] } & Record<string, unknown> } & Record<string, unknown>;

const usable = (a: Answer) => !a.failed && !a.noAnswer && (a.mentioned === true || a.mentioned === false);

export function questionSummary(q: Question, number: number) {
  const answers = Array.isArray(q.answers) ? q.answers : [];
  const byEngine = new Map<string, { named: number; usable: number; notUsable: number }>();
  for (const a of answers) {
    const e = byEngine.get(String(a.engine)) ?? { named: 0, usable: 0, notUsable: 0 };
    if (usable(a)) {
      e.usable++;
      if (a.mentioned === true) e.named++;
    } else e.notUsable++;
    byEngine.set(String(a.engine), e);
  }
  const named = [...byEngine.values()].reduce((n, e) => n + e.named, 0);
  const of = [...byEngine.values()].reduce((n, e) => n + e.usable, 0);
  return {
    question: number, text: q.text, intent: q.intent, stage: q.stage,
    named: `${named} of ${of} usable answers`,
    engines: Object.fromEntries([...byEngine].map(([engine, e]) => [engine, { named: `${e.named} of ${e.usable}`, notUsable: e.notUsable }])),
  };
}

/**
 * The agent asked for a question the report does not have. Thrown, not returned: the
 * API answered 200, so a returned { error } would reach the agent as a successful result.
 * Both servers turn it into a tool error (isError: true) carrying this message.
 */
export class QuestionNotFoundError extends Error {
  override name = "QuestionNotFoundError";
}

const ZERO_IS_DEPRECATED = "question 0 is deprecated: questions are numbered from 1, and 0 reads as 1, the first question.";

export function compactReport(body: ReportBody, question?: number): ReportBody {
  const report = body?.report;
  if (!report || !Array.isArray(report.questions)) return body;
  const questions = report.questions;
  if (question !== undefined) {
    // 1-based: question n is the n-th in the report's order. The deprecated 0 also means the first.
    const index = question === 0 ? 0 : question - 1;
    const match = Number.isInteger(index) && index >= 0 ? questions[index] : undefined;
    if (!match) throw new QuestionNotFoundError(questions.length ? `No question ${question}; questions are numbered 1 to ${questions.length}.` : `No question ${question}; this report has no questions.`);
    const { order: _storedOrder, ...rest } = match;
    return {
      report: {
        slug: report.slug, brand: report.brand, domain: report.domain, simulated: report.simulated, enginesSkipped: report.enginesSkipped,
        question: { question: index + 1, ...rest },
        ...(question === 0 ? { numbering: ZERO_IS_DEPRECATED } : {}),
      },
    };
  }
  return {
    ...body,
    report: {
      ...report,
      questions: questions.map((q, i) => questionSummary(q, i + 1)),
      answersOmitted: `Answer texts, brands and citations are left out to fit an agent's context. Call again with question set to a question's number (1 is the first) for its answers. Engines in enginesSkipped did not run.`,
    },
  };
}
