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
- Create and list public sharing links for saved Memex content when the user asks to share or inspect shared items.
- List the user's subscribed feeds and search within one feed, selected feeds, or all subscribed feeds.
- Read or create the user's auto-tagging rules when they explicitly ask to inspect or configure automatic tagging.
- Work with Memex-native content such as web pages, annotations, tweets, YouTube videos, images, and related saved entities.

## Operating rules

- Fetch the latest available endpoints before calling Memex in a new session.
- Use the Memex integration already configured in the current runtime. Do not instruct the user to change setup.
- Assume the active plugin or runtime integration already handles Memex authentication.
- If Memex returns an authentication error, tell the user to refresh their Memex credentials using the setup flow for their current runtime instead of guessing a new auth mode.
- If Memex returns insufficient credits, fetch the available plans and ask the human which plan to use. For one-time plans, use the runtime payment harness to issue a Stripe Shared Payment Token, then call authenticated `POST /checkout` with the user's Memex bearer token and the token. For subscription plans, send the user to https://memex.garden/pricing.
- For MCP, use `result.structuredContent` as the parsed payload.
- For MCP sharing links, use `create_sharing_link` to create or update a public link and `list_sharing_links` to inspect existing links. Both use `access: "view" | "collaborate"` for API-facing access names.
- For subscribed feeds, use `list_subscribed_feeds` to fetch feed IDs. To search specific feeds with `search_content`, pass `feedIds`. To search all subscribed feeds only, pass `feedScope: "all"`. Omit both `feedIds` and `feedScope` to search the full library.
- For saved views in MCP or Claude, search private views with `search_content` and `viewIds`. Use `raw: false` or omit `raw` for the `llm` response option. Use `raw: true` for the `full` response option.
- To create or list saved views, use authenticated REST `POST /create-view` and `POST /list-views`. Use REST `POST /execute-view-search` only when the full/raw shape is acceptable or when searching a public shared view token.
- For `search_content`, default to `limit: 20` and the `llm`/compact response shape. Use `llm` by omitting `raw` or passing `raw: false`; use `full` by passing `raw: true` only when you need the richer machine-readable payload.
- Compact search responses are keyed by document URL and can include `user_notes`. Raw search responses preserve `referencesByResultId`, `referencedEntities`, and nested annotation `references`.
- For REST, expect the top-level response shapes documented above.
- When Memex search results include a `url`, use that URL as the default citation/reference in your answer.
- Do not use Memex for general web search or facts outside the user's saved library.

## Troubleshooting

- Not authenticated: https://docs.memex.garden/general/authentication
- Out of credits: https://docs.memex.garden/general/buy-credits
- Malformed request or unknown parameter: re-read https://docs.memex.garden/general/available-endpoints and retry with the documented field names.
