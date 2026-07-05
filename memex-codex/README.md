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
8. You're done. You can now use Memex from your agent.

## Example prompts

1. `Search my Memex library for pages about MCP authentication and summarize the top results.`
2. `Save https://docs.memex.garden/general/authentication into Memex, and tag it with #tutorials`

## Handoff command

The plugin exposes a dedicated slash command for unprocessed handoffs:

```text
/memex:fetch-handoffs
```

That command uses the Memex MCP tool `list_handoffs`, backed by
`POST /list-handoffs`. It fetches pending handoffs by default and
does not drain them unless the Codex agent actually completes the handoff.

## Authentication

The default hosted Memex MCP endpoint is:

- `https://api.memex.garden/mcp`

Authentication is OAuth-first. When the plugin calls Memex for the first time,
your client should start the Memex sign-in flow. In Codex CLI, use:

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
export MEMEX_MCP_URL="https://api.memex.garden/mcp"
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
- `MEMEX_MCP_URL` defaults to `https://api.memex.garden/mcp`

Auth docs:

- [Authentication](https://docs.memex.garden/general/authentication)

If a client asks for the raw MCP server URL, use
`https://api.memex.garden/mcp` for production or `http://localhost:8787/mcp`
for local development.

## Docs

- Handoff command: `/memex:fetch-handoffs`
- [Available endpoints](https://docs.memex.garden/general/available-endpoints)
- [Response shape](https://docs.memex.garden/general/response-shape)
- [Buy credits](https://docs.memex.garden/general/buy-credits)
