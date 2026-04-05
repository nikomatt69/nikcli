import { Hono } from "hono"
import fs from "fs"
import path from "path"
import os from "os"
import { getCommandDirs, loadCommandsFromDir, parseFrontmatter, buildFrontmatter } from "../config-loader"
import { atomicWriteFileSync } from "../atomic"

const HOME_DIR = os.homedir()
const AUTH_PATH = path.join(HOME_DIR, ".local", "share", "nikcli", "auth.json")

export function AuthRoutes() {
  const app = new Hono()

  function loadAuth(): Record<string, any> {
    if (!fs.existsSync(AUTH_PATH)) return {}
    try { return JSON.parse(fs.readFileSync(AUTH_PATH, "utf8")) } catch { return {} }
  }

  function saveAuth(auth: Record<string, any>): boolean {
    try {
      const dir = path.dirname(AUTH_PATH)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.chmodSync(dir, 0o700)
      atomicWriteFileSync(AUTH_PATH, JSON.stringify(auth, null, 2))
      fs.chmodSync(AUTH_PATH, 0o600)
      return true
    } catch { return false }
  }

  app.get("/", (c) => {
    const auth = loadAuth()
    const sanitized: Record<string, any> = {}
    for (const [key, value] of Object.entries(auth)) {
      if (typeof value === "object" && value !== null) {
        const masked = { ...value as any }
        if (masked.apiKey) masked.apiKey = "***" + masked.apiKey.slice(-4)
        if (masked.access) masked.access = "***"
        if (masked.refresh) masked.refresh = "***"
        sanitized[key] = masked
      } else {
        sanitized[key] = value
      }
    }
    return c.json({ auth: sanitized })
  })

  app.post("/:provider", async (c) => {
    const { provider } = c.req.param()
    const body = await c.req.json<{ type: "api"; apiKey: string } | { type: "oauth"; access: string; refresh?: string; expires?: number }>()
    const auth = loadAuth()
    auth[provider] = body
    if (saveAuth(auth)) return c.json({ success: true })
    return c.json({ error: "Failed to save auth" }, 500)
  })

  app.delete("/:provider", (c) => {
    const { provider } = c.req.param()
    const auth = loadAuth()
    if (auth[provider]) {
      delete auth[provider]
      if (saveAuth(auth)) return c.json({ success: true })
      return c.json({ error: "Failed to save" }, 500)
    }
    return c.json({ error: "Auth not found" }, 404)
  })

  return app
}
