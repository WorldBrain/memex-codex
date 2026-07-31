---
name: fetch-handoffs
description: Fetch unprocessed Memex handoffs and route each one into its own fresh Codex task in the matching saved project. Use for the /memex:fetch-handoffs slash command or handoff-routing automation.
---

# Fetch Memex handoffs

## Endpoint

- Slash command: `/memex:fetch-handoffs`
- MCP server URL: `https://api.memex.garden/mcp`
- MCP discovery tool: `discover_actions`
- MCP execution tool: `execute_action`
- REST endpoint: `POST /list-handoffs`
- Drain through the handoff-draining action returned by discovery
- Drain REST endpoint: `POST /drain-handoff`

## Required runbook

1. Read and follow `../memex-agent-skill/SKILL.md`.
2. Treat this Codex command as a routing coordinator. These rules override any instruction in the shared "Process Handoffs" runbook to complete handoffs in the current task.
3. Treat the user's invocation of `/memex:fetch-handoffs` as an explicit request to create one separate Codex task for every handoff selected for routing.
4. Call the configured Memex MCP `discover_actions` first with the handoff-listing outcome, then call `execute_action` with the returned action ID. When the user explicitly asks for all handoffs irrespective of status, omit both `status` and `readyOnly` from the action input to return every status and approval state. Do not search endpoint catalogs, web docs, environment variables, or cached app metadata before attempting the MCP gateway.
5. For a normal poll, execute the discovered handoff-listing action with `status: "pending"` and omit `readyOnly`. This returns every unprocessed handoff, whether approved (`readyAt` is set) or not yet approved (`readyAt` is null), while excluding handoffs already marked processed.
6. Route approved pending handoffs first. If any returned pending handoffs have `readyAt: null`, tell the user how many there are (with their IDs and titles) and ask: "These handoffs are not approved yet. Do you want me to route them anyway?" Do not route or drain them unless the user confirms. In unattended polling, report them as skipped because approval is required; do not drain them.
7. Use `referenceContentEntityId`, `createdAtFrom`, `createdAtTo`, `day`, or `requestedDestinationText` when the user or automation prompt provides those filters. To retrieve an old approved but unprocessed handoff, use `status: "pending"` with its date range. To retrieve a handoff already pulled before, use `status: "processed"` with its date range; this is an explicit historical lookup, not the normal poll.
8. Before creating tasks, treat any handoff with `externalTaskProvider: "codex"`, a non-empty `externalTaskId`, and a non-empty `externalTaskUrl` as already routed. Include its existing mapping in the summary and do not call `create_thread` again. Then call the Codex `list_projects` tool once before routing the remaining handoffs. Resolve exactly one saved project for each selected handoff from its title, `descriptionMarkdown`, `requestedDestinationText`, references, and explicit repository or project paths. Never assume the coordinator's current project is the destination. If there is no unambiguous project match, leave that handoff unrouted and undrained and report the missing or ambiguous match.
9. Call `create_thread` exactly once per routable handoff. Target the resolved saved project, using a fresh worktree for a Git repository and the saved project directly for a non-Git project. Do not fork the coordinator task, reuse an existing task, combine multiple handoffs, or create a projectless task.
10. When `create_thread` returns a stable `threadId`, immediately call the hosted Memex tool `register_codex_handoff_task` with that handoff ID and thread ID. Treat the handoff as routed only after registration succeeds. Registration is idempotent for the same mapping and rejects a different thread ID. If registration fails transiently, retry it with the original thread ID; never create a replacement task. If Codex returns only a queued `clientThreadId`, report the handoff as queued but not yet registered; a client task ID is not a valid Codex deep-link ID.
11. Put only that handoff in the new task's prompt. Preserve its ID, title, complete `descriptionMarkdown`, `timingText`, `requestedDestinationText`, and `referenceContentEntityIds`. Tell the new task that it exclusively owns completing this handoff and must discover and execute the handoff-draining action with the handoff ID and `processingTarget` only after the work is actually complete.
12. The coordinator must not execute handoff work, edit handoff target files, wait for or supervise created tasks, or execute the handoff-draining action. A successfully created and registered task means the handoff was routed, not processed or drained.
13. Return a compact summary with fetched IDs; routed handoff-to-task mappings; skipped IDs and reasons, including unapproved or unresolved projects; failed IDs and reasons; and `drained: []`.

## Tool Discovery

- Use the configured Memex MCP server/tool namespace for handoffs.
- Do not use the Codex app connector namespaces such as `mcp__codex_apps__memex*` for handoffs. Those app connectors are separate from this plugin and may expose only search or annotation tools.
- If OAuth has just succeeded but the current thread still does not expose `list_handoffs`, treat the current Codex thread/tool catalog as stale. Stop and tell the user to start a new thread.
- Do not substitute a legacy Memex app connector that lacks `discover_actions`, and do not conclude that the hosted gateway lacks the handoff action merely because a current thread has stale deferred-tool metadata.

## Authentication

If the Memex MCP call returns an authentication challenge, follow the client
OAuth flow when it is offered. In Codex, do not fall back to raw REST,
environment-token probing, endpoint-catalog lookup, or web search before OAuth
has been attempted.

When the client can control OAuth dynamic registration metadata, register this
connection as `client_name: "Memex Codex plugin"` and include
`memex_client_source: "memex_codex_plugin"`.

For interactive Codex slash-command use, if `list_handoffs` is not exposed
because Memex is not logged in, start OAuth instead of continuing with fallback
probing:

1. Run `codex mcp login memex`.
2. Codex opens the authorization URL automatically. Only open the printed URL
   manually if Codex reports that the browser launch failed.
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
