import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_BASE_URL, PROVIDER_ENV } from "./api.js";
import { SERVER_VERSION } from "./server.js";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const pkg = read("../package.json");
const serverJson = read("../server.json");

test("package.json, server.json and the MCP handshake carry one version", () => {
  assert.equal(SERVER_VERSION, pkg.version);
  assert.equal(serverJson.version, pkg.version);
  assert.equal(serverJson.packages.length, 1);
  assert.equal(serverJson.packages[0].version, pkg.version);
});

test("the registry entry points at this npm package over stdio", () => {
  assert.equal(serverJson.$schema, "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
  // The registry checks package.json's mcpName against server.json's name before it accepts an npm package.
  assert.equal(pkg.mcpName, serverJson.name);
  assert.match(serverJson.name, /^io\.github\.recomention\//);
  assert.ok(serverJson.description.length <= 100, "the schema caps description at 100 characters");
  const [entry] = serverJson.packages;
  assert.equal(entry.registryType, "npm");
  assert.equal(entry.identifier, pkg.name);
  assert.deepEqual(entry.transport, { type: "stdio" });
  // The hosted server signs in with OAuth, so the remote takes no headers or API key.
  assert.deepEqual(serverJson.remotes, [{ type: "streamable-http", url: "https://mcp.recomention.com/mcp" }]);
});

test("server.json declares exactly the env the server reads, with every key secret and optional", () => {
  const vars = new Map<string, { isRequired: boolean; isSecret: boolean; default?: string }>(serverJson.packages[0].environmentVariables.map((v: { name: string }) => [v.name, v]));
  assert.deepEqual([...vars.keys()].sort(), ["RECOMENTION_API_KEY", "RECOMENTION_BASE_URL", ...Object.values(PROVIDER_ENV)].sort());
  // Public rankings work without a key, so nothing is required.
  for (const [name, v] of vars) assert.equal(v.isRequired, false, name);
  for (const name of ["RECOMENTION_API_KEY", ...Object.values(PROVIDER_ENV)]) assert.equal(vars.get(name)!.isSecret, true, name);
  assert.equal(vars.get("RECOMENTION_BASE_URL")!.isSecret, false);
  assert.equal(vars.get("RECOMENTION_BASE_URL")!.default, DEFAULT_BASE_URL);
});

test("the npm package ships only the built server, the skills and the README", () => {
  assert.equal(pkg.type, "module");
  assert.equal(pkg.bin["recomention-mcp"], "dist/index.js");
  assert.deepEqual(pkg.files.filter((f: string) => !f.startsWith("!")).sort(), ["README.md", "dist", "skills"]);
  assert.equal(pkg.publishConfig.access, "public");
  assert.match(pkg.scripts.prepack, /clean-dist\.mjs && tsc -p tsconfig\.build\.json/);
  // Runtime dependencies come from npm, never from the workspace.
  for (const [name, range] of Object.entries(pkg.dependencies as Record<string, string>)) {
    assert.doesNotMatch(name, /^@recomention\//, name);
    assert.doesNotMatch(range, /^workspace:/, name);
  }
  assert.ok(readFileSync(new URL("./index.ts", import.meta.url), "utf8").startsWith("#!/usr/bin/env node\n"), "the bin needs its shebang");
});
