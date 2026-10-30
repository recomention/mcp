# @recomention/mcp

An MCP server for [recomention](https://www.recomention.com): ask Claude Code, Cursor or Codex
*"is my product recommended by ChatGPT for meeting scheduling?"* and have it start a report, wait
for it, and read the result — every engine's "named in n of m answers", who is recommended instead,
the sources the engines read, and the fix list.

It is a thin stdio client for the public JSON API v1 at `https://api.recomention.com/v1`. It holds no state.
It runs locally, as a process your MCP client starts. For ChatGPT, Claude.ai and other clients that
connect to a remote server, use the hosted connector at `https://mcp.recomention.com/mcp` instead: it
signs in with your recomention account (OAuth), no API key needed. Setup for each client:
<https://docs.recomention.com/mcp/>.

Requires Node.js 20 or newer (`npx` comes with it).

## Environment

| Variable | | |
| --- | --- | --- |
| `RECOMENTION_API_KEY` | required for reports | Create one at `/account` → Developers. Shown once. Without it, public rankings and suggested questions still work. |
| `RECOMENTION_BASE_URL` | optional | Defaults to `https://api.recomention.com`. An older `https://www.recomention.com` (or the apex, a web preview, or a local Next dev server on port 3000–3099) still works: it reaches the site's deprecated `/api/v1` alias. Any other bare origin, such as the API preview Worker or a local API Worker (`http://localhost:8790`), uses `/v1`. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `DATAFORSEO_API_KEY` (Google AI Overview, `login:password`) | optional | Only for `funding: "byok"` (Bring Your Own Key), which needs an active Agent plan on the account. Any subset works and engines without a key are reported as skipped, but one of OpenAI, Anthropic or Gemini is required. Read from this server's environment, never from a tool argument, so your keys never pass through the model's context. |

## Install

### Claude Code

```bash
claude mcp add recomention \
  --env RECOMENTION_API_KEY=YOUR_API_KEY \
  --env RECOMENTION_BASE_URL=https://api.recomention.com \
  -- npx -y @recomention/mcp
```

Replace `YOUR_API_KEY` with your key. Add `--scope user` to use it in every project. Check it with `claude mcp list`, or `/mcp` inside a session.

### Cursor (`~/.cursor/mcp.json`, or `.cursor/mcp.json` in a project) and other JSON-configured clients

```json
{
  "mcpServers": {
    "recomention": {
      "command": "npx",
      "args": ["-y", "@recomention/mcp"],
      "env": { "RECOMENTION_API_KEY": "<key>", "RECOMENTION_BASE_URL": "https://api.recomention.com" }
    }
  }
}
```

Keep a project-level `.cursor/mcp.json` that holds a key out of version control.

### Codex

```bash
codex mcp add recomention \
  --env RECOMENTION_API_KEY=YOUR_API_KEY \
  --env RECOMENTION_BASE_URL=https://api.recomention.com \
  -- npx -y @recomention/mcp
```

or in `~/.codex/config.toml`:

```toml
[mcp_servers.recomention]
command = "npx"
args = ["-y", "@recomention/mcp"]
env = { RECOMENTION_API_KEY = "<key>", RECOMENTION_BASE_URL = "https://api.recomention.com" }
```

## Tools

| Tool | Cost | |
| --- | --- | --- |
| `recomention_rankings_list` | free | Public AI rankings. No key needed. |
| `recomention_rankings_get(slug)` | free | One ranking with every answer it counted. |
| `recomention_suggest_prompts({domain, category, description})` | free | Buyer questions from fixed templates. No model call. Never names the product. |
| `recomention_report_start({domain, description, category, plan, prompts?, engines?, funding})` | **spends** | `funding: "credits"` uses one agency credit (plan `FULL`); `funding: "byok"` runs on your provider keys and needs an active Agent plan; a refusal names the plan limit it hit. |
| `recomention_report_status(slug)` | free | PENDING / RUNNING / COMPLETE / FAILED, with progress. |
| `recomention_report_get(slug)` | free | The full report JSON. |
| `recomention_distribution_kit(slug)` | free | Markdown files built from a finished report: product, competitors, AI visibility, where to get mentioned, channel plan. |
| `recomention_reports_list` | free | Your reports, newest first. |

Reading results honestly: an engine in `enginesSkipped` did not run (for example *"provider rejected
the key"*) — it is never an engine that left the product out. A report with `simulated: true` is test
data.

## Setup prompt

The account page's **Copy setup prompt** button copies this (with the site's own URL). Paste it into
your agent:

```text
Set up the recomention MCP server so you can check whether AI engines (ChatGPT, Claude, Perplexity, Gemini, Grok) recommend a product.

1. Add this MCP server to your MCP configuration (Claude Code: `claude mcp add`; Cursor: ~/.cursor/mcp.json; Codex: ~/.codex/config.toml):
   command: npx -y @recomention/mcp
   env: RECOMENTION_API_KEY=<ask me for my API key; never write it into a repository>
        RECOMENTION_BASE_URL=https://api.recomention.com
   Claude Code one-liner: claude mcp add recomention --env RECOMENTION_API_KEY=<key> --env RECOMENTION_BASE_URL=https://api.recomention.com -- npx -y @recomention/mcp
2. Restart or reload MCP servers, then call recomention_rankings_list to confirm it works.

How to use it:
- To check a product, first call recomention_suggest_prompts with its domain, category and a one-line description, show me the questions, and let me edit them.
- Starting a report spends money: an agency credit, or calls on my own provider keys (that needs my Agent plan). Always ask me before calling recomention_report_start, and say which funding it will use.
- On my own keys, any subset works, but one of OpenAI, Anthropic or Gemini is required. If the start is refused with a `limit` (plan, projects, reportsPerMonth, perDay, concurrent), tell me which limit and do not retry around it.
- Reports take several minutes. Poll recomention_report_status about once a minute; do not start a second report for the same product while one is running.
- When it is COMPLETE, call recomention_report_get and summarise: the overall score, each engine's "named in n of m answers", who is recommended instead, and the top three fixes. Quote counts as "n of m", never as yes/no.
- An engine listed under enginesSkipped did not run (for example "provider rejected the key"). Say so; never describe it as an engine that did not mention the product.
- A report with simulated: true is a test run with made-up answers. Say that plainly and do not draw conclusions from it.

Docs: https://www.recomention.com/developers
```

The canonical text lives in `packages/core/src/config/developers.ts` (`setupPrompt`); keep this copy
in step with it.

## Skills

`skills/` holds agent skills in the slash-command style: copy a folder into `.claude/skills/` (Claude
Code) or your agent's equivalent.

- `ai-visibility-check` — check one product end to end.
- `fix-list-review` — turn a finished report into a prioritised, honest plan of work.
- `competitor-watch` — compare who the engines name in a category, from public rankings and your reports.
- `distribution-kit` — read a finished report's kit and work through its channel plan, one channel at a time.

## Develop

```bash
npm install
npm test            # in-memory client against the server, fake API; metadata/version checks
npm run smoke       # spawns the stdio server against RECOMENTION_BASE_URL
npm run build       # clean dist/ (bin: recomention-mcp)
npm run smoke:pack  # packs the tarball (with pnpm), checks its contents, runs it against a fake local API
```

In the monorepo, run them as `pnpm --filter @recomention/mcp <script>`.

Run `smoke --start` only against a local server with `RECOMENTION_MOCK=1`: against a live
deployment it spends a credit.

`prepack` empties and rebuilds `dist/`, so a pack or publish always ships the current sources and
no test files. `version` lives in `package.json`; the server reads it at startup, and `server.json`
(the MCP Registry entry, `io.github.recomention/mcp`) must carry the same number — a test fails
otherwise.

This repository is published from the recomention monorepo, where development happens. Bugs and
questions: [issues](https://github.com/recomention/mcp/issues) or support@recomention.com.

## Licence

[MIT](./LICENSE).
