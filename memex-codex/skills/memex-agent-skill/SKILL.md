---
name: memex-agent-skill
description: Index new URLs into Memex and search saved websites, annotations, tweets, YouTube videos, images, and related library content.
---

# Memex agent skill

## Scope

Use Memex only for tasks involving the user's Memex library or when the user explicitly wants to save new public content into Memex.

Do not use Memex for general web search or facts outside the user's saved library.

## Start Every Memex Run

1. Before the first Memex request in a new session, fetch the latest endpoint catalog:
   https://docs.memex.garden/general/available-endpoints
2. Use the Memex integration already configured in the current runtime.
3. If authentication is missing or stale, tell the user to refresh or regenerate credentials using:
   https://docs.memex.garden/general/authentication
4. Parse responses using:
   https://docs.memex.garden/general/response-shape
5. If a request fails because of insufficient credits, follow:
   https://docs.memex.garden/general/buy-credits

## Choose The Runbook

- Search content already saved in Memex.
- Save a public URL into Memex so it becomes searchable later.
- Create and list public sharing links for saved Memex content when the user asks to share or inspect shared items.
- List the user's subscribed feeds and search within one feed, selected feeds, or all subscribed feeds.
- Read or create the user's auto-tagging rules when they explicitly ask to inspect or configure automatic tagging.
- Work with Memex-native content such as web pages, annotations, tweets, YouTube videos, images, and related saved entities.

## Search Saved Content

1. Call `search_content` with the user's query.
2. Default to `limit: 20`.
3. Request the compact `llm` response shape by omitting `raw` or setting `raw: false`.
4. Use `raw: true` only when the task needs richer machine-readable references.
5. For MCP results, read `result.structuredContent`.
6. Cite result URLs when a `url` is present.

## Save Public Content

1. Confirm the user provided a public URL or explicitly asked to save public content.
2. Use the documented save/index endpoint or MCP tool from the latest endpoint catalog.
3. Include only user-requested tags, metadata, or notes.
4. Report the saved item URL or returned Memex identifier.
5. Do not claim the item is searchable until Memex reports successful indexing or processing.

## Create Or Inspect Sharing Links

1. Use `list_sharing_links` when the user asks what is already shared.
2. Use `create_sharing_link` when the user asks to share saved content.
3. Set API access as `access: "view"` or `access: "collaborate"`.
4. Return the public link and access level.

## Search Feeds

1. Call `list_subscribed_feeds` to fetch feed IDs.
2. To search selected feeds, call `search_content` with `feedIds`.
3. To search all subscribed feeds only, call `search_content` with `feedScope: "all"`.
4. To search the full library, omit both `feedIds` and `feedScope`.

## Search Or Manage Saved Views

1. To search private saved views in MCP or Claude, call `search_content` with `viewIds`.
2. Use `raw: false` or omit `raw` for normal answer-writing.
3. Use authenticated REST `POST /create-view` to create views.
4. Use authenticated REST `POST /list-views` to list views.
5. Use REST `POST /execute-view-search` only when full/raw output is acceptable or when searching a public shared view token.

## Handle Failures

1. Authentication error: tell the user to refresh credentials with https://docs.memex.garden/general/authentication.
2. Insufficient credits:
   - Fetch available plans.
   - Ask the human which plan to use.
   - For one-time plans, use the runtime payment harness to issue a Stripe Shared Payment Token, then call authenticated `POST /checkout` with the user's Memex bearer token and token.
   - For subscription plans, send the user to https://memex.garden/pricing.
3. Malformed request or unknown parameter: re-read https://docs.memex.garden/general/available-endpoints and retry with documented field names.

## Troubleshooting

- Not authenticated: https://docs.memex.garden/general/authentication
- Out of credits: https://docs.memex.garden/general/buy-credits
- Malformed request or unknown parameter: re-read https://docs.memex.garden/general/available-endpoints and retry with the documented field names.
