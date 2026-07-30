---
name: enable-realtime-handoffs
description: Pair the Memex Codex plugin's local MCP with Supabase Realtime so approved Memex handoffs arrive over a live WebSocket. Use for /memex:enable-realtime-handoffs or when setting up live handoff delivery.
---

# Enable Realtime handoffs

Use this skill only to pair the two MCP components bundled by the Memex plugin:

- `memex`: the hosted OAuth-authenticated MCP
- `memex-realtime`: the plugin-local MCP that owns the Supabase WebSocket

## Required runbook

1. Call the hosted Memex tool `create_realtime_handoff_connection_ticket` with `client: "memex_codex_plugin"`.
2. Immediately call the plugin-local `connect_realtime_handoffs` tool with the returned `ticket` and `exchangeUrl`. The ticket is single-use and expires after two minutes.
3. Do not print, summarize, or otherwise expose the ticket to the user.
4. Report the returned connection state and the number of approved pending handoffs found during the durable-queue catch-up.
5. If the hosted tool requests authentication, complete the Memex OAuth flow, start a new Codex task, and rerun `/memex:enable-realtime-handoffs`.
6. If the local tool is missing, tell the user to reinstall/update the Memex plugin and start a new Codex task. Do not ask them to install a companion application.

After successful pairing, the local MCP refreshes its Supabase session and reconnects automatically while Codex keeps the MCP process running. Realtime notifications are wake-up signals only; `public.handoffs` remains the durable source of truth.

## Current limitation

Codex does not currently expose a plugin API that lets an unsolicited MCP notification create a sidebar task in a saved project. Live notifications and queue catch-up are enabled here; creating project-scoped Codex tasks still uses `/memex:fetch-handoffs` until Codex exposes that host capability.
