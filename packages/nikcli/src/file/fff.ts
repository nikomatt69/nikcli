import path from "path"
import fs from "fs/promises"
import crypto from "crypto"
import { FileFinder, type GrepOptions, type GrepResult, type SearchOptions } from "@ff-labs/fff-bun"
import { minimatch } from "minimatch"
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

  export async function waitForScan(timeoutMs: number = 5000): Promise<boolean> {
    const r = await ready()
    if (!r) return false
    const result = r.finder.waitForScan(timeoutMs)
    if (!result.ok) {
      log.warn("waitForScan failed", { error: result.error })
      return false
    }
    return result.value
  }

  async function ready(): Promise<Ready | undefined> {
    const handle = await state()
    return handle.available ? handle : undefined
  }

  // During the initial background scan results can be partial, so callers must
  // use their eager fallback until FFF has a complete index.
  function unusableDuringWarmup(finder: FileFinder, items: unknown[]): boolean {
    void items
    return finder.isScanning()
  }

  function hidden(item: string): boolean {
    return item
      .replaceAll("\\", "/")
      .split("/")
      .some((part) => part.startsWith(".") && part.length > 1)
  }

  function depth(item: string): number {
    return item.replaceAll("\\", "/").split("/").filter(Boolean).length
  }

  function globPatterns(pattern: string): string[] {
    const normalized = pattern.replaceAll("\\", "/")
    return [normalized]
  }

  function matchesGlob(item: string, pattern: string): boolean {
    const normalized = item.replaceAll("\\", "/")
    return globPatterns(pattern).some((candidate) =>
      minimatch(normalized, candidate, {
        dot: true,
        matchBase: !candidate.includes("/"),
      }),
    )
  }

  function matchesGlobs(item: string, globs: string[] | undefined): boolean {
    if (!globs?.length) return true
    let included = !globs.some((glob) => !glob.startsWith("!"))
    for (const glob of globs) {
      if (!glob) continue
      const excluded = glob.startsWith("!")
      const pattern = excluded ? glob.slice(1) : glob
      if (!pattern) continue
      if (!matchesGlob(item, pattern)) continue
      if (excluded) return false
      included = true
    }
    return included
  }

  async function relativePrefix(cwd: string): Promise<string | undefined> {
    const base = await fs.realpath(Instance.directory).catch(() => Instance.directory)
    const target = await fs.realpath(cwd).catch(() => path.resolve(cwd))
    const relative = path.relative(base, target).replaceAll(path.sep, "/")
    if (relative === "") return ""
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined
    return relative.endsWith("/") ? relative : `${relative}/`
  }

  export async function files(input: {
    cwd: string
    glob?: string[]
    hidden?: boolean
    follow?: boolean
    maxDepth?: number
    limit?: number
  }): Promise<string[] | undefined> {
    if (input.follow === false) return undefined
    if (input.hidden !== false) return undefined
    const r = await ready()
    if (!r) return undefined
    const prefix = await relativePrefix(input.cwd)
    if (prefix === undefined) return undefined

    const output: string[] = []
    const pageSize = Math.max(input.limit ?? 500, 500)
    for (let pageIndex = 0; ; pageIndex++) {
      const page = r.finder.fileSearch("", { pageIndex, pageSize })
      if (!page.ok) {
        log.warn("fileSearch failed", { query: "", error: page.error })
        return undefined
      }
      if (unusableDuringWarmup(r.finder, page.value.items)) return undefined
      for (const item of page.value.items) {
        const relative = item.relativePath.replaceAll("\\", "/")
        if (relative === ".git" || relative.startsWith(".git/")) continue
        if (prefix && !relative.startsWith(prefix)) continue
        const local = prefix ? relative.slice(prefix.length) : relative
        if (!local) continue
        if (input.hidden === false && hidden(local)) continue
        if (input.maxDepth !== undefined && depth(local) > input.maxDepth) continue
        if (!matchesGlobs(local, input.glob)) continue
        output.push(local)
        if (input.limit && output.length >= input.limit) return output
      }
      const seen = (pageIndex + 1) * pageSize
      const total = Math.max(page.value.totalFiles, page.value.totalMatched, page.value.items.length)
      if (page.value.items.length === 0 || seen >= total) break
    }
    return output
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
    if (unusableDuringWarmup(r.finder, result.value.items)) return undefined
    return result.value
  }
}
