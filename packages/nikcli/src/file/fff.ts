import path from "path"
import fs from "fs/promises"
import crypto from "crypto"
import {
  Fff,
  type GrepMatch,
  type GrepOptions,
  type GrepResult,
  type MixedSearchResult,
  type Picker,
  type SearchOptions,
  type SearchResult,
} from "#fff"
import { Global } from "@nikcli-ai/util/global"
import { Log } from "@nikcli-ai/util/log"
import { FilePathFilters } from "./path-filters"
import { Instance } from "@/project/instance"

export namespace FFF {
  const log = Log.create({ service: "fff" })
  const FFF_DEFAULT_PAGE_SIZE = 500

  // ============================================
  // Input Types
  // ============================================

  export interface FilesInput {
    cwd: string
    glob?: string[]
    hidden?: boolean
    follow?: boolean
    maxDepth?: number
    limit?: number
  }

  export interface AllowedInput {
    rel: string
    file?: string
    glob?: string[]
    hidden?: boolean
  }

  // ============================================
  // Internal Helpers
  // ============================================

  type Handle =
    | {
        available: true
        finder: Picker
        /**
         * The directory the index is rooted at. Carried on the handle so
         * callers computing paths relative to it read the root the finder was
         * actually built with, instead of the ambient instance scope they
         * happen to be standing in.
         */
        root: string
      }
    | {
        available: false
        error: string
      }

  function projectKey(dir: string) {
    const hash = crypto.createHash("sha256").update(dir).digest("hex").slice(0, 16)
    return hash + "-" + path.basename(dir)
  }

  // Detect LMDB corruption by common error patterns
  function isLMDBError(error: string): boolean {
    const lmdbPatterns = [
      "MDB_INVALID",
      "MDB_CORRUPTED",
      "MDB_PANIC",
      "checksum mismatch",
      "failed to open",
      "Environment map size",
      "file is not a valid LMDB",
    ]
    return lmdbPatterns.some((p) => error.toLowerCase().includes(p.toLowerCase()))
  }

  async function resetCorruptedDB(dbDir: string): Promise<void> {
    try {
      await fs.rm(dbDir, { recursive: true, force: true })
      log.info("lmdb corruption detected, cache reset", { dbDir })
    } catch {
      // Ignore cleanup errors
    }
  }

  async function initializeHandle(dir: string): Promise<Handle> {
    try {
      const dbDir = path.join(Global.Path.cache, "fff", projectKey(dir))
      await fs.mkdir(dbDir, { recursive: true })

      const created = Fff.create({
        basePath: dir,
        frecencyDbPath: path.join(dbDir, "frecency.mdb"),
        historyDbPath: path.join(dbDir, "history.mdb"),
        aiMode: true,
      })

      if (!created.ok) {
        log.warn("Picker.create failed", { error: created.error })
        // Check if it's an LMDB corruption error - reset cache and retry once
        if (isLMDBError(created.error)) {
          log.warn("lmdb corruption detected, retrying with fresh cache")
          await resetCorruptedDB(dbDir)
          await fs.mkdir(dbDir, { recursive: true })
          const retry = Fff.create({
            basePath: dir,
            frecencyDbPath: path.join(dbDir, "frecency.mdb"),
            historyDbPath: path.join(dbDir, "history.mdb"),
            aiMode: true,
          })
          if (retry.ok) {
            log.info("lmdb recovery succeeded", { dir, dbDir })
            return { available: true, finder: retry.value, root: dir }
          }
          if (retry.ok === false && isLMDBError(retry.error)) {
            log.error("lmdb recovery failed twice, giving up", {
              error: retry.error,
            })
            return { available: false, error: retry.error }
          }
        }
        return { available: false, error: created.error }
      }

      log.info("initialized", { dir, dbDir })
      return { available: true, finder: created.value, root: dir }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Check for LMDB corruption during init
      if (isLMDBError(message)) {
        log.warn("lmdb corruption during init, resetting cache")
        const dbDir = path.join(Global.Path.cache, "fff", projectKey(dir))
        await resetCorruptedDB(dbDir)
      }
      log.warn("init threw", { error: message })
      return { available: false, error: message }
    }
  }

  /** R2 boundary: module funnel — ~15 search exports share this cell; a param on each would leave this file. */
  const state = Instance.state(
    () => initializeHandle(Instance.directory),
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

  async function ready(): Promise<{ available: true; finder: Picker; root: string } | undefined> {
    const handle = await state()
    return handle.available ? handle : undefined
  }

  // During the initial background scan results can be partial
  function isScanning(finder: Picker): boolean {
    return finder.isScanning()
  }

  export async function available(): Promise<boolean> {
    return (await state()).available
  }

  /** The directory the index is rooted at, or undefined when unavailable. */
  export async function root(): Promise<string | undefined> {
    return (await ready())?.root
  }

  export async function waitForScan(timeoutMs: number = 5000): Promise<boolean> {
    const r = await ready()
    if (!r) return false
    const result = r.finder.waitForScanBlocking(timeoutMs)
    if (!result.ok) {
      log.warn("waitForScan failed", { error: result.error })
      return false
    }
    return result.value
  }

  export async function files(input: FilesInput): Promise<string[] | undefined> {
    const r = await ready()
    if (!r) return undefined
    const prefix = await FilePathFilters.relativePrefix(r.root, input.cwd)
    if (prefix === undefined) return undefined

    const output: string[] = []
    const pageSize = Math.max(input.limit ?? FFF_DEFAULT_PAGE_SIZE, FFF_DEFAULT_PAGE_SIZE)
    for (let pageIndex = 0; ; pageIndex++) {
      const page = r.finder.fileSearch("", { pageIndex, pageSize })
      if (!page.ok) {
        log.warn("fileSearch failed", { query: "", error: page.error })
        return undefined
      }
      if (isScanning(r.finder)) return undefined
      for (const item of page.value.items) {
        const relative = item.relativePath.replaceAll("\\", "/")
        if (FilePathFilters.isGitInternal(relative)) continue
        if (prefix && !relative.startsWith(prefix)) continue
        const local = prefix ? relative.slice(prefix.length) : relative
        if (!local) continue
        if (input.hidden === false && FilePathFilters.hidden(local)) continue
        if (input.maxDepth !== undefined && FilePathFilters.depth(local) > input.maxDepth) continue
        if (!FilePathFilters.matchesGlobs(local, input.glob)) continue
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
    if (isScanning(r.finder)) return undefined
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
    if (isScanning(r.finder)) return undefined
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
    if (isScanning(r.finder)) return undefined
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
    if (isScanning(r.finder)) return undefined
    return result.value
  }

  /** Returns the raw SearchResult with scores for frecency-ranked file search. */
  export async function filesRich(query: string, opts?: SearchOptions): Promise<SearchResult | undefined> {
    const r = await ready()
    if (!r) return undefined
    const result = r.finder.fileSearch(query, opts)
    if (!result.ok) {
      log.warn("fileSearch (rich) failed", { query, error: result.error })
      return undefined
    }
    if (isScanning(r.finder)) return undefined
    return result.value
  }

  /** Returns MixedSearchResult (files + dirs interleaved by score) with git status. */
  export async function mixed(query: string, opts?: SearchOptions): Promise<MixedSearchResult | undefined> {
    const r = await ready()
    if (!r) return undefined
    const result = r.finder.mixedSearch(query, opts)
    if (!result.ok) {
      log.warn("mixedSearch (rich) failed", { query, error: result.error })
      return undefined
    }
    if (isScanning(r.finder)) return undefined
    return result.value
  }

  /**
   * Utility: check whether a relative path passes hidden/glob filters.
   * Mirrors the nikcli Fff.allowed() helper used by tools.
   */
  export function allowed(input: AllowedInput): boolean {
    const rel = input.rel.replaceAll("\\", "/")
    if (input.hidden === false) {
      const isHidden = rel.split("/").some((part) => part.startsWith(".") && part.length > 1)
      if (isHidden) return false
    }
    return FilePathFilters.matchesGlobs(rel, input.glob)
  }

  // Type aliases for convenient access from tools
  export type FileSearchResult = SearchResult
  export type MixedResult = MixedSearchResult
  export type GrepHit = GrepMatch
  export type SearchOpts = SearchOptions
  export type GrepOpts = GrepOptions
}
