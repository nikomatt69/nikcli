import { Hono } from "hono"
import fs from "fs"
import path from "path"
import os from "os"
import { getNikcliConfigPath } from "../config-loader"
import { atomicWriteFileSync } from "../atomic"

const HOME_DIR = os.homedir()
const BACKUP_DIR = path.join(HOME_DIR, ".config", "nikcli-studio", "backups")

type BackupManifest = {
  version: string
  createdAt: string
  configPath: string
  snapshotFile: string
  size: number
}

type BackupSummary = {
  name: string
  createdAt: string
  size: number
}

function manifestPath(name: string) {
  return path.join(BACKUP_DIR, `${name}-manifest.json`)
}

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true })
}

function readManifest(name: string): BackupManifest | null {
  const filePath = manifestPath(name)
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as BackupManifest
  } catch {
    return null
  }
}

function listBackups(): BackupSummary[] {
  if (!fs.existsSync(BACKUP_DIR)) return []
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((file) => file.endsWith("-manifest.json"))
    .map((file) => {
      const name = file.replace("-manifest.json", "")
      const manifest = readManifest(name)
      if (!manifest) return null
      return {
        name,
        createdAt: manifest.createdAt,
        size: manifest.size,
      }
    })
    .filter((item): item is BackupSummary => item !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function BackupRoutes() {
  const app = new Hono()

  app.get("/", (c) => {
    return c.json({ backups: listBackups() })
  })

  app.post("/create", async (c) => {
    const { name } = await c.req.json<{ name?: string }>()
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const backupName = name || `backup-${timestamp}`

    try {
      const configPath = getNikcliConfigPath()
      if (!configPath || !fs.existsSync(configPath)) {
        return c.json({ error: "No nikcli config found to back up" }, 404)
      }

      ensureBackupDir()
      const configContent = fs.readFileSync(configPath, "utf8")
      const ext = path.extname(configPath) || ".json"
      const snapshotFile = `${backupName}-config${ext}`
      const snapshotPath = path.join(BACKUP_DIR, snapshotFile)
      const createdAt = new Date().toISOString()
      const manifest: BackupManifest = {
        version: "1.0",
        createdAt,
        configPath,
        snapshotFile,
        size: Buffer.byteLength(configContent),
      }

      atomicWriteFileSync(snapshotPath, configContent)
      atomicWriteFileSync(manifestPath(backupName), JSON.stringify(manifest, null, 2))
      return c.json({ success: true, name: backupName, createdAt, size: manifest.size })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  app.get("/list", (c) => {
    return c.json({ backups: listBackups() })
  })

  app.post("/restore", async (c) => {
    const { name } = await c.req.json<{ name: string }>()
    if (!name) return c.json({ error: "Backup name required" }, 400)

    const manifest = readManifest(name)
    if (!manifest) return c.json({ error: "Backup not found" }, 404)

    const snapshotPath = path.join(BACKUP_DIR, manifest.snapshotFile)
    if (!fs.existsSync(snapshotPath)) return c.json({ error: "Backup snapshot not found" }, 404)

    const targetPath = getNikcliConfigPath() || manifest.configPath
    if (!targetPath) return c.json({ error: "No nikcli config path available for restore" }, 500)

    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      const snapshot = fs.readFileSync(snapshotPath, "utf8")
      atomicWriteFileSync(targetPath, snapshot)
      return c.json({ success: true, path: targetPath })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  app.get("/:name", (c) => {
    const { name } = c.req.param()
    const manifest = readManifest(name)
    if (!manifest) return c.json({ error: "Backup not found" }, 404)
    return c.json(manifest)
  })

  app.delete("/:name", (c) => {
    const { name } = c.req.param()
    const manifest = readManifest(name)
    const filePath = manifestPath(name)
    if (manifest?.snapshotFile) {
      const snapshotPath = path.join(BACKUP_DIR, manifest.snapshotFile)
      if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath)
    }
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    return c.json({ success: true })
  })

  return app
}
