import { Hono } from "hono"
import { cors } from "hono/cors"
import { serve as bunServe } from "bun"
import { readFileSync, existsSync } from "fs"
import { join } from "path"

import { ConfigRoutes } from "./routes/config"
import { ProfilesRoutes } from "./routes/profiles"
import { SkillsRoutes } from "./routes/skills"
import { PluginsRoutes } from "./routes/plugins"
import { AuthRoutes } from "./routes/auth"
import { AgentsRoutes } from "./routes/agents"
import { CommandsRoutes } from "./routes/commands"
import { BackupRoutes } from "./routes/backup"
import { GitHubRoutes } from "./routes/github"

const UI_DIST_PATH = join(import.meta.dir, "../../dist")

function getIndexHtml(): string {
  try {
    const indexPath = join(UI_DIST_PATH, "index.html")
    if (existsSync(indexPath)) {
      return readFileSync(indexPath, "utf-8")
    }
  } catch {}
  return `<!DOCTYPE html>
<html>
<head>
  <title>nikcli Studio</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0b;color:#f4f4f5;min-height:100vh;display:flex;align-items:center;justify-content:center}
    .loading{text-align:center}
    .spinner{width:40px;height:40px;border:3px solid #2a2a2f;border-top-color:#22d3ee;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 16px}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <div class=loading><div class=spinner></div><p>nikcli Studio loading...</p><p style=margin-top:8px;font-size:13px;color:#71717a>Run <code>bun run build</code> first, or <code>nikcli studio</code> to start</p></div>
</body>
</html>`
}

export function StudioServer() {
  const app = new Hono()

  app.use(
    "*",
    cors({
      origin: [
        "http://localhost:4200",
        "http://127.0.0.1:4200",
        "http://localhost:4096",
        "http://127.0.0.1:4096",
        "https://nikcli-mobile-production.up.railway.app",
      ],
      credentials: true,
    }),
  )

  app.get("/studio/api/health", (c) => c.json({ status: "ok", version: "0.0.1" }))

  // Serve built static assets from dist/
  app.get("/studio/assets/*", async (c) => {
    try {
      const assetPath = c.req.path.replace(/^\/studio\//, "")
      const filePath = join(UI_DIST_PATH, assetPath)
      if (!existsSync(filePath)) return c.notFound()
      const file = Bun.file(filePath)
      const mimeType = file.type || "application/octet-stream"
      return new Response(file, {
        headers: {
          "Content-Type": mimeType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      })
    } catch {
      return c.notFound()
    }
  })

  app.get("/studio", (c) => c.html(getIndexHtml()))
  app.get("/studio/", (c) => c.html(getIndexHtml()))
  // Catch-all for SPA client-side routes under /studio/*
  app.get("/studio/*", async (c) => {
    const p = c.req.path
    // Let API routes pass through
    if (p.startsWith("/studio/api/")) return c.notFound()
    return c.html(getIndexHtml())
  })

  app.route("/studio/api/config", ConfigRoutes())
  app.route("/studio/api/profiles", ProfilesRoutes())
  app.route("/studio/api/skills", SkillsRoutes())
  app.route("/studio/api/plugins", PluginsRoutes())
  app.route("/studio/api/auth", AuthRoutes())
  app.route("/studio/api/agents", AgentsRoutes())
  app.route("/studio/api/commands", CommandsRoutes())
  app.route("/studio/api/backup", BackupRoutes())
  app.route("/studio/api/github", GitHubRoutes())

  return app
}

/**
 * Returns only the studio API routes without any CORS middleware.
 * Use this when embedding inside a parent server that handles CORS.
 */
export function StudioApiRoutes() {
  const app = new Hono()
  app.get("/studio/api/health", (c) => c.json({ status: "ok", version: "0.0.1" }))
  app.route("/studio/api/config", ConfigRoutes())
  app.route("/studio/api/profiles", ProfilesRoutes())
  app.route("/studio/api/skills", SkillsRoutes())
  app.route("/studio/api/plugins", PluginsRoutes())
  app.route("/studio/api/auth", AuthRoutes())
  app.route("/studio/api/agents", AgentsRoutes())
  app.route("/studio/api/commands", CommandsRoutes())
  app.route("/studio/api/backup", BackupRoutes())
  app.route("/studio/api/github", GitHubRoutes())
  return app
}

const DEFAULT_PORT = 4201

async function findAvailablePort(start: number): Promise<number> {
  const net = await import("net")
  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(start, () => {
      server.once("close", () => resolve(start))
      server.close()
    })
    server.on("error", () => {
      resolve(findAvailablePort(start + 1))
    })
  })
}

export interface ServeOptions {
  port?: number
  hostname?: string
}

export async function serve(options: ServeOptions = {}) {
  const port = options.port || (await findAvailablePort(parseInt(process.env.PORT || String(DEFAULT_PORT))))
  // @ts-ignore
  const hostname = options.hostname || "localhost"

  const server = StudioServer()

  const bunServer = bunServe({
    port,
    hostname,
    fetch(req) {
      return server.fetch(req)
    },
  })

  console.log(`[nikcli-studio] Server running on http://${hostname}:${port}`)
  console.log(`[nikcli-studio] UI at http://${hostname}:${port}/studio`)

  process.on("SIGINT", () => {
    console.log("\n[nikcli-studio] Shutting down...")
    bunServer.stop()
    process.exit(0)
  })

  process.on("SIGTERM", () => {
    console.log("[nikcli-studio] Shutting down...")
    bunServer.stop()
    process.exit(0)
  })

  return bunServer
}

if (import.meta.main) {
  serve()
}
