---
name: fetch-handoffs
description: Fetch unprocessed Memex handoffs through the Memex list_handoffs endpoint for slash-command use or agent automation.
---

# Fetch Memex handoffs

## Endpoint

- Slash command: `/memex:fetch-handoffs`
- MCP server URL: `https://api.memex.garden/mcp`
- MCP tool: `list_handoffs`
- REST endpoint: `POST /list-handoffs`
- Drain MCP tool: `drain_handoff`
- Drain REST endpoint: `POST /drain-handoff`

## Required runbook

1. Read and follow `../memex-agent-skill/SKILL.md`.
2. Use the "Process Handoffs" runbook from that shared skill unless the user explicitly asks for a broader Memex task.
3. For slash-command or automation use, call the configured Memex MCP `list_handoffs` tool first. Do not search endpoint catalogs, web docs, environment variables, or cached app metadata before attempting the MCP handoff tool.
4. Omit `status` by default. This fetches pending/unprocessed handoffs, including items that are not ready for webhook delivery.
5. Use `referenceContentEntityId`, `createdAtFrom`, `createdAtTo`, `day`, or `requestedDestinationText` only when the user or automation prompt provides those filters.
6. Call `drain_handoff` only after the current agent has actually completed the handoff.
7. Return a compact summary with fetched, processed, skipped, failed, and drained handoff IDs.

## Tool Discovery

- Use the configured Memex MCP server/tool namespace for handoffs.
- Do not use the Codex app connector namespaces such as `mcp__codex_apps__memex*` for handoffs. Those app connectors are separate from this plugin and may expose only search or annotation tools.
- If OAuth has just succeeded but the current thread still does not expose `list_handoffs`, treat the current Codex thread/tool catalog as stale. Stop and tell the user to start a new thread.
- Do not conclude that the Memex connector build lacks the handoff endpoint merely because the app connector registry or current thread's deferred tool catalog does not list `list_handoffs`.

## Authentication

If the Memex MCP call returns an authentication challenge, follow the client
OAuth flow when it is offered. In Codex, do not fall back to raw REST,
environment-token probing, endpoint-catalog lookup, or web search before OAuth
has been attempted.

For interactive Codex slash-command use, if `list_handoffs` is not exposed
because Memex is not logged in, start OAuth instead of continuing with fallback
probing:

1. Run `codex mcp login memex`.
2. If Codex prints an authorize URL, open that URL with the local browser
   command available in the runtime, such as `open '<authorize-url>'` on macOS.
3. Stop after opening the OAuth flow. Tell the user to complete sign-in, then
   start a new thread and rerun `/memex:fetch-handoffs`.
4. Do not continue handoff processing in the same thread after OAuth completes;
   Codex may not refresh MCP tools until a new thread starts.

For unattended automation or clients that cannot run local commands/open a
browser, say:

```text
Memex is not connected yet. Connect Memex when prompted, or run `codex mcp login memex` in Codex CLI. After sign-in, start a new thread and run `/memex:fetch-handoffs` again.
```

Do not ask first-time users to configure `MEMEX_API_KEY`, `MEMEX_USER_ID`, or
`MEMEX_BEARER_TOKEN` unless OAuth is unavailable in their client.
