---
name: enable-realtime-handoffs
description: Pair the Memex Codex plugin's local MCP with Supabase Realtime so approved Memex handoffs arrive over a live WebSocket. Use for /memex:enable-realtime-handoffs or when setting up live handoff delivery.
---

# Enable Realtime handoffs

Use this skill only to pair the two MCP components bundled by the Memex plugin:

- `memex`: the hosted OAuth-authenticated MCP
- `memex-realtime`: the plugin-local MCP that owns the Supabase WebSocket

## Required runbook

1. Call the plugin-local `realtime_handoff_status` tool. Do not expose its session details.
2. Call Codex `list_projects` once. Convert every local saved project with an absolute local path into a `projectRoutes` entry with its displayed label as `name` and its absolute local path as `path`. This lets the local realtime service match both the saved-project label and the path's final directory name (for example, `Hex project` matches a project at `/path/to/Hex`).
3. If the status reports an existing pairing, call the plugin-local `configure_realtime_handoff_routes` with the full `projectRoutes` list. This keeps the existing login, pairing, and Realtime connection; do not create a connection ticket.
4. Otherwise, call the hosted Memex tool `create_realtime_handoff_connection_ticket` with `client: "memex_codex_plugin"`, then immediately call the plugin-local `connect_realtime_handoffs` tool with the returned `ticket`, `exchangeUrl`, and `projectRoutes`. The ticket is single-use and expires after two minutes.
5. Do not print, summarize, or otherwise expose a connection ticket to the user.
6. Report the returned connection state, configured route count, and handoff IDs queued during the durable-queue catch-up.
7. If the hosted tool requests authentication, complete the Memex OAuth flow, start a new Codex task, and rerun `/memex:enable-realtime-handoffs`.
8. If the local tool is missing, tell the user to reinstall/update the Memex plugin and start a new Codex task. Do not ask them to install a companion application.

After successful pairing, the local MCP refreshes its Supabase session and reconnects automatically while Codex keeps the MCP process running. Realtime notifications are wake-up signals; the local MCP validates each approved pending handoff, maps it to one configured project, and creates a Codex task through `codex app-server`. It immediately registers the returned thread ID with Memex, then drains the handoff only after the Codex turn completes. `public.handoffs` remains the durable source of truth.

If the project routes change later, call `configure_realtime_handoff_routes` with the full replacement route list. Unmatched or ambiguous handoffs remain pending and are never routed automatically.
