import { Hono } from "hono"
import { cors } from "hono/cors"
import { getSessions } from "./ws-routes"
import { readFileSync } from "fs"
import { join } from "path"

const UI_DIST_PATH = join(import.meta.dir, "../../dist")

function getIndexHtml(): string {
  try {
    return readFileSync(join(UI_DIST_PATH, "index.html"), "utf-8")
  } catch {
    return `<!DOCTYPE html>
<html>
<head>
  <title>nikcli Companion</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0b; color: #f4f4f5; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .loading { text-align: center; }
    .spinner { width: 40px; height: 40px; border: 3px solid #2a2a2f; border-top-color: #22d3ee; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="loading"><div class="spinner"></div><p>Loading...</p></div>
</body>
</html>`
  }
}

export function CompanionRoutes() {
  const app = new Hono()
  const sessions = getSessions()

  app.use("*", cors())

  app.get("*", (c) => {
    const url = new URL(c.req.url)
    const path = url.pathname

    if (path === "/" || path === "/index.html") {
      return c.redirect("/companion")
    }

    if (path.startsWith("/companion") || path.startsWith("/api")) {
      if (path === "/companion" || path === "/companion/") {
        return c.html(getIndexHtml())
      }
      if (path === "/companion/index.html") {
        return c.html(getIndexHtml())
      }
      if (path.startsWith("/companion/api/")) {
        return c.html(getIndexHtml())
      }
      if (path === "/companion" || path.startsWith("/companion?")) {
        return c.html(getIndexHtml())
      }
      return c.html(getIndexHtml())
    }

    return c.redirect("/companion")
  })

  app.get("/index.html", (c) => {
    return c.html(getIndexHtml())
  })

  app.post("/api/sessions", (c) => {
    const sessionId = crypto.randomUUID()
    const host = c.req.header("host")?.split(":")[0] || "localhost"
    const port = c.req.header("host")?.split(":")[1] || "80"

    sessions.set(sessionId, {
      id: sessionId,
      status: "waiting",
      createdAt: Date.now(),
      messages: [],
    })

    return c.json({
      sessionId,
      wsUrl: `ws://${host}:${port}/companion/ws/${sessionId}`,
      cliUrl: `ws://${host}:${port}/companion/cli/${sessionId}`,
      instructions: `nikcli --sdk-url ws://${host}:${port}/companion/cli/${sessionId} --print --output-format stream-json --input-format stream-json -p ""`,
    })
  })

  app.get("/api/sessions", (c) => {
    const allSessions = Array.from(sessions.values())
    return c.json(allSessions)
  })

  app.get("/api/sessions/:id", (c) => {
    const id = c.req.param("id")
    const session = sessions.get(id)

    if (!session) {
      return c.json({ error: "Session not found" }, 404)
    }

    return c.json(session)
  })

  app.delete("/api/sessions/:id", (c) => {
    const id = c.req.param("id")
    sessions.delete(id)
    return c.json({ success: true })
  })

  return app
}
