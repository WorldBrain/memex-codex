# Memex Plugin

This is the Memex plugin for [Memex.Garden](https://memex.garden), a bookmarking second brain for humans and agents.

You can save, transcribe, summarize and search anything you come across. Websites, notes, web highlights, YouTube, X, TikTok, Instagram, PDFs, Reddit or images. Here is our [Privacy Policy](https://memex.garden/privacy/) and our [docs](https://docs.memex.garden).

## How to install

1. [Download](https://github.com/WorldBrain/memex-codex/raw/main/memex-codex.zip) the plugin
2. Extract the zip, or clone this repo and use it directly.
3. Start Codex from the extracted directory or repo root.
4. Open Codex's plugin directory.
5. Select the `Memex Plugins` marketplace.
6. Install `Memex`.
7. Connect Memex when your client prompts for authentication.
8. Return to Memex and select Codex in Integrations. The first authenticated Memex operation automatically pairs the bundled Realtime MCP.
9. You're done. You can now use Memex from your agent.

## Example prompts

1. `Search my Memex library for pages about MCP authentication and summarize the top results.`
2. `Save https://docs.memex.garden/general/authentication into Memex, and tag it with #tutorials`

## Handoff command

The plugin exposes a dedicated slash command for unprocessed handoffs:

```text
/memex:fetch-handoffs
```

That command discovers the cloud-side handoff-listing action and invokes it
through `execute_action`. It fetches pending handoffs by default, routes only
handoffs whose canonical `executionAgentId` is `codex`, resolves the saved Codex
project for each of those handoffs, and creates one fresh task per handoff.
Handoffs assigned to other execution agents are skipped and left undrained.
When present, `targetAppId` is included in the Codex task as downstream app
context. A handoff with `taskMode: "planning"` becomes an explicit planning-only
task; `taskMode: "implementation"` becomes a normal implementation task.
The routing command never performs or drains the handoff itself. Each created
task owns only its handoff and drains it after the assigned work is complete.
After Codex creates the task, the coordinator registers the returned thread ID
with Memex. This gives the handoff a deterministic `codex://threads/<thread-id>`
link without marking the handoff processed.

## Realtime handoffs

In Memex, select Codex in Integrations and complete the OAuth pairing. On the
first authenticated Memex operation, Codex automatically exchanges a
short-lived, single-use ticket with the plugin-local MCP; no separate Realtime
login or enable command is required. `/memex:enable-realtime-handoffs` remains
available for explicit repair. Each new
approved voice memo starts exactly one coordinator task in the matching
configured project and includes the complete source transcript in that task.
The coordinator returns one structured child-task specification for every
explicitly delimited handoff in the memo, and the bridge starts those child
Codex tasks without creating additional Memex handoff rows. Project routing
first uses the handoff's requested destination and can infer a unique explicit
project mention from the source when that field is absent. If no unique route
matches, the handoff stays pending. Handoff-created tasks suppress nested
realtime auto-connections, and the durable queue atomically permits only one
receiver to claim each handoff. When multiple plugin processes exist locally,
the newest process becomes the active receiver and older processes remain on
standby.
`/memex:fetch-handoffs` remains the manual fallback.

## Authentication

The default hosted Memex MCP endpoint is:

- `https://memex.garden/api/mcp`

Authentication is OAuth-first. When the plugin calls Memex for the first time,
your client should start the Memex sign-in flow. OAuth clients should register
as `Memex Codex plugin` and, when custom registration metadata is supported,
include `memex_client_source: "memex_codex_plugin"` so Memex can show the
connection as this plugin rather than a generic Codex cloud agent. In Codex
CLI, use:

```bash
codex mcp login memex
```

After signing in, start a new thread so the refreshed MCP session and plugin
skills are available.

Advanced fallback: if OAuth is unavailable in your client, export credentials
before launching the agent.

Bearer token mode:

```bash
export MEMEX_BEARER_TOKEN="YOUR_OAUTH_ACCESS_TOKEN"
```

You can also use an API key:

```bash
export MEMEX_API_KEY="YOUR_MEMEX_API_KEY"
export MEMEX_USER_ID="YOUR_MEMEX_USER_ID"
```

Endpoint override:

```bash
export MEMEX_MCP_URL="https://memex.garden/api/mcp"
```

Local backend example:

```bash
npm run dev:mcp-proxy
export MEMEX_MCP_URL="http://localhost:8787/mcp"
```

Auth precedence:

- OAuth is the default path when supported by the client
- `MEMEX_BEARER_TOKEN` is the first fallback when present
- otherwise the MCP server may use `MEMEX_API_KEY`
- `MEMEX_USER_ID` is optional
- `MEMEX_MCP_URL` defaults to `https://memex.garden/api/mcp`

Auth docs:

- [Authentication](https://docs.memex.garden/general/authentication)

If a client asks for the raw MCP server URL, use
`https://memex.garden/api/mcp` for production or `http://localhost:8787/mcp`
for local development.

## Docs

- Handoff command: `/memex:fetch-handoffs`
- [Available endpoints](https://docs.memex.garden/general/available-endpoints)
- [Response shape](https://docs.memex.garden/general/response-shape)
- [Buy credits](https://docs.memex.garden/general/buy-credits)
