import { spawn } from 'node:child_process'
import readline from 'node:readline'

const THREAD_CREATION_TIMEOUT_MS = 30_000

function handoffExecutionError(message, error) {
    const detail = error instanceof Error ? error.message : null
    return new Error(detail ? `${message}: ${detail}` : message)
}

/**
 * Starts one ordinary local Codex task and keeps its app-server connection open
 * until the task reaches a terminal turn state.
 */
export function runCodexHandoff({
    projectPath,
    prompt,
    onThreadCreated,
}) {
    return new Promise((resolve, reject) => {
        const child = spawn('codex', ['app-server'], {
            cwd: projectPath,
            stdio: ['pipe', 'pipe', 'pipe'],
        })
        const output = readline.createInterface({ input: child.stdout })
        let threadId = null
        let finished = false
        let threadCreationTimeout = null
        let stderr = ''

        function finish(result) {
            if (finished) return
            finished = true
            if (threadCreationTimeout) clearTimeout(threadCreationTimeout)
            output.close()
            if (!child.killed) child.kill()
            if (result instanceof Error) reject(result)
            else resolve(result)
        }

        function send(message) {
            if (!child.stdin.writable) {
                finish(new Error('Codex app-server stdin is not writable'))
                return
            }
            child.stdin.write(`${JSON.stringify(message)}\n`)
        }

        function startThread() {
            send({
                id: 2,
                method: 'thread/start',
                params: {
                    cwd: projectPath,
                    ephemeral: false,
                    serviceName: 'memex_realtime_handoffs',
                },
            })
        }

        function startTurn(id) {
            send({
                id: 3,
                method: 'turn/start',
                params: {
                    threadId: id,
                    cwd: projectPath,
                    input: [{ type: 'text', text: prompt }],
                },
            })
        }

        async function handleResponse(message) {
            if (message.error) {
                finish(
                    new Error(
                        typeof message.error.message === 'string'
                            ? message.error.message
                            : 'Codex app-server request failed',
                    ),
                )
                return
            }

            if (message.id === 1) {
                send({ method: 'initialized', params: {} })
                startThread()
                return
            }

            if (message.id === 2) {
                const nextThreadId = message.result?.thread?.id
                if (typeof nextThreadId !== 'string' || !nextThreadId) {
                    finish(new Error('Codex app-server did not return a thread ID'))
                    return
                }
                threadId = nextThreadId
                if (threadCreationTimeout) {
                    clearTimeout(threadCreationTimeout)
                    threadCreationTimeout = null
                }
                try {
                    await onThreadCreated(threadId)
                } catch (error) {
                    finish(handoffExecutionError('Could not register Codex task', error))
                    return
                }
                startTurn(threadId)
            }
        }

        output.on('line', (line) => {
            if (!line.trim() || finished) return
            let message
            try {
                message = JSON.parse(line)
            } catch {
                return
            }

            if (message.id !== undefined) {
                void handleResponse(message)
                return
            }

            if (
                message.method === 'turn/completed' &&
                message.params?.threadId === threadId
            ) {
                const status = message.params?.turn?.status
                if (status === 'completed') {
                    finish({ threadId })
                } else {
                    finish(
                        new Error(
                            `Codex task finished with status ${status ?? 'unknown'}`,
                        ),
                    )
                }
            }
        })

        child.stderr.on('data', (chunk) => {
            stderr = `${stderr}${chunk}`.slice(-4_000)
        })
        child.stdin.on('error', (error) => {
            finish(handoffExecutionError('Codex app-server stdin failed', error))
        })
        child.on('error', (error) => {
            finish(handoffExecutionError('Could not start Codex app-server', error))
        })
        child.on('exit', (code) => {
            if (!finished) {
                const diagnostic = stderr.trim()
                finish(
                    new Error(
                        diagnostic
                            ? `Codex app-server exited with code ${code}: ${diagnostic}`
                            : `Codex app-server exited with code ${code}`,
                    ),
                )
            }
        })

        threadCreationTimeout = setTimeout(() => {
            finish(new Error('Codex app-server timed out while creating a task'))
        }, THREAD_CREATION_TIMEOUT_MS)

        send({
            id: 1,
            method: 'initialize',
            params: {
                clientInfo: {
                    name: 'memex_realtime_plugin',
                    title: 'Memex Realtime Handoffs',
                    version: '0.1.0',
                },
            },
        })
    })
}
