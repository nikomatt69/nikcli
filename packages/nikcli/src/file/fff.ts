import path from "path"
import fs from "fs/promises"
import crypto from "crypto"
import { FileFinder, type GrepOptions, type GrepResult, type SearchOptions } from "@ff-labs/fff-bun"
import { Instance } from "../project/instance"
import { Global } from "../global"
import { Log } from "../util/log"

export namespace FFF {
  const log = Log.create({ service: "fff" })

  type Ready = {
    available: true
    finder: FileFinder
  }

  type Unavailable = {
    available: false
    error: string
  }

  type Handle = Ready | Unavailable

  function projectKey(dir: string) {
    const hash = crypto.createHash("sha256").update(dir).digest("hex").slice(0, 16)
    return hash + "-" + path.basename(dir)
  }

  const state = Instance.state(
    async (): Promise<Handle> => {
      const dir = Instance.directory
      try {
        const dbDir = path.join(Global.Path.cache, "fff", projectKey(dir))
        await fs.mkdir(dbDir, { recursive: true })

        const created = FileFinder.create({
          basePath: dir,
          frecencyDbPath: path.join(dbDir, "frecency.mdb"),
          historyDbPath: path.join(dbDir, "history.mdb"),
          aiMode: true,
        })

        if (!created.ok) {
          log.warn("FileFinder.create failed", { error: created.error })
          return { available: false, error: created.error }
        }

        log.info("initialized", { dir, dbDir })
        return { available: true, finder: created.value }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn("init threw", { error: message })
        return { available: false, error: message }
      }
    },
    async (handle) => {
      if (handle.available) {
        try {
          handle.finder.destroy()
        } catch (error) {
          log.warn("destroy failed", { error })
        }
      }
    },
  )

  export async function available(): Promise<boolean> {
    return (await state()).available
  }

  async function ready(): Promise<Ready | undefined> {
    const handle = await state()
    return handle.available ? handle : undefined
  }

  // During the initial background scan an empty result is meaningless — it just
  // means "not indexed yet." Treat empty-while-scanning as undefined so the
  // caller falls back to its own (eagerly populated) data source.
  function unusableDuringWarmup(finder: FileFinder, items: unknown[]): boolean {
    return items.length === 0 && finder.isScanning()
  }

  export async function searchFiles(query: string, opts?: SearchOptions): Promise<string[] | undefined> {
    const r = await ready()
    if (!r) return undefined
    const result = r.finder.fileSearch(query, opts)
    if (!result.ok) {
      log.warn("fileSearch failed", { query, error: result.error })
      return undefined
    }
    if (unusableDuringWarmup(r.finder, result.value.items)) return undefined
    return result.value.items.map((item) => item.relativePath)
  }

  export async function searchDirs(query: string, opts?: SearchOptions): Promise<string[] | undefined> {
    const r = await ready()
    if (!r) return undefined
    const result = r.finder.directorySearch(query, opts)
    if (!result.ok) {
      log.warn("directorySearch failed", { query, error: result.error })
      return undefined
    }
    if (unusableDuringWarmup(r.finder, result.value.items)) return undefined
    return result.value.items.map((item) => item.relativePath)
  }

  export async function searchMixed(query: string, opts?: SearchOptions): Promise<string[] | undefined> {
    const r = await ready()
    if (!r) return undefined
    const result = r.finder.mixedSearch(query, opts)
    if (!result.ok) {
      log.warn("mixedSearch failed", { query, error: result.error })
      return undefined
    }
    if (unusableDuringWarmup(r.finder, result.value.items)) return undefined
    return result.value.items.map((entry) => entry.item.relativePath)
  }

  export async function grep(query: string, opts?: GrepOptions): Promise<GrepResult | undefined> {
    const r = await ready()
    if (!r) return undefined
    const result = r.finder.grep(query, opts)
    if (!result.ok) {
      log.warn("grep failed", { query, error: result.error })
      return undefined
    }
    return result.value
  }
}
