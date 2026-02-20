import type { ServerWebSocket } from "bun"
import type { SDKMessage, SDKControlRequest, Session } from "./session-types.js"
import { saveSession, loadSession } from "./session-store.js"
import { launchClaude, killSession, isSessionRunning } from "./cli-launcher.js"

interface BrowserSocket {
  ws: ServerWebSocket<{ sessionId: string }>
  sessionId: string
}

interface CliSocket {
  ws: ServerWebSocket<{ sessionId: string }>
  sessionId: string
}

const browserSockets = new Map<string, BrowserSocket[]>()
const cliSockets = new Map<string, CliSocket>()
const sessions = new Map<string, Session>()

export function getWsUrl(sessionId: string, port: number): string {
  return `ws://localhost:${port}/ws/cli/${sessionId}`
}

export async function createSession(
  sessionId: string,
  port: number,
  options: {
    cwd?: string
    model?: string
    verbose?: boolean
    maxTurns?: number
  } = {},
): Promise<Session> {
  const existing = sessions.get(sessionId)
  if (existing && existing.status === "running") {
    return existing
  }

  const session: Session = {
    id: sessionId,
    cliSessionId: sessionId,
    cwd: options.cwd || process.cwd(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "starting",
    model: options.model,
    messages: [],
    pendingPermissions: [],
  }

  sessions.set(sessionId, session)
  saveSession(session)

  const wsUrl = getWsUrl(sessionId, port)

  try {
    await launchClaude(sessionId, wsUrl, {
      cwd: options.cwd,
      model: options.model,
      verbose: options.verbose,
      maxTurns: options.maxTurns,
    })

    session.status = "running"
    sessions.set(sessionId, session)
    saveSession(session)
  } catch (error) {
    session.status = "error"
    session.messages.push({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      errors: [error instanceof Error ? error.message : String(error)],
      duration_ms: 0,
      duration_api_ms: 0,
      num_turns: 0,
      total_cost_usd: 0,
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      modelUsage: {},
      permission_denials: [],
      uuid: sessionId,
      session_id: sessionId,
    })
    sessions.set(sessionId, session)
    saveSession(session)
  }

  return session
}

export function handleCliConnect(ws: ServerWebSocket<{ sessionId: string }>, sessionId: string): void {
  console.log(`[bridge] CLI connected: ${sessionId}`)

  cliSockets.set(sessionId, {
    ws,
    sessionId,
  })

  const session = sessions.get(sessionId)
  if (session) {
    session.status = "running"
    sessions.set(sessionId, session)
    saveSession(session)
  }

  ws.subscribe(`cli:${sessionId}`)
}

export function handleCliMessage(ws: ServerWebSocket<{ sessionId: string }>, sessionId: string, message: string): void {
  const lines = message.split("\n").filter(Boolean)

  for (const line of lines) {
    try {
      const msg = JSON.parse(line) as SDKMessage
      const session = sessions.get(sessionId)

      if (session) {
        session.messages.push(msg)
        session.updatedAt = Date.now()
        sessions.set(sessionId, session)

        if (msg.type === "system" && msg.subtype === "init") {
          session.tools = msg.tools
          session.model = msg.model
          session.status = "running"
          sessions.set(sessionId, session)
        }

        saveSession(session)
      }

      if (msg.type === "control_request" && msg.request?.subtype === "can_use_tool") {
        const browsers = browserSockets.get(sessionId) || []
        for (const browser of browsers) {
          browser.ws.send(
            JSON.stringify({
              type: "permission_request",
              sessionId,
              request: msg,
            }),
          )
        }
      } else {
        const browsers = browserSockets.get(sessionId) || []
        for (const browser of browsers) {
          browser.ws.send(line)
        }
      }

      if (msg.type === "control_response" && session) {
        session.pendingPermissions = session.pendingPermissions.filter((p) => p.request_id !== msg.response?.request_id)
        sessions.set(sessionId, session)
      }
    } catch (e) {
      console.error(`[bridge] Failed to parse message: ${e}`)
    }
  }
}

export function handleCliClose(sessionId: string): void {
  console.log(`[bridge] CLI disconnected: ${sessionId}`)
  cliSockets.delete(sessionId)

  const session = sessions.get(sessionId)
  if (session) {
    session.status = "stopped"
    session.updatedAt = Date.now()
    sessions.set(sessionId, session)
    saveSession(session)
  }
}

export function handleBrowserConnect(ws: ServerWebSocket<{ sessionId: string }>, sessionId: string): void {
  console.log(`[bridge] Browser connected: ${sessionId}`)

  if (!browserSockets.has(sessionId)) {
    browserSockets.set(sessionId, [])
  }
  browserSockets.get(sessionId)!.push({ ws, sessionId })

  const session = sessions.get(sessionId)
  if (session) {
    const historyMsg = JSON.stringify({
      type: "session_history",
      sessionId,
      messages: session.messages,
      status: session.status,
    })
    ws.send(historyMsg)
  }
}

export function handleBrowserMessage(
  ws: ServerWebSocket<{ sessionId: string }>,
  sessionId: string,
  message: string,
): void {
  try {
    const msg = JSON.parse(message)

    const cli = cliSockets.get(sessionId)
    if (cli) {
      cli.ws.send(message + "\n")
    }

    if (msg.type === "control_response") {
      const session = sessions.get(sessionId)
      if (session) {
        session.pendingPermissions = session.pendingPermissions.filter((p) => p.request_id !== msg.response?.request_id)
        sessions.set(sessionId, session)
      }
    }
  } catch (e) {
    console.error(`[bridge] Failed to handle browser message: ${e}`)
  }
}

export function handleBrowserClose(ws: ServerWebSocket<{ sessionId: string }>, sessionId: string): void {
  console.log(`[bridge] Browser disconnected: ${sessionId}`)

  const sockets = browserSockets.get(sessionId)
  if (sockets) {
    const idx = sockets.findIndex((s) => s.ws === ws)
    if (idx !== -1) {
      sockets.splice(idx, 1)
    }
    if (sockets.length === 0) {
      browserSockets.delete(sessionId)
    }
  }
}

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId)
}

export function getAllSessions(): Session[] {
  return Array.from(sessions.values())
}

export function stopSession(sessionId: string): boolean {
  const killed = killSession(sessionId)
  const session = sessions.get(sessionId)
  if (session) {
    session.status = "stopped"
    session.updatedAt = Date.now()
    sessions.set(sessionId, session)
    saveSession(session)
  }
  return killed
}

export function sendToBrowser(sessionId: string, data: unknown): void {
  const browsers = browserSockets.get(sessionId) || []
  for (const browser of browsers) {
    browser.ws.send(JSON.stringify(data))
  }
}
