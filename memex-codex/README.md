# Memex Plugin for Codex

This is the Codex plugin for [Memex.Garden](https://memex.garden), a bookmarking second brain for humans and agents.

You can save, transcribe, summarize and search anything you come across. Websites, notes, web highlights, YouTube, X, TikTok, Instagram, PDFs, Reddit or images. Here is our [Privacy Policy](https://memex.garden/privacy/) and our [docs](https://docs.memex.garden).

## How to install

1. [Download](https://github.com/WorldBrain/memex-codex/raw/main/memex-garden-codex-plugin.zip) the plugin
2. Extract the zip, or clone this repo and use it directly.
3. Start Codex from the extracted directory or repo root.
4. Open Codex's plugin directory.
5. Select the `Memex Plugins` marketplace.
6. Install `memex-codex`.
7. Export credentials before launching Codex, then restart Codex if needed.
8. You're done. You can now use Memex inside Codex.

## Example prompts

1. `Search my Memex library for pages about MCP authentication and summarize the top results.`
2. `Save https://docs.memex.garden/general/authentication into Memex, and tag it with #tutorials`

## Authentication

The default hosted Memex MCP endpoint is:

- `https://api.memex.garden/mcp`

For a local Codex plugin checkout like this repo, you authenticate by exporting environment variables before launching Codex.

Bearer token mode:

```bash
export MEMEX_BEARER_TOKEN="YOUR_OAUTH_ACCESS_TOKEN"
```

The plugin also supports API keys as an optional alternative for local setups and testing:

```bash
export MEMEX_API_KEY="YOUR_MEMEX_API_KEY"
export MEMEX_USER_ID="YOUR_MEMEX_USER_ID"
```

Optional override:

```bash
export MEMEX_API_BASE_URL="https://api.memex.garden"
```

Auth precedence:

- `MEMEX_BEARER_TOKEN` is used first when present
- otherwise the plugin uses `MEMEX_API_KEY`
- `MEMEX_USER_ID` is optional
- `MEMEX_API_BASE_URL` defaults to `https://api.memex.garden`

Canonical auth docs:

- [Authentication](https://docs.memex.garden/general/authentication)

If a client asks for the raw MCP server URL instead of using this local plugin bundle, use the literal hosted URL `https://api.memex.garden/mcp`.

## Reviewer notes

Behavior and disclosures:

- The plugin sends Memex-authenticated requests to the hosted Memex MCP server.
- The plugin does not bundle local model inference or a local MCP wrapper.
- The skill is scoped to Memex library search and Memex URL saves.
- The repo bundles a local Codex marketplace file at `.agents/plugins/marketplace.json` that points to `./memex-codex`.
- The plugin uses the same public Memex docs as other Memex agent integrations:
    - [Available endpoints](https://docs.memex.garden/general/available-endpoints)
    - [Response shape](https://docs.memex.garden/general/response-shape)
    - [Buy credits](https://docs.memex.garden/general/buy-credits)
