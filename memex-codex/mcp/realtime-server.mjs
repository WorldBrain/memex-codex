#!/usr/bin/env node

/* global fetch, WebSocket */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'
import {
    clearInterval,
    clearTimeout,
    setInterval,
    setTimeout,
} from 'node:timers'
import { URL } from 'node:url'

const SERVER_VERSION = '0.1.0'
const PROTOCOL_VERSION = '2025-06-18'
const SESSION_DIR = path.join(
    process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    'memex',
)
const SESSION_PATH = path.join(SESSION_DIR, 'realtime-session.json')
const MAX_BUFFERED_HANDOFFS = 100
const REALTIME_STATUS_TOUCH_INTERVAL_MS = 20_000

let initialized = false
let sessionRecord = loadSessionRecord()
let socket = null
let socketGeneration = 0
let heartbeatTimer = null
let reconnectTimer = null
let reconnectAttempt = 0
let connectionState = sessionRecord ? 'connecting' : 'unpaired'
let connectionError = null
let subscriptionRef = null
let requestRef = 0
let bufferedHandoffs = []
let lastRealtimeStatusTouchAt = 0
const seenHandoffVersions = new Set()

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
        return parsed
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
    }
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

function toPluginHandoff(record) {
    return {
        id: record.id,
        title: record.title,
        descriptionMarkdown: record.description_markdown ?? '',
        timingText: record.timing_text ?? null,
        requestedDestinationText: record.requested_destination_text ?? null,
        referenceContentEntityIds: record.reference_content_entity_ids ?? [],
        destinationId: record.destination_id ?? null,
        readyAt: record.ready_at ?? null,
        status: record.status,
        createdAt: record.created_at,
        updatedAt: record.updated_at,
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
}

function handleSocketMessage(event) {
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
    if (!sessionRecord || generation !== socketGeneration) return
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
        'id,title,description_markdown,timing_text,requested_destination_text,reference_content_entity_ids,destination_id,ready_at,status,created_at,updated_at',
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
        connectionState,
        handoffDestinationId: sessionRecord?.handoffDestinationId ?? null,
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
            },
            required: ['ticket', 'exchangeUrl'],
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
        persistSessionRecord(sessionRecord)
        await connectRealtime()
        const pending = await listPendingHandoffs(100)
        return toolResult(
            { ...getStatus(), pendingHandoffs: pending },
            `Memex Realtime paired. ${pending.length} approved pending handoff(s) are ready in the durable queue.`,
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
        if (sessionRecord) {
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
