---
name: enable-realtime-handoffs
description: Pair the Memex Codex plugin's local MCP with Supabase Realtime so approved Memex handoffs arrive over a live WebSocket. The normal Memex skill performs this automatically; use this skill for explicit setup or repair.
---

# Enable Realtime handoffs

Use this skill only to pair the two MCP components bundled by the Memex plugin:

- `memex`: the hosted OAuth-authenticated MCP
- `memex-realtime`: the plugin-local MCP that owns the Supabase WebSocket

## Required runbook

1. Call the plugin-local `realtime_handoff_status` tool. Do not expose its session details.
2. If the status reports an existing pairing, keep the existing login, pairing, and Realtime connection. Do not create a connection ticket or require a saved project.
3. Otherwise, call the hosted Memex tool `create_realtime_handoff_connection_ticket` with `client: "memex_codex_plugin"`, then immediately call the plugin-local `connect_realtime_handoffs` tool with the returned `ticket` and `exchangeUrl`. The ticket is single-use and expires after two minutes.
4. Do not print, summarize, or otherwise expose a connection ticket to the user.
5. Report the returned connection state and handoff IDs queued during the durable-queue catch-up.
6. If the hosted tool requests authentication, complete the Memex OAuth flow, start a new Codex task, and rerun `/memex:enable-realtime-handoffs`.
7. If the local tool is missing, tell the user to reinstall/update the Memex plugin and start a new Codex task. Do not ask them to install a companion application.

After successful pairing, the local MCP refreshes its Supabase session and reconnects automatically while Codex keeps the MCP process running. Realtime notifications are wake-up signals; the local MCP validates each approved pending handoff and creates a projectless coordinator task through `codex app-server`. The coordinator discovers relevant saved projects itself, delegates into them when appropriate, and otherwise completes the handoff from its projectless user context. The local MCP immediately registers the coordinator thread ID with Memex, then drains the handoff only after the coordinator turn completes. `public.handoffs` remains the durable source of truth.

Saved-project routes are optional hints, not launch prerequisites. When explicitly useful, call `configure_realtime_handoff_routes` with the full replacement hint list; pass an empty list to clear them.
