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
