# Memex Codex plugin

This bundle is for OpenAI Codex. It connects Codex to the hosted Memex MCP server instead of running a local wrapper.

## Public standalone repo

The public standalone review repo for this plugin is:

- `https://github.com/WorldBrain/memex-codex`

Codex reviewers and users who want the smallest self-contained checkout should use that repo.

## Download the plugin bundle

Hosted download:

- `https://memex.garden/downloads/memex-garden-codex-plugin.zip`

Bundled zip in this repo:

- `./memex-garden-codex-plugin.zip`

The bundled zip contains the repo-local Codex marketplace file and the `memex-codex/` plugin directory, so people can extract it and start Codex from that extracted directory directly.

## Install from the repo marketplace

The repo exposes a Codex marketplace catalog at its root, so you can install it directly from GitHub:

```bash
git clone https://github.com/WorldBrain/memex-codex.git
cd memex-codex
codex
```

Then open the Plugins directory in Codex, choose the `Memex Plugins` marketplace, and install `memex-codex`.

If you are working from a local clone instead of GitHub, you can also test the marketplace locally:

```bash
cd /absolute/path/to/memex-codex
codex
```

Then open the Plugins directory in Codex, choose the `Memex Plugins` marketplace, and install `memex-codex`.

If you are using the downloadable zip, extract it first and start Codex from the extracted directory.

Do not paste the local `.mcp.json` value into a hosted MCP form. Use the literal URL `https://api.memex.garden/mcp`.

## What it includes

- Hosted MCP server connection to `https://api.memex.garden/mcp`
- Memex tools:
    - `search_content`
    - `save_content_by_url`
- The bundled `memex-agent-skill`
- A bundled repo-local marketplace file that exposes the plugin inside Codex

## Search response behavior

The bundled plugin does not change the hosted API contract. `search_content` follows the same behavior documented in the public docs:

- compact search output is the default
- pass `raw: true` only when you explicitly need the richer machine-readable payload
- compact responses return a `results` array with stable top-level fields plus optional `user_notes` and slim `media`
- raw responses preserve `referencesByResultId`, `referencedEntities`, and nested annotation `references`

## Required credentials

See the canonical auth guide:

- `https://docs.memex.garden/general/authentication`

For the local Codex bundle, choose one auth mode before starting Codex.

API key mode:

```bash
export MEMEX_API_KEY="YOUR_MEMEX_API_KEY"
export MEMEX_USER_ID="YOUR_MEMEX_USER_ID" # optional
```

Bearer token mode:

```bash
export MEMEX_BEARER_TOKEN="YOUR_OAUTH_ACCESS_TOKEN"
```

Optional overrides:

```bash
export MEMEX_API_BASE_URL="https://api.memex.garden"
```

`MEMEX_BEARER_TOKEN` takes precedence over `MEMEX_API_KEY` if both are set.
`MEMEX_USER_ID` is optional. Memex can resolve the user from `MEMEX_API_KEY` when needed.
`MEMEX_API_BASE_URL` defaults to `https://api.memex.garden`.

## Run from a local checkout

From the standalone public checkout:

```bash
cd /absolute/path/to/memex-codex
codex
```

Then open Plugins in Codex and confirm that the `Memex Plugins` marketplace is available.

If you extracted the bundled zip instead of cloning the repo:

```bash
cd /absolute/path/to/extracted-memex-codex
codex
```

Then open Plugins in Codex and confirm that the `Memex Plugins` marketplace is available.

## Notes

- The plugin's `.mcp.json` sends `Authorization: Bearer ...` when `MEMEX_BEARER_TOKEN` is set.
- Otherwise, the plugin uses `x-api-key` and optional `x-user-id` headers for the hosted MCP server.
- `search_content` now defaults to the compact search shape. Pass `raw: true` only when you need the richer machine-readable payload.
- Compact search responses return a `results` array with stable top-level fields plus optional `user_notes` and slim `media`. Raw responses preserve `referencesByResultId`, `referencedEntities`, and nested annotation `references`.
- Raw MCP responses return the Memex payload in `result.structuredContent`.
- Codex plugins currently package skills, MCP config, and optional app mappings. This bundle does not add a separate Codex hook layer.
- The repo-local marketplace file points at `./memex-codex`, so Codex installs the packaged bundle from this checkout.
- No separate setup is required once the plugin is installed and enabled.
- Endpoint catalog: `https://docs.memex.garden/general/available-endpoints`
- Response contract: `https://docs.memex.garden/general/response-shape`
- Portable skill: `https://docs.memex.garden/for-agents/skill-md`
