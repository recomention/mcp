#!/usr/bin/env node
/**
 * recomention MCP server over stdio.
 *
 *   RECOMENTION_API_KEY    an API key from your account (Developers). Needed for reports.
 *   RECOMENTION_BASE_URL   defaults to https://api.recomention.com (an older https://www.recomention.com still works)
 *
 * stdout carries the protocol, so anything human goes to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApi, DEFAULT_BASE_URL } from "./api.js";
import { createServer, SERVER_VERSION } from "./server.js";

const baseUrl = process.env.RECOMENTION_BASE_URL?.trim() || DEFAULT_BASE_URL;
// The API key travels as a bearer token: refuse plain http anywhere but this machine.
{
  let parsed: URL | null = null;
  try { parsed = new URL(baseUrl); } catch { /* reported below */ }
  const local = parsed !== null && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (!parsed || (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:"))) {
    console.error(`RECOMENTION_BASE_URL must be an https:// URL (http:// only for localhost). Got: ${baseUrl}`);
    process.exit(1);
  }
}
const api = createApi({ baseUrl, apiKey: process.env.RECOMENTION_API_KEY?.trim() || undefined, userAgent: `recomention-mcp/${SERVER_VERSION}` });
const server = createServer(api);

await server.connect(new StdioServerTransport());
console.error(`recomention MCP server ${SERVER_VERSION} on stdio → ${api.root}${process.env.RECOMENTION_API_KEY ? "" : " (no RECOMENTION_API_KEY: rankings only)"}`);
