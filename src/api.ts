/**
 * A thin client for the recomention JSON API v1. Everything the MCP server
 * does goes through here; it holds no state and no business rules of its own.
 */

export const PROVIDERS = ["OPENAI", "ANTHROPIC", "PERPLEXITY", "GEMINI", "GROK", "AI_OVERVIEW"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Where BYOK keys come from: the MCP server's own environment, never a tool argument. */
export const PROVIDER_ENV: Record<Provider, string> = {
  OPENAI: "OPENAI_API_KEY",
  ANTHROPIC: "ANTHROPIC_API_KEY",
  PERPLEXITY: "PERPLEXITY_API_KEY",
  GEMINI: "GEMINI_API_KEY",
  GROK: "XAI_API_KEY",
  // Google AI Overview through DataForSEO: the API login and password as `login:password`.
  AI_OVERVIEW: "DATAFORSEO_API_KEY",
};

export function providerKeysFromEnv(env: Record<string, string | undefined> = process.env): Partial<Record<Provider, string>> {
  const keys: Partial<Record<Provider, string>> = {};
  for (const p of PROVIDERS) {
    const value = env[PROVIDER_ENV[p]]?.trim();
    if (value) keys[p] = value;
  }
  return keys;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export type StartReportBody = {
  domain: string;
  description: string;
  category: string;
  brand?: string;
  plan?: "QUICK" | "FULL" | "DEEP";
  seedPrompts?: string[];
  engines?: Provider[];
  funding: "credits" | "byok";
  providerKeys?: Partial<Record<Provider, string>>;
  idempotencyKey?: string;
};

/** Where the hosted API lives. Paths are /v1/... */
export const DEFAULT_BASE_URL = "https://api.recomention.com";

/**
 * The v1 root under a configured base URL. A copy of packages/core/src/shared/api-base.ts
 * (this package is published and imports no workspace code): keep the two in step.
 *
 *   .../v1, .../api, .../api/v1      -> used as written (.../api gains /v1)
 *   a bare site origin               -> <origin>/api/v1 (the site's deprecated alias: an older config still works)
 *                                       www.recomention.com, recomention.com, a *recomention-web-preview.*.workers.dev
 *                                       host, or localhost/127.0.0.1 on ports 3000-3099 (a local Next dev server)
 *   any other bare origin            -> <origin>/v1 (the API host, its preview Worker, a local API Worker)
 */
export function apiV1Root(base: string): string {
  const url = new URL(base);
  const path = url.pathname.replace(/\/+$/, "");
  const origin = url.origin;
  if (path.endsWith("/v1")) return `${origin}${path}`;
  if (path.endsWith("/api")) return `${origin}${path}/v1`;
  if (path) return `${origin}${path}/v1`;
  return isSiteOrigin(url) ? `${origin}/api/v1` : `${origin}/v1`;
}

function isSiteOrigin(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host === "recomention.com" || host === "www.recomention.com") return true;
  if (/(^|-)recomention-web-preview\.[a-z0-9-]+\.workers\.dev$/.test(host)) return true;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    return port >= 3000 && port <= 3099;
  }
  return false;
}

export type ApiOptions = { baseUrl: string; apiKey?: string; fetch?: typeof fetch; userAgent?: string };

export function createApi(options: ApiOptions) {
  const base = options.baseUrl.replace(/\/+$/, "");
  const root = apiV1Root(base);
  const doFetch = options.fetch ?? fetch;

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown, auth = true): Promise<T> {
    if (auth && !options.apiKey) throw new ApiError(401, "RECOMENTION_API_KEY is not set. Create a key in your recomention account (Developers) and add it to this MCP server's env.");
    const headers: Record<string, string> = { accept: "application/json", "user-agent": options.userAgent ?? "recomention-mcp" };
    if (auth && options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await doFetch(`${root}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      throw new ApiError(0, `Couldn't reach ${base}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) throw new ApiError(res.status, data?.error ?? `HTTP ${res.status}`);
    return data as T;
  }

  return {
    baseUrl: base,
    root,
    rankings: () => call<{ rankings: unknown[] }>("GET", "/rankings", undefined, false),
    ranking: (slug: string) => call<{ ranking: unknown }>("GET", `/rankings/${encodeURIComponent(slug)}`, undefined, false),
    reports: () => call<{ reports: unknown[] }>("GET", "/reports"),
    report: (slug: string) => call<{ report: unknown }>("GET", `/reports/${encodeURIComponent(slug)}`),
    kit: (slug: string) => call<{ kit: unknown }>("GET", `/reports/${encodeURIComponent(slug)}/kit`),
    status: (slug: string) => call<{ status: unknown }>("GET", `/reports/${encodeURIComponent(slug)}/status`),
    start: (body: StartReportBody) => call<{ slug: string; status: string; url: string; statusUrl: string; reused: boolean; funding: string }>("POST", "/reports", body),
  };
}

export type Api = ReturnType<typeof createApi>;
