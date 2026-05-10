# Memex Plugin for Codex

This is the Codex plugin for [Memex.Garden](https://memex.garden), a bookmarking second brain for humans and agents.

You can save, transcribe, summarize and search anything you come across. Websites, notes, web highlights, YouTube, X, TikTok, Instagram, PDFs, Reddit or images. Here is our [Privacy Policy](https://memex.garden/privacy/) and our [docs](https://docs.memex.garden).

## How to install

1. [Download](https://github.com/WorldBrain/memex-codex/raw/main/memex-codex.zip) the plugin
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

For local Codex plugin use, export credentials before launching Codex.

Bearer token mode:

```bash
export MEMEX_BEARER_TOKEN="YOUR_OAUTH_ACCESS_TOKEN"
```

You can also use an API key:

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

Auth docs:

- [Authentication](https://docs.memex.garden/general/authentication)

If a client asks for the raw MCP server URL, use `https://api.memex.garden/mcp`.

## Docs

- [Available endpoints](https://docs.memex.garden/general/available-endpoints)
- [Response shape](https://docs.memex.garden/general/response-shape)
- [Buy credits](https://docs.memex.garden/general/buy-credits)
