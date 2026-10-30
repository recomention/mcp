/**
 * Spawns the stdio server the way an MCP client does and calls its tools.
 *
 *   RECOMENTION_BASE_URL=http://localhost:3010 RECOMENTION_API_KEY=rmk_… pnpm --filter @recomention/mcp smoke [--start]
 *
 * Read-only unless --start is passed. Point it only at a local server running
 * with RECOMENTION_MOCK=1: a start against a live deployment spends a credit.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = fileURLToPath(new URL("..", import.meta.url));
const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
for (const name of ["RECOMENTION_BASE_URL", "RECOMENTION_API_KEY"]) if (process.env[name]) env[name] = process.env[name]!;
// Keeps a key out of shell history and process listings.
if (process.env.RECOMENTION_API_KEY_FILE) env.RECOMENTION_API_KEY = readFileSync(process.env.RECOMENTION_API_KEY_FILE, "utf8").trim();

const transport = new StdioClientTransport({ command: "pnpm", args: ["exec", "tsx", "src/index.ts"], cwd: here, env, stderr: "inherit" });
const client = new Client({ name: "recomention-smoke", version: "0" });
await client.connect(transport);

const show = (label: string, result: unknown) => {
  const r = result as { isError?: boolean; content: { text: string }[] };
  console.log(`\n▸ ${label}${r.isError ? "  (tool error)" : ""}\n${r.content[0]?.text.slice(0, 1200)}`);
};

console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
show("recomention_rankings_list", await client.callTool({ name: "recomention_rankings_list", arguments: {} }));
show("recomention_suggest_prompts", await client.callTool({ name: "recomention_suggest_prompts", arguments: { domain: "cal.com", category: "meeting scheduling", description: "open source scheduling", count: 3 } }));
show("recomention_reports_list", await client.callTool({ name: "recomention_reports_list", arguments: {} }));

if (process.argv.includes("--start")) {
  const started = await client.callTool({
    name: "recomention_report_start",
    arguments: { domain: "cal.com", category: "meeting scheduling", description: "Open source scheduling infrastructure", plan: "FULL", funding: "credits", idempotencyKey: "smoke-test-0000000001" },
  });
  show("recomention_report_start", started);
  const slug = (JSON.parse((started as { content: { text: string }[] }).content[0].text) as { slug?: string }).slug;
  if (slug) {
    for (let i = 0; i < 60; i++) {
      const status = await client.callTool({ name: "recomention_report_status", arguments: { slug } });
      const s = JSON.parse((status as { content: { text: string }[] }).content[0].text).status;
      console.log(`  status ${s.status} ${s.progress ? `${s.progress.answersStored}/${s.progress.answersPlanned}` : ""}`);
      if (s.status === "COMPLETE" || s.status === "FAILED") break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    show("recomention_report_get", await client.callTool({ name: "recomention_report_get", arguments: { slug } }));
  }
}

await client.close();
