/**
 * What the hosted MCP's report tool returns. The full report JSON carries every
 * answer's text, brands and citations for every question (800 KB for a Full
 * report), more than an agent's tool result can hold, so the tool gave agents
 * nothing usable. By default it now returns the report without the answers and,
 * per question, "named in n of m usable answers" by engine; one question's
 * answers come back when the agent asks for that question by its number.
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

export function questionSummary(q: Question) {
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
    order: q.order, text: q.text, intent: q.intent, stage: q.stage,
    named: `${named} of ${of} usable answers`,
    engines: Object.fromEntries([...byEngine].map(([engine, e]) => [engine, { named: `${e.named} of ${e.usable}`, notUsable: e.notUsable }])),
  };
}

export function compactReport(body: ReportBody, question?: number): ReportBody {
  const report = body?.report;
  if (!report || !Array.isArray(report.questions)) return body;
  const questions = report.questions;
  if (question !== undefined) {
    // By the question's own order (real reports number from 0), never by list position.
    const match = questions.find((q) => q.order === question);
    if (!match) {
      const orders = questions.map((q) => Number(q.order)).filter(Number.isFinite);
      return { error: orders.length ? `No question with order ${question}; orders run ${Math.min(...orders)} to ${Math.max(...orders)}.` : `No question with order ${question}.` };
    }
    return { report: { slug: report.slug, brand: report.brand, domain: report.domain, simulated: report.simulated, enginesSkipped: report.enginesSkipped, question: match } };
  }
  return {
    ...body,
    report: {
      ...report,
      questions: questions.map(questionSummary),
      answersOmitted: `Answer texts, brands and citations are left out to fit an agent's context. Call again with question set to a question's order (from 0) for its answers. Engines in enginesSkipped did not run.`,
    },
  };
}
