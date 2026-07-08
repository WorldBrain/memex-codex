---
name: memex-agent-skill
description: Search and save Memex library content, and fetch, process, or drain pending Memex handoffs for manual slash-command use or agent automation.
---

# Memex agent skill

## Scope

Use Memex only for tasks involving the user's Memex library or when the user explicitly wants to save new public content into Memex.

Do not use Memex for general web search or facts outside the user's saved library.

## Start Every Memex Run

1. Use the Memex integration already configured in the current runtime.
2. For handoff-only prompts or `/memex:fetch-handoffs`, call the configured MCP `list_handoffs` tool first. Do not fetch endpoint catalogs, search web docs, inspect environment credentials, or probe raw REST before attempting the MCP handoff tool.
3. If authentication is missing or stale in interactive Codex, run `codex mcp login memex`; if it prints an authorize URL, open it with the local browser command available in the runtime, such as `open '<authorize-url>'` on macOS. Stop after opening OAuth and tell the user to complete sign-in, then start a new thread.
4. In unattended automation or clients that cannot run local commands/open a browser, tell the user to refresh or regenerate credentials using the client OAuth flow. In Codex CLI, run `codex mcp login memex`; in clients with plugin auth UI, connect Memex when prompted. Use https://docs.memex.garden/general/authentication only as fallback docs.
5. Parse responses using:
   https://docs.memex.garden/general/response-shape
6. If a request fails because of insufficient credits, follow:
   https://docs.memex.garden/general/buy-credits

## Choose The Runbook

- Search content already saved in Memex.
- Save a public URL into Memex so it becomes searchable later.
- Create and list public sharing links for saved Memex content when the user asks to share or inspect shared items.
- List the user's subscribed feeds and search within one feed, selected feeds, or all subscribed feeds.
- Fetch pending or time-filtered handoffs when the user asks what needs to be processed, handed off, shared, routed, or handled by an agent.
- Read or create the user's auto-tagging rules when they explicitly ask to inspect or configure automatic tagging.
- Work with Memex-native content such as web pages, annotations, tweets, YouTube videos, images, and related saved entities.

## Manual And Automation Use

- Manual invocation: this skill must work when selected from an agent's skill or slash-command UI, including Codex and Claude plugin skill shortcuts.
- Automation invocation: this skill must also work when an unattended Codex or Claude automation prompt asks to process Memex handoffs.
- If the prompt is only about handoffs, skip unrelated runbooks and start at "Process Handoffs".
- Prefer OAuth-based Memex connection. Do not ask first-time users for API keys
  unless OAuth is unavailable in the current client.
- In automation mode, avoid asking follow-up questions unless authentication is missing or processing would require an irreversible external action not described in the handoff.
- Return a compact summary with processed, skipped, failed, and drained handoff IDs.

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

## Process Handoffs

1. Call `list_handoffs` when the user asks for pending handoffs, unprocessed handoffs, agent handoffs, routing cues, or handoffs in a time frame.
2. Omit `status` and `readyOnly` by default. This lists approved pending handoffs that are ready for plugin processing.
3. Use `referenceContentEntityId` when a referenced Memex content entity is known.
4. Use `createdAtFrom` and `createdAtTo` for an arbitrary ISO timestamp range, or `day` for a single `YYYY-MM-DD` day.
5. Use `requestedDestinationText` to filter to a target app, agent, or person, such as Codex, Claude, OpenClaw, Hermes, Cursor, Devin, GitHub Copilot, Factory Droid, Jules, Replit Agent, Warp Oz, Obsidian, or a teammate.
6. Pass `readyOnly: false` only when the user explicitly asks to inspect unapproved or draft handoffs; do not process or drain those by default.
7. For each returned handoff, read `title`, `descriptionMarkdown`, `timingText`, `requestedDestinationText`, and `referenceContentEntityIds`.
8. Process only handoffs this agent can actually complete in the current runtime. Leave unsupported or unsafe handoffs undrained and report why.
9. Call `drain_handoff` only after the current agent has actually completed that handoff. Include the handoff ID and, when supported, identify the current agent in `processingTarget` or response metadata.
10. Do not call `drain_handoff` merely because a handoff was listed, inspected, summarized, queued elsewhere, or could not be completed.
11. For automation runs, continue through all processable handoffs and finish with a compact machine-readable summary.

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
