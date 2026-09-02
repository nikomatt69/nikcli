import { Hono } from "hono"
import { upgradeWebSocket } from "hono/bun"

export const CompanionWsRoutes = new Hono()

const sessions = new Map<string, any>()
const cliSockets = new Map<string, any>()
const browserSockets = new Map<string, any[]>()

CompanionWsRoutes.get(
  "/ws/:sessionId",
  upgradeWebSocket((c) => {
    const sessionId = c.req.param("sessionId")

    return {
      onOpen(_event, ws) {
        console.log(`[companion] Browser WebSocket connected: ${sessionId}`)

        if (!browserSockets.has(sessionId ?? "")) {
          browserSockets.set(sessionId ?? "", [])
        }
        browserSockets.get(sessionId ?? "")!.push(ws)

        const session = sessions.get(sessionId ?? "")
        if (session) {
          session.status = "running"
          sessions.set(sessionId ?? "", session)
        }
      },
      onMessage(event, ws) {
        const message = event.data.toString()

        try {
          const msg = JSON.parse(message)

          const cliSocket = cliSockets.get(sessionId ?? "")
          if (cliSocket) {
            cliSocket.send(message + "\n")
          }

          if (msg.type === "user") {
            const session = sessions.get(sessionId ?? "")
            if (session) {
              session.messages = session.messages || []
              session.messages.push(msg)
              sessions.set(sessionId ?? "", session)
            }
          }
        } catch (e) {
          console.error("[companion] Failed to parse browser message:", e)
        }
      },
      onClose(_event, ws) {
        console.log(`[companion] Browser WebSocket disconnected: ${sessionId}`)
        const sockets = browserSockets.get(sessionId ?? "")
        if (sockets) {
          const idx = sockets.indexOf(ws)
          if (idx !== -1) {
            sockets.splice(idx, 1)
          }
          if (sockets.length === 0) {
            browserSockets.delete(sessionId ?? "")
          }
        }
      },
    }
  }),
)

CompanionWsRoutes.get(
  "/cli/:sessionId",
  upgradeWebSocket((c) => {
    const sessionId = c.req.param("sessionId")

    return {
      onOpen(_event, ws) {
        console.log(`[companion] nikcli WebSocket connected: ${sessionId}`)
        cliSockets.set(sessionId ?? "", ws)

        const session = sessions.get(sessionId ?? "")
        if (session) {
          session.status = "running"
          sessions.set(sessionId ?? "", session)
        }
      },
      onMessage(event, ws) {
        const message = event.data.toString()
        const lines = message.split("\n").filter(Boolean)

        for (const line of lines) {
          try {
            const msg = JSON.parse(line)

            const session = sessions.get(sessionId ?? "")
            if (session) {
              session.messages = session.messages || []
              session.messages.push(msg)
              sessions.set(sessionId ?? "", session)

              if (msg.type === "system" && msg.subtype === "init") {
                session.status = "running"
                session.tools = msg.tools
                session.model = msg.model
                sessions.set(sessionId ?? "", session)
              }
            }

            const browsers = browserSockets.get(sessionId ?? "") || []
            for (const browser of browsers) {
              browser.send(line)
            }

            if (msg.type === "control_request" && msg.request?.subtype === "can_use_tool") {
              const browsers = browserSockets.get(sessionId ?? "") || []
              for (const browser of browsers) {
                browser.send(
                  JSON.stringify({
                    type: "permission_request",
                    sessionId,
                    request: msg,
                  }),
                )
              }
            }
          } catch (e) {
            console.error("[companion] Failed to parse nikcli message:", e)
          }
        }
      },
      onClose(_event, ws) {
        console.log(`[companion] nikcli WebSocket disconnected: ${sessionId}`)
        cliSockets.delete(sessionId ?? "")

        const session = sessions.get(sessionId ?? "")
        if (session) {
          session.status = "stopped"
          sessions.set(sessionId ?? "", session)
        }
      },
    }
  }),
)

export function getSessions() {
  return sessions
}
