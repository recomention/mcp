import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError, PROVIDERS, providerKeysFromEnv, type Api } from "./api.js";
import { suggestPrompts } from "./suggest.js";
import { compactReport } from "./report.js";

export const SERVER_NAME = "recomention";
/**
 * package.json's version, read at startup: one number for npm, the MCP handshake and the
 * user agent. `../package.json` is the package root from both src/ and dist/, and npm always
 * ships it. server.json carries the same number for the registry; a test keeps them in step.
 */
export const SERVER_VERSION: string = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function fail(error: unknown): ToolResult {
  const message = error instanceof ApiError ? `${error.status ? `HTTP ${error.status}: ` : ""}${error.message}` : error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], isError: true };
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (error) {
    return fail(error);
  }
}

const slug = z.string().min(1).max(100).describe("The slug from a previous call.");
/** Kept in step with core's application/hosted-mcp.ts; this package ships without core. */
const QUESTION_NUMBER =
  "1-based question number, as the summary shows it: 1 is the first question, n the n-th. " +
  "0 is deprecated and also reads as the first question (older agents counted from 0), so 0 and 1 return the same question.";

/**
 * The recomention tools. Read tools are free. `recomention_report_start` is the
 * only tool that spends anything (an agency credit, or calls on the user's own
 * provider keys), and its description says so, so an agent asks first.
 */
export function createServer(api: Api, env: Record<string, string | undefined> = process.env): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "recomention_rankings_list",
    {
      title: "List AI rankings",
      description: "List recomention's public AI rankings: for each category, which products the AI engines name when asked its buyer questions, month by month. Free.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => run(() => api.rankings()),
  );

  server.registerTool(
    "recomention_rankings_get",
    {
      title: "Get an AI ranking",
      description: "One public AI ranking by slug: every product named, how many answers named it (as n of m), and the verbatim answers. Free.",
      inputSchema: { slug },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ slug }) => run(() => api.ranking(slug)),
  );

  server.registerTool(
    "recomention_suggest_prompts",
    {
      title: "Suggest buyer questions",
      description: "Suggest buyer-intent questions to check for a product, from fixed templates. No model call and no cost. The product's own name never appears in a question. Show them to the user to edit before starting a report.",
      inputSchema: {
        domain: z.string().min(3).describe("The product's domain, e.g. example.com"),
        category: z.string().min(2).describe("What buyers search for, e.g. meeting scheduling"),
        description: z.string().max(300).optional().describe("One line on what the product does"),
        count: z.number().int().min(1).max(12).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => ok({ prompts: suggestPrompts(input) }),
  );

  server.registerTool(
    "recomention_report_start",
    {
      title: "Start a report (spends a credit or your provider keys)",
      description:
        "Start a recomention report: the questions are asked of every engine on the plan several times each, with live web search. " +
        "THIS SPENDS MONEY: funding \"credits\" uses one agency credit from the user's account (plan must be FULL); funding \"byok\" runs on the user's own provider keys from this server's environment (OPENAI_API_KEY, ANTHROPIC_API_KEY, PERPLEXITY_API_KEY, GEMINI_API_KEY, XAI_API_KEY, DATAFORSEO_API_KEY as login:password for Google AI Overview) and needs an active Agent plan on the account. " +
        "Any subset of keys works and engines without a key are reported as skipped, but one of OpenAI, Anthropic or Gemini is required. A refusal names the plan limit it hit. " +
        "Always ask the user before calling it. Reports take several minutes: poll recomention_report_status about once a minute.",
      inputSchema: {
        domain: z.string().min(3),
        description: z.string().min(3).max(300),
        category: z.string().min(2).max(120),
        brand: z.string().max(80).optional().describe("Defaults to the name in the domain"),
        plan: z.enum(["QUICK", "FULL", "DEEP"]).default("FULL"),
        prompts: z.array(z.string().min(8).max(200)).max(40).optional().describe("Questions to ask; the rest are written for you. None may name the product."),
        engines: z.array(z.enum(PROVIDERS)).min(1).optional().describe("A subset of the plan's engines"),
        funding: z.enum(["credits", "byok"]),
        idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/).optional().describe("Reuse to make a retried start land on the same report"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ prompts, funding, ...rest }) =>
      run(async () => {
        const providerKeys = funding === "byok" ? providerKeysFromEnv(env) : undefined;
        if (funding === "byok" && !Object.keys(providerKeys ?? {}).length) {
          throw new Error("funding \"byok\" needs at least one provider key in this MCP server's env (OPENAI_API_KEY, ANTHROPIC_API_KEY, PERPLEXITY_API_KEY, GEMINI_API_KEY, XAI_API_KEY or DATAFORSEO_API_KEY).");
        }
        // The keys go to the API in the request body and nowhere else: never into the tool result.
        const started = await api.start({ ...rest, funding, ...(prompts?.length ? { seedPrompts: prompts } : {}), ...(providerKeys ? { providerKeys } : {}) });
        return { ...started, next: "Poll recomention_report_status with this slug about once a minute." };
      }),
  );

  server.registerTool(
    "recomention_report_status",
    {
      title: "Report status",
      description: "Where a report is: PENDING, RUNNING, COMPLETE or FAILED, with answers stored so far. Free.",
      inputSchema: { slug },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ slug }) => run(() => api.status(slug)),
  );

  server.registerTool(
    "recomention_report_get",
    {
      title: "Get a report",
      description:
        "A report as JSON: the overall score, each engine's runs mentioned of runs total, competitors named instead, cited sources, the fix list and, per question, how many usable answers named the product. " +
        "Answer texts are left out to fit your context: pass question (1-based: 1 is the first question, the number each summary entry shows) to read that question's answers and citations. " +
        "Engines in enginesSkipped did not run; never describe them as not mentioning the product. simulated: true means test data. Free.",
      inputSchema: { slug, question: z.number().int().min(0).max(200).optional().describe(QUESTION_NUMBER) },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ slug, question }) => run(async () => compactReport((await api.report(slug)) as never, question)),
  );

  server.registerTool(
    "recomention_distribution_kit",
    {
      title: "Get the distribution kit",
      description:
        "Markdown files built from a finished report, for planning distribution: product.md, competitors.md, ai-visibility.md, where-to-get-mentioned.md (third-party pages, subreddits and videos the engines cite for a rival and not for this product) and channel-plan.md (channels ranked by those citations, each with a first task). " +
        "Read README.md first. Every count is \"n of m answers\"; nothing in it promises traffic. Show the user every draft before anything is posted. Free.",
      inputSchema: { slug },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ slug }) => run(() => api.kit(slug)),
  );

  server.registerTool(
    "recomention_reports_list",
    {
      title: "List my reports",
      description: "The reports in the account that owns the API key, newest first. Free.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => run(() => api.reports()),
  );

  return server;
}
