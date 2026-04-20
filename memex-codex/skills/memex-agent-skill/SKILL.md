---
name: memex-agent-skill
description: Index new URLs into Memex and search saved websites, annotations, tweets, YouTube videos, images, and related library content.
---

# Memex agent skill

## Scope

Use Memex only for tasks involving the user's Memex library or when the user explicitly wants to save new public content into Memex.

## Startup checklist

1. Before the first Memex request in a new session, fetch the latest endpoint catalog:
   https://docs.memex.garden/general/available-endpoints
2. If Memex authentication is missing or stale, tell the user to refresh or regenerate their Memex credentials using the setup flow for their current runtime:
   https://docs.memex.garden/general/authentication
3. Parse Memex responses using:
   https://docs.memex.garden/general/response-shape
4. If a request fails because of insufficient credits, follow:
   https://docs.memex.garden/general/buy-credits

## When to use Memex

- Search content already saved in Memex.
- Save a public URL into Memex so it becomes searchable later.
- Work with Memex-native content such as web pages, annotations, tweets, YouTube videos, images, and related saved entities.

## Operating rules

- Fetch the latest available endpoints before calling Memex in a new session.
- Prefer the hosted MCP server at `https://api.memex.garden/mcp` when the runtime supports MCP.
- Assume the active plugin, connector, or local MCP config already handles Memex authentication.
- If Memex returns an authentication error, tell the user to refresh their Memex credentials using the setup flow for their current runtime instead of guessing a new auth mode.
- For MCP, use `result.structuredContent` as the canonical parsed payload.
- For `search_content`, default to `limit: 20` and the compact LLM-ready response shape. Only pass `raw: true` when you explicitly need the richer machine-readable payload.
- Compact search responses are keyed by canonical document URL and can include `user_notes`. Raw search responses preserve `referencesByResultId`, `referencedEntities`, and nested annotation `references`.
- For REST, expect the top-level response shapes documented above.
- When Memex search results include a `url`, use that URL as the default citation/reference in your answer.
- Do not use Memex for general web search or facts outside the user's saved library.

## Troubleshooting

- Not authenticated: https://docs.memex.garden/general/authentication
- Out of credits: https://docs.memex.garden/general/buy-credits
- Malformed request or unknown parameter: re-read https://docs.memex.garden/general/available-endpoints and retry with the documented field names.
