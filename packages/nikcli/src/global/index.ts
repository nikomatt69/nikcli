import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"

const app = "nikcli"

// Cross-platform XDG directories - fallback to appropriate paths on Windows
function getXdgDir(xdgPath: string | undefined, fallback: string): string {
  if (process.platform === "win32") {
    // On Windows, use APPDATA for data/config and LOCALAPPDATA for cache/state
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
    if (fallback.includes("cache")) {
      return path.join(localAppData, app, "cache")
    }
    if (fallback.includes("state")) {
      return path.join(localAppData, app, "state")
    }
    return path.join(appData, app)
  }
  // On Unix, use XDG paths with proper fallbacks
  const base = xdgPath || path.join(os.homedir(), ".local", "share")
  return path.join(base, app)
}

const data = getXdgDir(xdgData, "data")
const cache = getXdgDir(xdgCache, "cache")
const config = getXdgDir(xdgConfig, "config")
const state = getXdgDir(xdgState, "state")

// Legacy path migration for Windows users
async function migrateLegacyPaths() {
  if (process.platform !== "win32") return
  if (process.env.NIKCLI_TEST_HOME) return // Skip in test mode

  const home = os.homedir()
  const MIGRATION_FLAG = ".windows-migration-v1"

  // Legacy Unix-style paths that Windows users might have
  const legacyPaths = {
    data: path.join(home, ".local", "share", app),
    config: path.join(home, ".config", app),
    cache: path.join(home, ".cache", app),
    state: path.join(home, ".local", "state", app),
  }

  const newPaths = {
    data,
    config,
    cache,
    state,
  }

  // Check if any legacy paths exist
  const legacyExists = await Promise.all(
    Object.values(legacyPaths).map(async (p) => {
      try {
        await fs.access(p)
        return true
      } catch {
        return false
      }
    }),
  )

  if (!legacyExists.some(Boolean)) return // No legacy data found

  // Check if already migrated
  const migrationMarker = path.join(data, MIGRATION_FLAG)
  try {
    await fs.access(migrationMarker)
    return // Already migrated
  } catch {
    // Continue with migration
  }

  console.debug("[global] migrating legacy Windows paths to new location...")

  // Migrate each directory
  for (const [key, legacyPath] of Object.entries(legacyPaths)) {
    const newPath = newPaths[key as keyof typeof newPaths]
    try {
      const exists = await checkPathExists(legacyPath)
      if (!exists) continue

      // Ensure new directory exists
      await fs.mkdir(newPath, { recursive: true })

      // Copy all contents
      const entries = await fs.readdir(legacyPath, { withFileTypes: true })
      for (const entry of entries) {
        const src = path.join(legacyPath, entry.name)
        const dst = path.join(newPath, entry.name)

        if (entry.isDirectory()) {
          await copyDir(src, dst)
        } else {
          await fs.copyFile(src, dst)
        }
      }

      console.debug(`[global] migrated ${key}: ${legacyPath} -> ${newPath}`)
    } catch (e) {
      console.debug(`[global] failed to migrate ${key}:`, e)
    }
  }

  // Mark migration as complete
  try {
    await Bun.write(migrationMarker, JSON.stringify({ migrated: Date.now() }))
  } catch (e) {
    console.debug("[global] failed to write migration marker:", e)
  }
}

async function checkPathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const dstPath = path.join(dst, entry.name)
    if (entry.isDirectory()) {
      await copyDir(srcPath, dstPath)
    } else {
      await fs.copyFile(srcPath, dstPath)
    }
  }
}

export namespace Global {
  export const Path = {
    get home() {
      return process.env.NIKCLI_TEST_HOME || os.homedir()
    },
    data,
    bin: path.join(data, "bin"),
    log: path.join(data, "log"),
    cache,
    config,
    state,
    get modelsDevUrl() {
      return process.env.NIKCLI_MODELS_URL || "https://models.dev"
    },
  }
}

// Run migration before setting up directories
await migrateLegacyPaths()

await Promise.all([
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
])

const CACHE_VERSION = "18"

const version = await Bun.file(path.join(Global.Path.cache, "version"))
  .text()
  .catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Global.Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch (e) {
    console.debug("[global] failed to clear cache, ignoring:", e)
  }
  await Bun.file(path.join(Global.Path.cache, "version")).write(CACHE_VERSION)
}
