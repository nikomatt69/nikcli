import { serve as bunServe } from "bun"

import {
  handleCliConnect,
  handleCliMessage,
  handleCliClose,
  handleBrowserConnect,
  handleBrowserMessage,
  handleBrowserClose,
  createSession,
} from "./ws-bridge.js"
import { killAllSessions } from "./cli-launcher.js"
import { CompanionRoutes } from "./routes.js"

const app = CompanionRoutes()

const PORT = parseInt(process.env.PORT || "3456")

interface ServeOptions {
  port?: number
  hostname?: string
}

interface WSData {
  sessionId: string
}

export function serve(options: ServeOptions = {}) {
  const port = options.port || parseInt(process.env.PORT || "3456")
  const hostname = options.hostname || "localhost"

  const server = bunServe({
    port,
    hostname,
    fetch(req, server) {
      const url = new URL(req.url)

      if (url.pathname.startsWith("/ws/cli/")) {
        const sessionId = url.pathname.split("/ws/cli/")[1]

        const success = (server as any).upgrade(req, {
          data: { sessionId },
        })

        if (success) return
      }

      if (url.pathname.startsWith("/ws/browser/")) {
        const sessionId = url.pathname.split("/ws/browser/")[1]

        const success = (server as any).upgrade(req, {
          data: { sessionId },
        })

        if (success) return
      }

      return app.fetch(req)
    },
    websocket: {
      open(ws) {
        const data = (ws as any).data as WSData | undefined
        const sessionId = data?.sessionId

        if (!sessionId) return

        const url = new URL((ws as any).url)

        if (url.pathname.startsWith("/ws/cli/")) {
          handleCliConnect(ws as any, sessionId)
        } else if (url.pathname.startsWith("/ws/browser/")) {
          createSession(sessionId, port).then(() => {
            handleBrowserConnect(ws as any, sessionId)
          })
        }
      },
      message(ws, message) {
        const data = (ws as any).data as WSData | undefined
        const sessionId = data?.sessionId

        if (!sessionId) return

        const url = new URL((ws as any).url)

        if (url.pathname.startsWith("/ws/cli/")) {
          handleCliMessage(ws as any, sessionId, message.toString())
        } else if (url.pathname.startsWith("/ws/browser/")) {
          handleBrowserMessage(ws as any, sessionId, message.toString())
        }
      },
      close(ws) {
        const data = (ws as any).data as WSData | undefined
        const sessionId = data?.sessionId

        if (!sessionId) return

        const url = new URL((ws as any).url)

        if (url.pathname.startsWith("/ws/cli/")) {
          handleCliClose(sessionId)
        } else if (url.pathname.startsWith("/ws/browser/")) {
          handleBrowserClose(ws as any, sessionId)
        }
      },
    },
  })

  console.log(`[server] Running on http://${hostname}:${port}`)

  process.on("SIGINT", () => {
    console.log("[server] Shutting down...")
    killAllSessions()
    server.stop()
    process.exit(0)
  })

  process.on("SIGTERM", () => {
    console.log("[server] Shutting down...")
    killAllSessions()
    server.stop()
    process.exit(0)
  })

  return server
}

export { PORT }

if (import.meta.main) {
  serve()
}
