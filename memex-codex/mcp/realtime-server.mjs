#!/usr/bin/env node

/* global fetch, WebSocket */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'
import { randomUUID } from 'node:crypto'
import {
    clearInterval,
    clearTimeout,
    setInterval,
    setTimeout,
} from 'node:timers'
import { URL } from 'node:url'
import { runCodexHandoff } from './codex-app-server-client.mjs'

const SERVER_VERSION = '0.1.0'
const PROTOCOL_VERSION = '2025-06-18'
const SESSION_DIR = path.join(
    process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    'memex',
)
const SESSION_PATH = path.join(SESSION_DIR, 'realtime-session.json')
const LEADER_PATH = path.join(SESSION_DIR, 'realtime-leader.json')
const DISABLED_PATH = path.join(SESSION_DIR, 'realtime-disabled')
const MAX_BUFFERED_HANDOFFS = 100
const REALTIME_STATUS_TOUCH_INTERVAL_MS = 20_000
const CODEX_PROCESSING_TARGET = 'codex_app_server'
const AUTOCONNECT_ENABLED = process.env.MEMEX_REALTIME_AUTOCONNECT !== '0'
const INSTANCE_ID = randomUUID()
const COORDINATOR_OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        tasks: {
            type: 'array',
            maxItems: 20,
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    title: { type: 'string' },
                    prompt: { type: 'string' },
                    taskMode: {
                        type: 'string',
                        enum: ['planning', 'implementation'],
                    },
                },
                required: ['title', 'prompt', 'taskMode'],
            },
        },
    },
    required: ['tasks'],
}

let initialized = false
let sessionRecord = loadSessionRecord()
let socket = null
let socketGeneration = 0
let heartbeatTimer = null
let reconnectTimer = null
let reconnectAttempt = 0
let connectionState = sessionRecord
    ? 'connecting'
    : fs.existsSync(DISABLED_PATH)
      ? 'disabled'
      : 'unpaired'
let connectionError = null
let subscriptionRef = null
let requestRef = 0
let bufferedHandoffs = []
let lastRealtimeStatusTouchAt = 0
const seenHandoffVersions = new Set()
const routingHandoffIds = new Set()
const deferredHandoffIds = new Set()

function send(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`)
}

function sendResult(id, result) {
    send({ jsonrpc: '2.0', id, result })
}

function sendError(id, code, message) {
    send({ jsonrpc: '2.0', id, error: { code, message } })
}

function toolResult(payload, summary) {
    return {
        content: [{ type: 'text', text: summary }],
        structuredContent: payload,
    }
}

function notify(level, data) {
    if (!initialized) return
    send({
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: { level, logger: 'memex-realtime', data },
    })
}

function loadSessionRecord() {
    try {
        const parsed = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'))
        if (
            typeof parsed.supabaseUrl !== 'string' ||
            typeof parsed.supabaseAnonKey !== 'string' ||
            typeof parsed.handoffDestinationId !== 'string' ||
            typeof parsed.session?.accessToken !== 'string' ||
            typeof parsed.session?.refreshToken !== 'string'
        ) {
            return null
        }
        return {
            ...parsed,
            projectRoutes: normalizeProjectRoutes(parsed.projectRoutes ?? []),
        }
    } catch {
        return null
    }
}

function persistSessionRecord(record) {
    fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 })
    const temporaryPath = `${SESSION_PATH}.${process.pid}.tmp`
    fs.writeFileSync(temporaryPath, `${JSON.stringify(record)}\n`, {
        mode: 0o600,
    })
    fs.renameSync(temporaryPath, SESSION_PATH)
    fs.chmodSync(SESSION_PATH, 0o600)
}

function removeSessionRecord() {
    try {
        fs.unlinkSync(SESSION_PATH)
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error
    }
}

function setAutomaticPairingDisabled(disabled) {
    fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 })
    if (disabled) {
        fs.closeSync(fs.openSync(DISABLED_PATH, 'w', 0o600))
        fs.chmodSync(DISABLED_PATH, 0o600)
        return
    }
    try {
        fs.unlinkSync(DISABLED_PATH)
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error
    }
}

function claimRealtimeLeadership() {
    if (!AUTOCONNECT_ENABLED) return
    fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 })
    const temporaryPath = `${LEADER_PATH}.${process.pid}.${INSTANCE_ID}.tmp`
    fs.writeFileSync(
        temporaryPath,
        `${JSON.stringify({ instanceId: INSTANCE_ID, pid: process.pid })}\n`,
        { mode: 0o600 },
    )
    fs.renameSync(temporaryPath, LEADER_PATH)
}

function isRealtimeLeader() {
    if (!AUTOCONNECT_ENABLED) return true
    try {
        const leader = JSON.parse(fs.readFileSync(LEADER_PATH, 'utf8'))
        return leader?.instanceId === INSTANCE_ID
    } catch {
        return false
    }
}

function normalizeSupabaseSession(rawSession) {
    if (!rawSession || typeof rawSession !== 'object') {
        throw new Error('Pairing response did not include a Supabase session')
    }
    return {
        accessToken: rawSession.accessToken ?? rawSession.access_token,
        refreshToken: rawSession.refreshToken ?? rawSession.refresh_token,
        expiresAt: rawSession.expiresAt ?? rawSession.expires_at ?? null,
        tokenType: rawSession.tokenType ?? rawSession.token_type ?? 'bearer',
    }
}

async function exchangePairingTicket(ticket, exchangeUrl) {
    const response = await fetch(exchangeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(
            typeof payload.error === 'string'
                ? payload.error
                : `Pairing failed with HTTP ${response.status}`,
        )
    }

    const session = normalizeSupabaseSession(payload.session)
    if (
        typeof session.accessToken !== 'string' ||
        typeof session.refreshToken !== 'string' ||
        typeof payload.supabaseUrl !== 'string' ||
        typeof payload.supabaseAnonKey !== 'string' ||
        typeof payload.handoffDestinationId !== 'string'
    ) {
        throw new Error('Pairing response was incomplete')
    }

    return {
        exchangeUrl,
        supabaseUrl: payload.supabaseUrl.replace(/\/$/, ''),
        supabaseAnonKey: payload.supabaseAnonKey,
        handoffDestinationId: payload.handoffDestinationId,
        session,
        projectRoutes: [],
    }
}

function normalizeProjectRoutes(routes) {
    if (!Array.isArray(routes)) return []

    const seen = new Set()
    return routes.flatMap((route) => {
        if (
            !route ||
            typeof route.name !== 'string' ||
            typeof route.path !== 'string'
        ) {
            return []
        }
        const name = route.name.trim()
        const projectPath = route.path.trim()
        if (!name || !path.isAbsolute(projectPath)) return []

        const key = `${name.toLocaleLowerCase()}:${projectPath}`
        if (seen.has(key)) return []
        seen.add(key)
        return [{ name, path: projectPath }]
    })
}

function normalizeDestinationText(value) {
    return value
        .toLocaleLowerCase()
        .replace(/\b(project|repo|repository|folder)\b/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ')
}

function resolveProjectRoute(handoff) {
    const requestedDestination = handoff.requestedDestinationText
    if (!sessionRecord) return null

    if (typeof requestedDestination === 'string') {
        const requested = normalizeDestinationText(requestedDestination)
        if (requested) {
            const matchingRoutes = sessionRecord.projectRoutes.filter(
                (route) => {
                    const aliases = [route.name, path.basename(route.path)]
                    return aliases.some(
                        (alias) =>
                            normalizeDestinationText(alias) === requested,
                    )
                },
            )
            if (matchingRoutes.length === 1) return matchingRoutes[0]
        }
    }

    const sourceContext = ` ${normalizeDestinationText(
        [handoff.title, handoff.descriptionMarkdown, handoff.sourceText]
            .filter((value) => typeof value === 'string' && value.trim())
            .join(' '),
    )} `
    const inferredRoutes = sessionRecord.projectRoutes.filter((route) => {
        const aliases = [route.name, path.basename(route.path)]
            .map(normalizeDestinationText)
            .filter(Boolean)
        return aliases.some((alias) =>
            [
                ` for ${alias} `,
                ` to ${alias} `,
                ` in ${alias} `,
                ` ${alias} project `,
                ` ${alias} repo `,
                ` ${alias} repository `,
                ` ${alias} feature `,
            ].some((phrase) => sourceContext.includes(phrase)),
        )
    })

    return inferredRoutes.length === 1 ? inferredRoutes[0] : null
}

function sessionNeedsRefresh(record) {
    if (typeof record.session.expiresAt !== 'number') return false
    return record.session.expiresAt * 1000 <= Date.now() + 60_000
}

async function refreshSessionIfNeeded() {
    if (!sessionRecord || !sessionNeedsRefresh(sessionRecord)) return

    const response = await fetch(
        `${sessionRecord.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
        {
            method: 'POST',
            headers: {
                apikey: sessionRecord.supabaseAnonKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                refresh_token: sessionRecord.session.refreshToken,
            }),
        },
    )
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(
            typeof payload.error_description === 'string'
                ? payload.error_description
                : 'Supabase session refresh failed',
        )
    }

    sessionRecord = {
        ...sessionRecord,
        session: normalizeSupabaseSession(payload),
    }
    persistSessionRecord(sessionRecord)
}

async function touchRealtimeConnectionStatus(force = false) {
    if (!sessionRecord) return
    if (
        !force &&
        Date.now() - lastRealtimeStatusTouchAt <
            REALTIME_STATUS_TOUCH_INTERVAL_MS
    ) {
        return
    }

    await refreshSessionIfNeeded()
    const response = await fetch(
        `${sessionRecord.supabaseUrl}/rest/v1/rpc/touch_handoff_destination_realtime_connection`,
        {
            method: 'POST',
            headers: {
                apikey: sessionRecord.supabaseAnonKey,
                Authorization: `Bearer ${sessionRecord.session.accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                p_destination_id: sessionRecord.handoffDestinationId,
            }),
        },
    )
    if (!response.ok) {
        throw new Error('Failed to report the live Realtime connection')
    }
    lastRealtimeStatusTouchAt = Date.now()
}

function websocketUrl(record) {
    const url = new URL('/realtime/v1/websocket', record.supabaseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('apikey', record.supabaseAnonKey)
    url.searchParams.set('vsn', '2.0.0')
    return url.toString()
}

function nextRef() {
    requestRef += 1
    return String(requestRef)
}

function sendSocketMessage(topic, event, payload, ref, joinRef = null) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    socket.send(
        JSON.stringify([joinRef, ref ?? nextRef(), topic, event, payload]),
    )
}

function normalizeSocketMessage(raw) {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
        const [joinRef, ref, topic, event, payload] = parsed
        return { joinRef, ref, topic, event, payload }
    }
    return {
        joinRef: parsed.join_ref,
        ref: parsed.ref,
        topic: parsed.topic,
        event: parsed.event,
        payload: parsed.payload,
    }
}

function getHandoffSourceText(record) {
    const spans = record?.thread?.source?.spans
    if (!Array.isArray(spans)) return ''
    return spans
        .map((span) =>
            typeof span?.text === 'string' ? span.text.trim() : '',
        )
        .filter(Boolean)
        .join('\n\n')
}

function toPluginHandoff(record) {
    return {
        id: record.id,
        title: record.title,
        descriptionMarkdown: record.description_markdown ?? '',
        timingText: record.timing_text ?? null,
        requestedDestinationText: record.requested_destination_text ?? null,
        sourceText: getHandoffSourceText(record),
        referenceContentEntityIds: record.reference_content_entity_ids ?? [],
        destinationId: record.destination_id ?? null,
        readyAt: record.ready_at ?? null,
        status: record.status,
        externalTaskProvider: record.external_task_provider ?? null,
        externalTaskId: record.external_task_id ?? null,
        externalTaskUrl: record.external_task_url ?? null,
        externalTaskRegisteredAt: record.external_task_registered_at ?? null,
        createdAt: record.created_at,
        updatedAt: record.updated_at,
    }
}

async function callSupabaseRpc(name, payload) {
    if (!sessionRecord) {
        throw new Error('Memex Realtime is not paired')
    }
    await refreshSessionIfNeeded()

    const response = await fetch(
        `${sessionRecord.supabaseUrl}/rest/v1/rpc/${name}`,
        {
            method: 'POST',
            headers: {
                apikey: sessionRecord.supabaseAnonKey,
                Authorization: `Bearer ${sessionRecord.session.accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        },
    )
    const responsePayload = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(
            typeof responsePayload.message === 'string'
                ? responsePayload.message
                : `Memex RPC ${name} failed`,
        )
    }
    return responsePayload
}

function coordinatorPrompt(handoff) {
    const timing = handoff.timingText ? `\nTiming: ${handoff.timingText}` : ''
    const destination = handoff.requestedDestinationText
        ? `\nRequested destination: ${handoff.requestedDestinationText}`
        : ''
    const references = handoff.referenceContentEntityIds.length
        ? `\nMemex reference IDs: ${handoff.referenceContentEntityIds.join(', ')}`
        : ''
    const source = handoff.sourceText
        ? `\n\nComplete source transcript:\n${handoff.sourceText}`
        : ''

    return `You are the coordinator for one complete Memex voice-memo handoff. Your only job is to split the memo's explicitly delimited handoffs into separate Codex task specifications. The realtime bridge creates those tasks from your structured result.

Coordinator contract:
- Do not investigate, implement, plan, or summarize the requested work yourself.
- Treat spoken markers such as "there's a handoff", "handoff feature", "handoff start", "handoff complete", "send this off to Codex", and equivalent phrasing as task boundaries.
- Return exactly one task for each explicitly handed-off workstream. Do not create tasks for surrounding reflections, content ideas, or personal to-dos that were not explicitly handed off.
- Make every task prompt self-contained by preserving all requirements, examples, constraints, and requested investigation from its delimited transcript block.
- Use taskMode "planning" when the speaker asks to investigate, research, plan, or explicitly says not to implement. Otherwise use "implementation".
- Do not create additional Memex handoffs. The separate outputs are child Codex tasks inside this one Memex handoff.
- Do not use tools. Return only the required structured result.

Memex handoff ID: ${handoff.id}
Title: ${handoff.title}${destination}${timing}${references}

Description:
${handoff.descriptionMarkdown}${source}`
}

function parseCoordinatorTasks(outputText) {
    const parsed = JSON.parse(outputText)
    if (!Array.isArray(parsed?.tasks)) {
        throw new Error('Coordinator did not return a task list')
    }
    return parsed.tasks.flatMap((task) => {
        const title = typeof task?.title === 'string' ? task.title.trim() : ''
        const prompt =
            typeof task?.prompt === 'string' ? task.prompt.trim() : ''
        const taskMode =
            task?.taskMode === 'planning' ? 'planning' : 'implementation'
        return title && prompt ? [{ title, prompt, taskMode }] : []
    })
}

function childTaskPrompt(handoff, task) {
    const modeInstruction =
        task.taskMode === 'planning'
            ? 'Investigate and produce a concrete plan. Do not implement changes.'
            : 'Implement the requested work end-to-end.'
    return `This Codex task was created by the coordinator for Memex handoff ${handoff.id}.

Task title: ${task.title}
Task mode: ${task.taskMode}
${modeInstruction}

Task:
${task.prompt}`
}

function startChildTask({ handoff, task, projectRoute }) {
    return new Promise((resolve, reject) => {
        let childThreadId = null
        const completion = runCodexHandoff({
            projectPath: projectRoute.path,
            prompt: childTaskPrompt(handoff, task),
            onThreadCreated: async (createdThreadId) => {
                childThreadId = createdThreadId
                notify('info', {
                    type: 'memex_handoff_child_task_started',
                    message: `Codex child task started: ${task.title}`,
                    handoffId: handoff.id,
                    threadId: createdThreadId,
                    projectPath: projectRoute.path,
                    taskTitle: task.title,
                })
                resolve({ threadId: createdThreadId, title: task.title })
            },
        })
        completion
            .then((result) => {
                notify('info', {
                    type: 'memex_handoff_child_task_completed',
                    message: `Codex child task completed: ${task.title}`,
                    handoffId: handoff.id,
                    threadId: result.threadId,
                    taskTitle: task.title,
                })
            })
            .catch((error) => {
                if (!childThreadId) {
                    reject(error)
                    return
                }
                notify('error', {
                    type: 'memex_handoff_child_task_failed',
                    message:
                        error instanceof Error ? error.message : 'Task failed',
                    handoffId: handoff.id,
                    threadId: childThreadId,
                    taskTitle: task.title,
                })
            })
    })
}

async function routeHandoff(handoff, projectRoute) {
    let threadId = null
    let processingStarted = false
    try {
        await callSupabaseRpc('start_handoff_processing', {
            p_handoff_id: handoff.id,
            p_processing_type: 'api_pull',
            p_processing_target: CODEX_PROCESSING_TARGET,
        })
        processingStarted = true
        const result = await runCodexHandoff({
            projectPath: projectRoute.path,
            prompt: coordinatorPrompt(handoff),
            outputSchema: COORDINATOR_OUTPUT_SCHEMA,
            onThreadCreated: async (createdThreadId) => {
                threadId = createdThreadId
                await callSupabaseRpc('register_codex_handoff_task', {
                    p_handoff_id: handoff.id,
                    p_destination_id: sessionRecord.handoffDestinationId,
                    p_thread_id: createdThreadId,
                })
                notify('info', {
                    type: 'memex_handoff_task_started',
                    message: `Codex task started for Memex handoff: ${handoff.title}`,
                    handoffId: handoff.id,
                    threadId: createdThreadId,
                    projectPath: projectRoute.path,
                })
            },
        })
        const tasks = parseCoordinatorTasks(result.outputText)
        const childTasks = await Promise.all(
            tasks.map((task) =>
                startChildTask({ handoff, task, projectRoute }),
            ),
        )

        await callSupabaseRpc('drain_handoff', {
            p_handoff_id: handoff.id,
            p_processing_target: CODEX_PROCESSING_TARGET,
            p_response_metadata: {
                codexThreadId: result.threadId,
                childCodexThreadIds: childTasks.map((task) => task.threadId),
                projectPath: projectRoute.path,
            },
        })
        notify('info', {
            type: 'memex_handoff_completed',
            message: `Memex handoff completed: ${handoff.title}`,
            handoffId: handoff.id,
            threadId: result.threadId,
            childThreadIds: childTasks.map((task) => task.threadId),
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Task failed'
        let releaseError = null
        if (processingStarted) {
            deferredHandoffIds.add(handoff.id)
            try {
                await callSupabaseRpc('release_handoff_processing', {
                    p_handoff_id: handoff.id,
                    p_processing_target: CODEX_PROCESSING_TARGET,
                    p_error_message: message,
                    p_response_metadata: {
                        codexThreadId: threadId,
                        projectPath: projectRoute.path,
                    },
                })
            } catch (releaseFailure) {
                releaseError =
                    releaseFailure instanceof Error
                        ? releaseFailure.message
                        : 'Could not return the handoff to pending'
            }
        }
        notify('error', {
            type: 'memex_handoff_task_failed',
            message: releaseError
                ? `Memex handoff delivery failed and could not be returned to pending: ${handoff.title}. ${releaseError}`
                : `Memex handoff delivery failed and remains pending: ${handoff.title}. ${message}`,
            handoffId: handoff.id,
            threadId,
        })
    } finally {
        routingHandoffIds.delete(handoff.id)
    }
}

function queueHandoffRouting(handoff) {
    if (
        handoff.externalTaskId ||
        routingHandoffIds.has(handoff.id) ||
        deferredHandoffIds.has(handoff.id)
    ) {
        return false
    }

    const projectRoute = resolveProjectRoute(handoff)
    if (!projectRoute) {
        notify('warning', {
            type: 'memex_handoff_route_unresolved',
            message: `No unique local Codex project route matches: ${handoff.requestedDestinationText ?? handoff.title}`,
            handoffId: handoff.id,
        })
        return false
    }

    routingHandoffIds.add(handoff.id)
    void routeHandoff(handoff, projectRoute)
    return true
}

async function queuePendingHandoffRouting() {
    const pending = await listPendingHandoffs(MAX_BUFFERED_HANDOFFS)
    return {
        pending,
        queuedHandoffIds: pending
            .filter((handoff) => queueHandoffRouting(handoff))
            .map((handoff) => handoff.id),
    }
}

function recordRealtimeHandoff(record) {
    if (
        !record ||
        record.status !== 'pending' ||
        !record.ready_at ||
        record.destination_id !== sessionRecord?.handoffDestinationId
    ) {
        return
    }

    const versionKey = `${record.id}:${record.updated_at ?? record.ready_at}`
    if (seenHandoffVersions.has(versionKey)) return
    seenHandoffVersions.add(versionKey)
    if (seenHandoffVersions.size > MAX_BUFFERED_HANDOFFS * 4) {
        seenHandoffVersions.clear()
        seenHandoffVersions.add(versionKey)
    }

    const handoff = toPluginHandoff(record)
    bufferedHandoffs = [
        ...bufferedHandoffs.filter((item) => item.id !== handoff.id),
        handoff,
    ].slice(-MAX_BUFFERED_HANDOFFS)
    notify('notice', {
        type: 'memex_handoff_ready',
        message: `Memex handoff ready: ${handoff.title}`,
        handoff,
    })
    queueHandoffRouting(handoff)
}

function handleSocketMessage(event) {
    if (!isRealtimeLeader()) {
        connectionState = 'standby'
        connectionError = null
        closeSocket()
        return
    }
    let message
    try {
        message = normalizeSocketMessage(event.data)
    } catch {
        return
    }

    if (message.event === 'phx_reply' && message.ref === subscriptionRef) {
        if (message.payload?.status === 'ok') {
            connectionState = 'subscribed'
            connectionError = null
            reconnectAttempt = 0
            notify('info', {
                type: 'memex_realtime_connected',
                message: 'Memex Realtime handoff subscription connected.',
            })
            void touchRealtimeConnectionStatus(true).catch((error) => {
                notify('warning', {
                    type: 'memex_realtime_status_failed',
                    message: error.message,
                })
            })
            void queuePendingHandoffRouting().catch((error) => {
                notify('warning', {
                    type: 'memex_handoff_catch_up_failed',
                    message: error.message,
                })
            })
        } else {
            connectionState = 'reconnecting'
            connectionError =
                message.payload?.response?.reason ??
                'Supabase Realtime subscription was rejected'
            socket?.close()
        }
        return
    }

    if (message.event === 'phx_error') {
        connectionState = 'reconnecting'
        connectionError = 'Supabase Realtime channel error'
        socket?.close()
        return
    }

    if (message.event === 'postgres_changes') {
        const record =
            message.payload?.data?.record ?? message.payload?.record ?? null
        recordRealtimeHandoff(record)
    }
}

function clearSocketTimers() {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (reconnectTimer) clearTimeout(reconnectTimer)
    heartbeatTimer = null
    reconnectTimer = null
}

function closeSocket() {
    clearSocketTimers()
    socketGeneration += 1
    if (socket) {
        socket.onclose = null
        socket.close()
    }
    socket = null
}

function scheduleReconnect(generation) {
    if (
        !sessionRecord ||
        generation !== socketGeneration ||
        !isRealtimeLeader()
    ) {
        return
    }
    connectionState = 'reconnecting'
    const delay = Math.min(30_000, 1_000 * 2 ** reconnectAttempt)
    reconnectAttempt += 1
    reconnectTimer = setTimeout(() => {
        connectRealtime().catch((error) => {
            connectionError = error.message
            scheduleReconnect(socketGeneration)
        })
    }, delay)
}

async function connectRealtime() {
    if (!sessionRecord) {
        connectionState = 'unpaired'
        return
    }
    if (!isRealtimeLeader()) {
        connectionState = 'standby'
        connectionError = null
        return
    }

    closeSocket()
    await refreshSessionIfNeeded()
    connectionState = 'connecting'
    connectionError = null
    const generation = socketGeneration
    const topic = `realtime:memex-codex-${sessionRecord.handoffDestinationId}`
    const openedSocket = new WebSocket(websocketUrl(sessionRecord))
    socket = openedSocket

    await new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error('Supabase Realtime connection timed out')),
            10_000,
        )
        openedSocket.onopen = () => {
            clearTimeout(timeout)
            if (generation !== socketGeneration) return resolve()
            subscriptionRef = nextRef()
            sendSocketMessage(
                topic,
                'phx_join',
                {
                    config: {
                        broadcast: { ack: false, self: false },
                        presence: { key: '' },
                        postgres_changes: [
                            {
                                event: '*',
                                schema: 'public',
                                table: 'handoffs',
                                filter: `destination_id=eq.${sessionRecord.handoffDestinationId}`,
                            },
                        ],
                    },
                    access_token: sessionRecord.session.accessToken,
                },
                subscriptionRef,
                subscriptionRef,
            )
            heartbeatTimer = setInterval(() => {
                const previousAccessToken =
                    sessionRecord?.session.accessToken ?? null
                refreshSessionIfNeeded()
                    .then(() => {
                        if (
                            sessionRecord &&
                            sessionRecord.session.accessToken !==
                                previousAccessToken
                        ) {
                            sendSocketMessage(
                                topic,
                                'access_token',
                                {
                                    access_token:
                                        sessionRecord.session.accessToken,
                                },
                                nextRef(),
                                subscriptionRef,
                            )
                        }
                        sendSocketMessage('phoenix', 'heartbeat', {}, nextRef())
                        void touchRealtimeConnectionStatus().catch((error) => {
                            notify('warning', {
                                type: 'memex_realtime_status_failed',
                                message: error.message,
                            })
                        })
                    })
                    .catch((error) => {
                        connectionError = error.message
                        openedSocket.close()
                    })
            }, 25_000)
            resolve()
        }
        openedSocket.onerror = () => {
            clearTimeout(timeout)
            reject(new Error('Supabase Realtime WebSocket failed to connect'))
        }
    })

    openedSocket.onmessage = handleSocketMessage
    openedSocket.onerror = () => {
        connectionError = 'Supabase Realtime WebSocket error'
    }
    openedSocket.onclose = () => {
        clearSocketTimers()
        if (generation === socketGeneration) scheduleReconnect(generation)
    }
}

async function listPendingHandoffs(limit) {
    if (!sessionRecord) {
        throw new Error('Memex Realtime is not paired')
    }
    await refreshSessionIfNeeded()

    const url = new URL('/rest/v1/handoffs', sessionRecord.supabaseUrl)
    url.searchParams.set(
        'select',
        'id,title,description_markdown,timing_text,requested_destination_text,reference_content_entity_ids,destination_id,ready_at,status,external_task_provider,external_task_id,external_task_url,external_task_registered_at,created_at,updated_at',
    )
    url.searchParams.set(
        'destination_id',
        `eq.${sessionRecord.handoffDestinationId}`,
    )
    url.searchParams.set('status', 'eq.pending')
    url.searchParams.set('ready_at', 'not.is.null')
    url.searchParams.set('order', 'created_at.asc')
    url.searchParams.set('limit', String(limit))

    const response = await fetch(url, {
        headers: {
            apikey: sessionRecord.supabaseAnonKey,
            Authorization: `Bearer ${sessionRecord.session.accessToken}`,
        },
    })
    const payload = await response.json().catch(() => [])
    if (!response.ok) {
        throw new Error('Failed to read the durable Memex handoff queue')
    }
    return payload.map(toPluginHandoff)
}

function getStatus() {
    return {
        paired: Boolean(sessionRecord),
        automaticPairingDisabled: fs.existsSync(DISABLED_PATH),
        connectionState,
        handoffDestinationId: sessionRecord?.handoffDestinationId ?? null,
        projectRoutes: sessionRecord?.projectRoutes ?? [],
        activeHandoffCount: routingHandoffIds.size,
        bufferedHandoffCount: bufferedHandoffs.length,
        lastError: connectionError,
    }
}

const tools = [
    {
        name: 'connect_realtime_handoffs',
        description:
            'Pair this plugin-local MCP with the authenticated Memex connection and start the Supabase Realtime handoff WebSocket.',
        inputSchema: {
            type: 'object',
            properties: {
                ticket: { type: 'string', minLength: 20 },
                exchangeUrl: { type: 'string', format: 'uri' },
                projectRoutes: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', minLength: 1 },
                            path: { type: 'string', minLength: 1 },
                        },
                        required: ['name', 'path'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['ticket', 'exchangeUrl'],
            additionalProperties: false,
        },
    },
    {
        name: 'configure_realtime_handoff_routes',
        description:
            'Replace the local Codex project routes used to automatically turn approved Memex handoffs into Codex tasks.',
        inputSchema: {
            type: 'object',
            properties: {
                projectRoutes: {
                    type: 'array',
                    minItems: 1,
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', minLength: 1 },
                            path: { type: 'string', minLength: 1 },
                        },
                        required: ['name', 'path'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['projectRoutes'],
            additionalProperties: false,
        },
    },
    {
        name: 'realtime_handoff_status',
        description:
            'Report whether the plugin-local Supabase Realtime handoff subscription is paired and connected.',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
    },
    {
        name: 'read_realtime_handoffs',
        description:
            'Read approved pending handoffs for this Codex destination from the durable queue and include recent WebSocket notifications.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'integer', minimum: 1, maximum: 100 },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'disconnect_realtime_handoffs',
        description:
            'Disconnect the Realtime WebSocket and remove the locally stored Memex Realtime session.',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
    },
]

async function callTool(name, args) {
    if (name === 'connect_realtime_handoffs') {
        if (
            typeof args.ticket !== 'string' ||
            typeof args.exchangeUrl !== 'string'
        ) {
            throw new Error('ticket and exchangeUrl are required')
        }
        sessionRecord = await exchangePairingTicket(
            args.ticket,
            args.exchangeUrl,
        )
        setAutomaticPairingDisabled(false)
        sessionRecord.projectRoutes = normalizeProjectRoutes(
            args.projectRoutes ?? [],
        )
        persistSessionRecord(sessionRecord)
        claimRealtimeLeadership()
        deferredHandoffIds.clear()
        await callSupabaseRpc('select_local_realtime_handoff_delivery', {
            p_destination_id: sessionRecord.handoffDestinationId,
        })
        await connectRealtime()
        const { pending, queuedHandoffIds } = await queuePendingHandoffRouting()
        return toolResult(
            { ...getStatus(), pendingHandoffs: pending, queuedHandoffIds },
            `Memex Realtime paired. ${queuedHandoffIds.length} approved pending handoff(s) were routed automatically.`,
        )
    }
    if (name === 'configure_realtime_handoff_routes') {
        if (!sessionRecord) {
            throw new Error('Memex Realtime is not paired')
        }
        const projectRoutes = normalizeProjectRoutes(args.projectRoutes)
        if (!projectRoutes.length) {
            throw new Error(
                'At least one absolute local project route is required',
            )
        }
        sessionRecord = { ...sessionRecord, projectRoutes }
        persistSessionRecord(sessionRecord)
        claimRealtimeLeadership()
        deferredHandoffIds.clear()
        await callSupabaseRpc('select_local_realtime_handoff_delivery', {
            p_destination_id: sessionRecord.handoffDestinationId,
        })
        const { pending, queuedHandoffIds } = await queuePendingHandoffRouting()
        return toolResult(
            { ...getStatus(), pendingHandoffs: pending, queuedHandoffIds },
            `Configured ${projectRoutes.length} local Codex project route(s). ${queuedHandoffIds.length} pending handoff(s) were routed automatically.`,
        )
    }
    if (name === 'realtime_handoff_status') {
        const status = getStatus()
        return toolResult(
            status,
            status.paired
                ? `Memex Realtime is ${status.connectionState}.`
                : 'Memex Realtime is not paired.',
        )
    }
    if (name === 'read_realtime_handoffs') {
        const limit = Number.isInteger(args.limit) ? args.limit : 100
        const handoffs = await listPendingHandoffs(limit)
        return toolResult(
            { handoffs, realtimeNotifications: bufferedHandoffs },
            `${handoffs.length} approved pending handoff(s) found.`,
        )
    }
    if (name === 'disconnect_realtime_handoffs') {
        closeSocket()
        sessionRecord = null
        connectionState = 'unpaired'
        connectionError = null
        bufferedHandoffs = []
        removeSessionRecord()
        setAutomaticPairingDisabled(true)
        connectionState = 'disabled'
        return toolResult(getStatus(), 'Memex Realtime disconnected.')
    }
    throw new Error(`Unknown tool: ${name}`)
}

async function handleMessage(message) {
    if (!message || message.jsonrpc !== '2.0') return
    const { id, method, params = {} } = message

    if (method === 'initialize') {
        initialized = true
        sendResult(id, {
            protocolVersion: params.protocolVersion || PROTOCOL_VERSION,
            capabilities: { tools: {}, logging: {} },
            serverInfo: { name: 'memex-realtime', version: SERVER_VERSION },
        })
        if (sessionRecord && AUTOCONNECT_ENABLED) {
            claimRealtimeLeadership()
            connectRealtime().catch((error) => {
                connectionState = 'reconnecting'
                connectionError = error.message
                scheduleReconnect(socketGeneration)
            })
        }
        return
    }
    if (method === 'notifications/initialized') return
    if (method === 'ping') return sendResult(id, {})
    if (method === 'logging/setLevel') return sendResult(id, {})
    if (method === 'tools/list') return sendResult(id, { tools })
    if (method === 'tools/call') {
        try {
            sendResult(id, await callTool(params.name, params.arguments ?? {}))
        } catch (error) {
            sendResult(id, {
                content: [
                    {
                        type: 'text',
                        text:
                            error instanceof Error
                                ? error.message
                                : 'Tool failed',
                    },
                ],
                isError: true,
            })
        }
        return
    }
    if (id !== undefined) sendError(id, -32601, `Method not found: ${method}`)
}

const lines = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
})

lines.on('line', (line) => {
    if (!line.trim()) return
    try {
        void handleMessage(JSON.parse(line))
    } catch {
        sendError(null, -32700, 'Parse error')
    }
})

lines.on('close', () => {
    closeSocket()
    process.exit(0)
})
