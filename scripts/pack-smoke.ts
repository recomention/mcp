/**
 * Packs @recomention/mcp the way it would be published and runs the tarball on its own.
 *
 *   pnpm --filter @recomention/mcp smoke:pack [--keep]
 *
 * `pnpm pack` runs prepack (clean dist/, build), so this checks what npm would receive: only
 * dist/, skills/ and the README; no sources, tests or secrets; no import of a workspace package.
 * The extracted package gets its declared dependencies and nothing else, then the bin is spawned
 * over stdio against a fake API on 127.0.0.1. Nothing leaves this machine and nothing is published.
 */
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = fileURLToPath(new URL("..", import.meta.url));
const source = JSON.parse(readFileSync(join(here, "package.json"), "utf8")) as { name: string; version: string };
const work = mkdtempSync(join(tmpdir(), "recomention-mcp-pack-"));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

try {
  // 1. Pack, then extract.
  execFileSync("pnpm", ["pack", "--pack-destination", work], { cwd: here, stdio: ["ignore", "ignore", "inherit"] });
  const tarballs = readdirSync(work).filter((f) => f.endsWith(".tgz"));
  assert.equal(tarballs.length, 1, `expected one tarball in ${work}`);
  const extracted = join(work, "extracted");
  mkdirSync(extracted);
  execFileSync("tar", ["-xzf", join(work, tarballs[0]), "-C", extracted]);
  const root = join(extracted, "package");
  const files = walk(root).map((f) => relative(root, f).split("\\").join("/")).sort();
  console.log(`packed ${tarballs[0]}: ${files.length} files\n  ${files.join("\n  ")}`);

  // 2. Contents: the built server, the skills, the README, LICENSE and package.json. Nothing else.
  for (const f of files) assert.match(f, /^(package\.json|README\.md|LICENSE|dist\/[a-z-]+\.js|skills\/[a-z-]+\/SKILL\.md)$/, `unexpected file in the tarball: ${f}`);
  for (const f of ["dist/index.js", "dist/server.js", "dist/api.js", "dist/suggest.js", "README.md", "LICENSE"]) assert.ok(files.includes(f), `missing ${f}`);
  assert.ok(readFileSync(join(root, "dist/index.js"), "utf8").startsWith("#!/usr/bin/env node\n"), "dist/index.js lost its shebang");

  const packed = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string; mcpName: string; dependencies: Record<string, string>; bin: Record<string, string> };
  assert.equal(packed.name, source.name);
  assert.equal(packed.version, source.version);
  assert.equal(packed.mcpName, "io.github.recomention/mcp");
  assert.doesNotMatch(readFileSync(join(root, "package.json"), "utf8"), /workspace:/, "a workspace: range survived packing");

  // 3. Every import in dist/ is a Node builtin, a declared dependency, or a file inside dist/.
  const deps = Object.keys(packed.dependencies);
  const builtins = new Set(builtinModules);
  for (const f of files.filter((f) => f.endsWith(".js"))) {
    const code = readFileSync(join(root, f), "utf8");
    assert.doesNotMatch(code, /\b(sk-[A-Za-z0-9_-]{20,}|rmk_[A-Za-z0-9]{16,})/, `${f} contains something that looks like a key`);
    for (const [, spec] of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)) {
      if (spec.startsWith(".")) {
        const target = resolve(dirname(join(root, f)), spec);
        assert.ok(target.startsWith(join(root, "dist")) && files.includes(relative(root, target)), `${f} imports ${spec}, which is not in dist/`);
      } else if (spec.startsWith("node:") || builtins.has(spec)) {
        continue;
      } else {
        assert.ok(deps.some((d) => spec === d || spec.startsWith(`${d}/`)), `${f} imports ${spec}, which is not a declared dependency`);
      }
    }
  }

  // 4. Give the extracted package its declared dependencies only (from this workspace's install).
  for (const dep of deps) {
    const link = join(root, "node_modules", dep);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(realpathSync(join(here, "node_modules", dep)), link, "junction");
  }

  // 5. A fake API on loopback.
  const seen: { method: string; url: string; authorization: string | undefined }[] = [];
  const api = createServer((req: IncomingMessage, res) => {
    seen.push({ method: req.method ?? "", url: req.url ?? "", authorization: req.headers.authorization });
    const body = req.url === "/v1/rankings" ? { rankings: [{ slug: "pack-smoke-category" }] } : req.url === "/v1/reports" ? { reports: [] } : { error: "not found" };
    res.writeHead("error" in body ? 404 : 200, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  await new Promise<void>((ok) => api.listen(0, "127.0.0.1", ok));
  const port = (api.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  const bin = join(root, packed.bin["recomention-mcp"]);

  async function connect(env: Record<string, string>) {
    const transport = new StdioClientTransport({ command: process.execPath, args: [bin], cwd: work, env: { PATH: process.env.PATH ?? "", ...env }, stderr: "inherit" });
    const client = new Client({ name: "recomention-pack-smoke", version: "0" });
    await client.connect(transport);
    return client;
  }
  const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]?.text ?? "";

  try {
    // With a key: rankings go out without it, reports with it as a bearer token.
    const client = await connect({ RECOMENTION_BASE_URL: baseUrl, RECOMENTION_API_KEY: "rmk_pack_smoke_fake" });
    assert.deepEqual(client.getServerVersion(), { name: "recomention", version: source.version });
    const tools = (await client.listTools()).tools.map((t) => t.name);
    assert.equal(tools.length, 8, `tools: ${tools.join(", ")}`);
    const rankings = await client.callTool({ name: "recomention_rankings_list", arguments: {} });
    assert.equal(rankings.isError, undefined, text(rankings));
    assert.match(text(rankings), /pack-smoke-category/);
    const reports = await client.callTool({ name: "recomention_reports_list", arguments: {} });
    assert.equal(reports.isError, undefined, text(reports));
    assert.deepEqual(seen, [
      { method: "GET", url: "/v1/rankings", authorization: undefined },
      { method: "GET", url: "/v1/reports", authorization: "Bearer rmk_pack_smoke_fake" },
    ]);
    await client.close();

    // Without a key: rankings still work; a report call fails before any request.
    seen.length = 0;
    const anonymous = await connect({ RECOMENTION_BASE_URL: baseUrl });
    assert.equal((await anonymous.callTool({ name: "recomention_rankings_list", arguments: {} })).isError, undefined);
    const refused = await anonymous.callTool({ name: "recomention_reports_list", arguments: {} });
    assert.equal(refused.isError, true);
    assert.match(text(refused), /RECOMENTION_API_KEY is not set/);
    assert.deepEqual(seen.map((s) => s.url), ["/v1/rankings"]);
    await anonymous.close();
  } finally {
    api.close();
  }

  // A plain-http base that is not loopback is refused at startup, so a key never travels unencrypted.
  const refusedStart = spawnSync(process.execPath, [bin], { cwd: work, env: { PATH: process.env.PATH ?? "", RECOMENTION_BASE_URL: "http://api.example.test" }, input: "", encoding: "utf8", timeout: 10_000 });
  assert.equal(refusedStart.status, 1);
  assert.match(refusedStart.stderr, /must be an https:\/\/ URL/);

  console.log(`\npack smoke OK: ${source.name}@${source.version} runs from its tarball against a local fake API.`);
} finally {
  if (process.argv.includes("--keep")) console.log(`kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}
