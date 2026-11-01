import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { apiV1Root, createApi, DEFAULT_BASE_URL } from "./api.js";
import { createServer } from "./server.js";
import { suggestPrompts } from "./suggest.js";

const PROVIDER_KEY = "sk-test-NEVER-IN-A-RESULT-123456";

async function connect(env: Record<string, string | undefined>, respond: (url: string, init: RequestInit) => Response) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string | URL, init: RequestInit = {}) => {
    requests.push({ url: String(url), init });
    return respond(String(url), init);
  }) as typeof fetch;
  const api = createApi({ baseUrl: "https://site.test/", apiKey: "rmk_test", fetch: fakeFetch });
  const server = createServer(api, env);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, requests };
}

const text = (result: unknown) => ((result as { content: { text: string }[] }).content[0]?.text ?? "");

test("every documented tool is listed", async () => {
  const { client } = await connect({}, () => Response.json({}));
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "recomention_distribution_kit",
    "recomention_rankings_get",
    "recomention_rankings_list",
    "recomention_report_get",
    "recomention_report_start",
    "recomention_report_status",
    "recomention_reports_list",
    "recomention_suggest_prompts",
  ]);
});

test("rankings are read without the API key; reports send it as a Bearer token", async () => {
  const { client, requests } = await connect({}, (url) => Response.json(url.endsWith("/rankings") ? { rankings: [{ slug: "crm" }] } : { status: { status: "RUNNING" } }));
  const list = await client.callTool({ name: "recomention_rankings_list", arguments: {} });
  assert.match(text(list), /"crm"/);
  assert.equal(new Headers(requests[0].init.headers).get("authorization"), null);
  await client.callTool({ name: "recomention_report_status", arguments: { slug: "abcdefgh1234" } });
  assert.equal(requests[1].url, "https://site.test/v1/reports/abcdefgh1234/status");
  assert.equal(new Headers(requests[1].init.headers).get("authorization"), "Bearer rmk_test");
});

test("BYOK keys come from the server env, go only into the request body, and never into a result", async () => {
  const { client, requests } = await connect({ OPENAI_API_KEY: PROVIDER_KEY }, () => Response.json({ slug: "newslug12345", status: "PENDING", reused: false, funding: "byok" }, { status: 202 }));
  const result = await client.callTool({
    name: "recomention_report_start",
    arguments: { domain: "example.com", description: "Booking links", category: "meeting scheduling", plan: "QUICK", funding: "byok", prompts: ["which scheduling tool is best for agencies?"] },
  });
  assert.equal(result.isError, undefined);
  assert.doesNotMatch(text(result), /NEVER-IN-A-RESULT/);
  const sent = JSON.parse(String(requests[0].init.body));
  assert.deepEqual(sent.providerKeys, { OPENAI: PROVIDER_KEY });
  assert.deepEqual(sent.seedPrompts, ["which scheduling tool is best for agencies?"]);
  assert.equal(sent.funding, "byok");
});

test("BYOK without any provider key in env fails before calling the API", async () => {
  const { client, requests } = await connect({}, () => Response.json({}));
  const result = await client.callTool({ name: "recomention_report_start", arguments: { domain: "example.com", description: "x y z", category: "crm", funding: "byok" } });
  assert.equal(result.isError, true);
  assert.equal(requests.length, 0);
});

test("API errors come back as tool errors with the server's message", async () => {
  const { client } = await connect({}, () => Response.json({ error: "No credits left. Buy a pack to run another report." }, { status: 402 }));
  const result = await client.callTool({ name: "recomention_report_start", arguments: { domain: "example.com", description: "x y z", category: "crm", funding: "credits" } });
  assert.equal(result.isError, true);
  assert.match(text(result), /HTTP 402: No credits left/);
});

test("suggested questions are deterministic and never name the product", () => {
  const a = suggestPrompts({ domain: "calendly.com", category: "Meeting scheduling software", description: "Booking links for sales teams", count: 12 });
  const b = suggestPrompts({ domain: "calendly.com", category: "Meeting scheduling software", description: "Booking links for sales teams", count: 12 });
  assert.deepEqual(a, b);
  assert.ok(a.length >= 10);
  assert.ok(a.every((p) => !p.text.includes("calendly")));
  assert.equal(new Set(a.map((p) => p.text)).size, a.length);
  assert.equal(suggestPrompts({ domain: "acme.io", category: "crm" }).length, 10);
  // A domain that is the category word itself leaves nothing safe to ask.
  assert.equal(suggestPrompts({ domain: "crm.io", category: "crm" }).length, 0);
});

test("the default base is the API host; an old www base still reaches the deprecated alias", async () => {
  assert.equal(DEFAULT_BASE_URL, "https://api.recomention.com");
  const cases: [string, string][] = [
    ["https://api.recomention.com", "https://api.recomention.com/v1/rankings"],
    ["https://api.recomention.com/", "https://api.recomention.com/v1/rankings"],
    ["https://api.recomention.com/v1", "https://api.recomention.com/v1/rankings"],
    ["https://www.recomention.com", "https://www.recomention.com/api/v1/rankings"],
    ["https://www.recomention.com/", "https://www.recomention.com/api/v1/rankings"],
    ["https://www.recomention.com/api", "https://www.recomention.com/api/v1/rankings"],
    ["https://www.recomention.com/api/v1", "https://www.recomention.com/api/v1/rankings"],
    ["http://localhost:3001", "http://localhost:3001/api/v1/rankings"],
    ["http://localhost:8790/v1", "http://localhost:8790/v1/rankings"],
    ["http://localhost:8790", "http://localhost:8790/v1/rankings"],
    ["https://recomention-api-preview.ffcabbar.workers.dev", "https://recomention-api-preview.ffcabbar.workers.dev/v1/rankings"],
    ["https://recomention-web-preview.ffcabbar.workers.dev", "https://recomention-web-preview.ffcabbar.workers.dev/api/v1/rankings"],
    ["https://my-branch-recomention-web-preview.ffcabbar.workers.dev", "https://my-branch-recomention-web-preview.ffcabbar.workers.dev/api/v1/rankings"],
    ["https://recomention.com", "https://recomention.com/api/v1/rankings"],
    ["https://api.example.org", "https://api.example.org/v1/rankings"],
    ["https://example.org", "https://example.org/v1/rankings"],
  ];
  for (const [base, expected] of cases) {
    const seen: string[] = [];
    const api = createApi({ baseUrl: base, fetch: (async (url: string | URL) => { seen.push(String(url)); return Response.json({ rankings: [] }); }) as typeof fetch });
    await api.rankings();
    assert.equal(seen[0], expected, base);
    assert.equal(`${apiV1Root(base)}/rankings`, expected);
  }
});

test("a report fits the agent's context: per-question counts by default, one question's answers on request", async () => {
  const answer = (engine: string, mentioned: boolean | null, extra: Record<string, unknown> = {}) => ({
    engine, run: 1, failed: false, noAnswer: null, mentioned, brands: [{ name: "Rival", rank: 1 }], citations: [{ url: "https://example.com/a" }], answer: "word ".repeat(2000), ...extra,
  });
  // Real reports store order from 0.
  const questions = Array.from({ length: 25 }, (_, i) => ({ order: i, text: `Q${i + 1}?`, intent: "best", stage: "discover", answers: [answer("GEMINI", true), answer("CLAUDE", false), answer("OPENAI", null, { failed: true })] }));
  const report = { report: { slug: "abcdefgh1234", simulated: false, overallScore: 68, enginesSkipped: [], questions } };
  const { client } = await connect({}, () => Response.json(report));
  const summary = text(await client.callTool({ name: "recomention_report_get", arguments: { slug: "abcdefgh1234" } }));
  assert.ok(summary.length < 30_000, `report_get returned ${summary.length} chars`);
  assert.match(summary, /"1 of 2 usable answers"/);
  assert.doesNotMatch(summary, /word word/);
  const one = JSON.parse(text(await client.callTool({ name: "recomention_report_get", arguments: { slug: "abcdefgh1234", question: 2 } })));
  assert.equal(one.report.question.question, 2);
  assert.equal(one.report.question.text, "Q2?", "question 2 is the second question");
  assert.equal(one.report.question.answers.length, 3);
});

// Users say "question 2" for the second question, so the tools number from 1. Fixtures store order from 0, as real reports do.
const threeQuestions = { report: { slug: "abcdefgh1234", questions: [0, 1, 2].map((order) => ({ order, text: `Question ${order + 1}`, answers: [] })) } };
const get = async (args: Record<string, unknown>) => {
  const { client } = await connect({}, () => Response.json(threeQuestions));
  return client.callTool({ name: "recomention_report_get", arguments: { slug: "abcdefgh1234", ...args } });
};

test("report_get numbers questions from 1 in its summary, never by the stored 0-based order", async () => {
  const summary = JSON.parse(text(await get({}))).report;
  assert.deepEqual(summary.questions.map((q: { question: number; text: string }) => [q.question, q.text]), [[1, "Question 1"], [2, "Question 2"], [3, "Question 3"]]);
  for (const q of summary.questions) assert.equal("order" in q, false, "the 0-based order is not shown");
  assert.match(summary.answersOmitted, /question set to a question's number \(1 is the first\)/);
});

test("report_get question 1 is the first question and the question count is the last", async () => {
  const first = await get({ question: 1 });
  assert.equal(first.isError, undefined, text(first));
  assert.deepEqual(JSON.parse(text(first)).report.question, { question: 1, text: "Question 1", answers: [] });
  const last = await get({ question: 3 });
  assert.equal(last.isError, undefined, text(last));
  assert.equal(JSON.parse(text(last)).report.question.text, "Question 3");
  assert.equal(JSON.parse(text(last)).report.numbering, undefined);
});

test("report_get still reads the deprecated question 0 as the first question, and says so", async () => {
  const zero = await get({ question: 0 });
  assert.equal(zero.isError, undefined, text(zero));
  const body = JSON.parse(text(zero)).report;
  assert.deepEqual(body.question, JSON.parse(text(await get({ question: 1 }))).report.question, "0 and 1 both name the first question");
  assert.match(body.numbering, /deprecated/);
});

test("report_get for a question the report does not have is a tool error", async () => {
  const missing = await get({ question: 4 });
  assert.equal(missing.isError, true, text(missing));
  assert.match(text(missing), /No question 4; questions are numbered 1 to 3\./);
});

test("report_get's description and schema say the question number is 1-based and 0 is deprecated", async () => {
  const { client } = await connect({}, () => Response.json({}));
  const tool = (await client.listTools()).tools.find((t) => t.name === "recomention_report_get")!;
  assert.match(tool.description!, /1-based/);
  assert.doesNotMatch(tool.description!, /from 0/);
  const schema = (tool.inputSchema.properties as Record<string, { description?: string; minimum?: number }>).question!;
  assert.match(schema.description!, /1-based/);
  assert.match(schema.description!, /0 is deprecated/);
  assert.equal(schema.minimum, 0, "0 stays accepted during the transition");
});
