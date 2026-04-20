# Memex Codex plugin

This bundle is for OpenAI Codex. It connects Codex to the hosted Memex MCP server and bundles the same `memex-agent-skill` shown in the Memex docs.

## Public standalone repo

The public standalone repo for this plugin is:

- `https://github.com/WorldBrain/memex-codex`

## What it includes

- Hosted MCP server connection to `https://api.memex.garden/mcp`
- Memex tools:
    - `search_content`
    - `save_content_by_url`
- The bundled `memex-agent-skill`
- A repo-local Codex marketplace file at `.agents/plugins/marketplace.json`

## Install from a local repo marketplace

Codex can load this plugin from a repo-local marketplace:

1. Open Codex in the repository root.
2. Restart Codex if it was already open before the plugin was added.
3. Open the Plugins directory in the Codex app or run `/plugins` in Codex CLI.
4. Choose the `Memex Plugins` marketplace.
5. Install `memex-codex`.

The repo-local marketplace file points at `./memex-codex`, so Codex installs the plugin from this checkout instead of requiring the official Plugin Directory.

## Required credentials

See the canonical auth guide:

- `https://docs.memex.garden/general/authentication`

Choose one auth mode before launching Codex.

API key mode:

```bash
export MEMEX_API_KEY="YOUR_MEMEX_API_KEY"
export MEMEX_USER_ID="YOUR_MEMEX_USER_ID" # optional
```

Bearer token mode:

```bash
export MEMEX_BEARER_TOKEN="YOUR_OAUTH_ACCESS_TOKEN"
```

Optional override:

```bash
export MEMEX_API_BASE_URL="https://api.memex.garden"
```

`MEMEX_BEARER_TOKEN` takes precedence over `MEMEX_API_KEY` if both are set.
`MEMEX_USER_ID` is optional. Memex can resolve the user from `MEMEX_API_KEY` when needed.
`MEMEX_API_BASE_URL` defaults to `https://api.memex.garden`.

## Notes

- The plugin's `.mcp.json` sends `Authorization: Bearer ...` when `MEMEX_BEARER_TOKEN` is set.
- Otherwise, the plugin uses `x-api-key` and optional `x-user-id` headers for the hosted MCP server.
- `search_content` defaults to the compact search shape. Pass `raw: true` only when you need the richer machine-readable payload.
- Compact search responses return a `results` array with stable top-level fields plus optional `user_notes` and slim `media`. Raw responses preserve `referencesByResultId`, `referencedEntities`, and nested annotation `references`.
- Raw MCP responses return the Memex payload in `result.structuredContent`.
- Codex plugins currently package skills, MCP config, and optional apps. This bundle does not ship a separate Codex hook layer.

## Related docs

- Codex plugin guide: `https://docs.memex.garden/for-agents/codex-plugin`
- Protocol and request shape: `https://docs.memex.garden/for-agents/mcp`
- Portable skill: `https://docs.memex.garden/for-agents/skill-md`
- Auth setup for OAuth and API keys: `https://docs.memex.garden/general/authentication`
- Operation catalog: `https://docs.memex.garden/general/available-endpoints`
