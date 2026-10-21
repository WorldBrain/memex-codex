---
name: memex-agent-skill
description: Search and save Memex library content, follow RSS and YouTube sources, and fetch, process, or drain pending Memex handoffs for manual skill use or agent automation.
---

# Memex agent skill

## Scope

Use Memex only for tasks involving the user's Memex library or when the user explicitly wants to save new public content into Memex.

Do not use Memex for general web search or facts outside the user's saved library.

## Start Every Memex Run

1. Use the `memex` MCP server configured by this plugin. Do not substitute a separately configured legacy Memex connected app that does not expose `discover_actions`.
2. Call `discover_actions` with the user's intended outcome before every Memex operation. Do not fetch endpoint catalogs, search web docs, inspect environment credentials, or probe raw REST first.
3. Select the relevant returned action card, then call `execute_action` with its `id` as `actionId` and an `input` object matching its current `inputSummary`. Treat the action card as the cloud-side source of truth; do not require a named compatibility tool.
4. If authentication is missing or stale, use the current host's MCP or plugin authentication flow. Complete sign-in and start a new conversation or agent session before retrying so the tool catalogue refreshes.
5. In unattended automation or clients that cannot open an authentication flow, stop and tell the user to connect Memex interactively before retrying. Use https://docs.memex.garden/general/authentication only as fallback documentation.
6. Parse responses using https://docs.memex.garden/general/response-shape.
7. If a request fails because of insufficient credits, follow https://docs.memex.garden/general/buy-credits.

## Choose The Runbook

- Search content already saved in Memex.
- Save a public URL into Memex so it becomes searchable later.
- Create and list public sharing links for saved Memex content when the user asks to share or inspect shared items.
- List the user's subscribed feeds and search within one feed, selected feeds, or all subscribed feeds.
- Follow an RSS feed, YouTube channel, or YouTube playlist, optionally importing its complete history.
- Fetch pending or time-filtered handoffs when the user asks what needs to be processed, handed off, shared, routed, or handled by an agent.
- Read or create the user's auto-tagging rules when they explicitly ask to inspect or configure automatic tagging.
- Work with Memex-native content such as web pages, annotations, tweets, YouTube videos, images, and related saved entities.

## Manual And Automation Use

- Manual invocation: this skill must work when selected from an agent host's skill or slash-command UI.
- Automation invocation: this skill must also work when an unattended agent prompt asks to process Memex handoffs.
- If the prompt is only about handoffs, skip unrelated runbooks and start at "Process Handoffs".
- Prefer OAuth-based Memex connection. Do not ask first-time users for API keys unless OAuth is unavailable in the current client.
- In automation mode, avoid asking follow-up questions unless authentication is missing or processing would require an irreversible external action not described in the handoff.
- Return a compact summary with processed, skipped, failed, and drained handoff IDs.

## Search Saved Content

1. If the user supplies the URL of an already-saved item, select the discovered exact-URL lookup action and execute it first. Do not use semantic search to resolve an explicit URL.
2. Otherwise select the discovered library-search action and execute it with the user's query.
3. For normal searches, default to `limit: 20` and the compact response shape. Request richer output only when the task needs richer machine-readable references.
4. For generic MCP execution results, read the action result from `result.structuredContent.output`.
5. Cite result URLs when a `url` is present.

## Save Public Content

1. Confirm the user provided a public URL or explicitly asked to save public content.
2. Select the discovered save/index action and call `execute_action` using its returned action ID and current input summary.
3. Include only user-requested tags, metadata, or notes.
4. Report the saved item URL or returned Memex identifier.
5. Do not claim the item is searchable until Memex reports successful indexing or processing.

## Create Or Inspect Sharing Links

1. Discover and execute the sharing-link listing action when the user asks what is already shared.
2. Discover and execute the sharing-link creation action when the user asks to share saved content.
3. Set API access as `access: "view"` or `access: "collaborate"`.
4. Return the public link and access level.

## Search Feeds

1. Discover and execute the subscribed-feeds action to fetch feed IDs.
2. To search selected feeds, discover and execute the library-search action with `feedIds`.
3. To search all subscribed feeds only, execute the discovered library-search action with `feedScope: "all"`.
4. To search the full library, omit both `feedIds` and `feedScope`.

## Follow Sources

1. Discover the follow-source action when the user provides an RSS feed, YouTube channel, or YouTube playlist URL and asks to follow it.
2. Execute it with `sourceUrl`. With no history option, it follows using Memex's normal initial sync.
3. To import the whole available archive, set `fetchHistory: true`. To import a bounded archive, provide the action's documented `importScope` instead.
4. For YouTube, optionally provide `youtubeContentScope` as `all`, `videos`, or `shorts`.
5. Report the returned feed and any queued entry count or usage charge. Do not claim an archive has finished indexing until the action reports it processed.

## Process Handoffs

1. Discover and execute the handoff-listing action when the user asks for pending handoffs, unprocessed handoffs, agent handoffs, routing cues, or handoffs in a time frame. When the user explicitly asks for all handoffs irrespective of status, omit both `status` and `readyOnly` to return every status and approval state.
2. For a normal poll, pass `status: "pending"` and omit `readyOnly`. This returns every unprocessed handoff, whether approved (`readyAt` is set) or not yet approved (`readyAt` is null), while excluding handoffs already marked processed.
3. Process approved pending handoffs first. If any returned pending handoffs have `readyAt: null`, tell the user how many there are (with their IDs and titles) and ask: "These handoffs are not approved yet. Do you want me to pull and process them anyway?" Do not process or drain them unless the user confirms. In unattended polling, report them as skipped because approval is required; do not drain them.
4. Use `referenceContentEntityId` when a referenced Memex content entity is known.
5. Use `createdAtFrom` and `createdAtTo` for an arbitrary ISO timestamp range, or `day` for a single `YYYY-MM-DD` day. To retrieve an old approved but unprocessed handoff, use `status: "pending"` with its date range. To retrieve a handoff already pulled before, use `status: "processed"` with its date range; this is an explicit historical lookup, not the normal poll.
6. Use `requestedDestinationText` to filter to a target app, agent, or person.
7. For each returned handoff, read `title`, `descriptionMarkdown`, `timingText`, `requestedDestinationText`, and `referenceContentEntityIds`.
8. Process only handoffs this agent can actually complete in the current runtime. Leave unsupported or unsafe handoffs undrained and report why.
9. After the agent has successfully completed a selected handoff, discover and execute the handoff-draining action with the handoff ID and `processingTarget` plus response metadata when supported. Confirm the returned handoff has `status: "processed"` and `processingType: "api_pull"`; if draining fails, report the failure so the handoff remains eligible for a later poll.
10. Do not execute the handoff-draining action merely because a handoff was listed, inspected, summarized, queued elsewhere, or could not be completed.
11. For automation runs, continue through all processable handoffs and finish with a compact machine-readable summary, including unapproved/skipped and drained handoff IDs.

## Search Or Manage Saved Views

1. To search private saved views through MCP, execute the discovered library-search action with `viewIds`.
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

## ChatGPT and Codex authentication

If authentication is missing or stale in Codex CLI, run
`codex mcp login memex`. Codex opens the authorization URL automatically. Only
open the printed URL manually if Codex reports that browser launch failed.
Complete sign-in, then start a new task before retrying so its tool catalogue
includes the authenticated Memex actions. In ChatGPT, connect Memex through the
plugin authentication prompt and start a new chat before retrying.
