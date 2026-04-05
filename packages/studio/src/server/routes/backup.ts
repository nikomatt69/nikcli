import { Hono } from "hono"
import fs from "fs"
import path from "path"
import os from "os"
import { getNikcliConfigPath } from "../config-loader"
import { atomicWriteFileSync } from "../atomic"

const HOME_DIR = os.homedir()
const BACKUP_DIR = path.join(HOME_DIR, ".config", "nikcli-studio", "backups")

export function BackupRoutes() {
  const app = new Hono()

  app.get("/", (c) => {
    if (!fs.existsSync(BACKUP_DIR)) return c.json({ backups: [] })
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith("-manifest.json"))
      .map((f) => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f))
        return { name: f.replace("-manifest.json", ""), date: stat.mtime.toISOString() }
      })
      .sort((a, b) => b.date.localeCompare(a.date))
    return c.json({ backups: files })
  })

  app.post("/create", async (c) => {
    const { name } = await c.req.json<{ name?: string }>()
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const backupName = name || `backup-${timestamp}`

    const manifest: Record<string, any> = {
      version: "1.0",
      created: new Date().toISOString(),
      nikcli: getNikcliConfigPath(),
    }

    try {
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true })
      const manifestPath = path.join(BACKUP_DIR, `${backupName}-manifest.json`)
      atomicWriteFileSync(manifestPath, JSON.stringify(manifest, null, 2))
      return c.json({ success: true, path: manifestPath, name: backupName })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  app.get("/list", (c) => {
    if (!fs.existsSync(BACKUP_DIR)) return c.json({ backups: [] })
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith("-manifest.json"))
      .map((f) => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f))
        return { name: f.replace("-manifest.json", ""), date: stat.mtime.toISOString() }
      })
      .sort((a, b) => b.date.localeCompare(a.date))
    return c.json({ backups: files })
  })

  app.get("/:name", (c) => {
    const { name } = c.req.param()
    const manifestPath = path.join(BACKUP_DIR, `${name}-manifest.json`)
    if (!fs.existsSync(manifestPath)) return c.json({ error: "Backup not found" }, 404)
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
      return c.json(manifest)
    } catch {
      return c.json({ error: "Failed to read backup" }, 500)
    }
  })

  app.delete("/:name", (c) => {
    const { name } = c.req.param()
    const manifestPath = path.join(BACKUP_DIR, `${name}-manifest.json`)
    if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath)
    return c.json({ success: true })
  })

  return app
}
