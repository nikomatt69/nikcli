import path from "path"
import fs from "fs/promises"
import crypto from "crypto"
import { Context, Effect, Layer, Schema } from "effect"
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
import { minimatch } from "minimatch"
import { Instance } from "../project/instance"
import { Global } from "../global"
import { Log } from "../util/log"
import { instance, type InstanceContext } from "@/effect/instance-ref"

export namespace FFF {
  const log = Log.create({ service: "fff" })

  // ============================================
  // Error Types
  // ============================================

  export class FFFError extends Schema.TaggedErrorClass<FFFError>()("FFFError", {
    reason: Schema.String,
  }) {
    override get message() {
      return this.reason
    }
  }

  export class FFFNotReadyError extends Schema.TaggedErrorClass<FFFNotReadyError>()("FFFNotReadyError", {}) {
    override get message() {
      return "FFF Picker is not ready"
    }
  }

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
  // Service Interface
  // ============================================

  export type AnyFFFError = FFFError | FFFNotReadyError

  export interface Interface {
    readonly available: Effect.Effect<boolean>
    readonly waitForScan: (timeoutMs?: number) => Effect.Effect<boolean>
    readonly files: (input: FilesInput) => Effect.Effect<string[], AnyFFFError>
    readonly searchFiles: (query: string, opts?: SearchOptions) => Effect.Effect<string[], AnyFFFError>
    readonly searchDirs: (query: string, opts?: SearchOptions) => Effect.Effect<string[], AnyFFFError>
    readonly searchMixed: (query: string, opts?: SearchOptions) => Effect.Effect<string[], AnyFFFError>
    readonly grep: (query: string, opts?: GrepOptions) => Effect.Effect<GrepResult, AnyFFFError>
    readonly filesRich: (query: string, opts?: SearchOptions) => Effect.Effect<SearchResult, AnyFFFError>
    readonly mixed: (query: string, opts?: SearchOptions) => Effect.Effect<MixedSearchResult, AnyFFFError>
    readonly allowed: (input: AllowedInput) => Effect.Effect<boolean>
  }

  export class Service extends Context.Service<Service, Interface>()("FFF.Service") {}

  // ============================================
  // Internal Helpers
  // ============================================

  type Handle =
    | {
        available: true
        finder: Picker
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

  async function initializeHandle(ctx: InstanceContext): Promise<Handle> {
    const dir = ctx.directory
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
            return { available: true, finder: retry.value }
          }
          if (retry.ok === false && isLMDBError(retry.error)) {
            log.error("lmdb recovery failed twice, giving up", { error: retry.error })
            return { available: false, error: retry.error }
          }
        }
        return { available: false, error: created.error }
      }

      log.info("initialized", { dir, dbDir })
      return { available: true, finder: created.value }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Check for LMDB corruption during init
      if (isLMDBError(message)) {
        log.warn("lmdb corruption during init, resetting cache")
        const dbDir = path.join(Global.Path.cache, "fff", projectKey(ctx.directory))
        await resetCorruptedDB(dbDir)
      }
      log.warn("init threw", { error: message })
      return { available: false, error: message }
    }
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

  function matchesGlob(item: string, pattern: string): boolean {
    const normalized = item.replaceAll("\\", "/")
    return minimatch(normalized, pattern, {
      dot: true,
      matchBase: !pattern.includes("/"),
    })
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
    let base: string
    try {
      base = await fs.realpath(Instance.directory).catch(() => Instance.directory)
    } catch {
      return undefined
    }
    const target = await fs.realpath(cwd).catch(() => path.resolve(cwd))
    const relative = path.relative(base, target).replaceAll(path.sep, "/")
    if (relative === "") return ""
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined
    return relative.endsWith("/") ? relative : `${relative}/`
  }

  // ============================================
  // Layer Implementation
  // ============================================

  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const ctx = yield* instance
      const handle = yield* Effect.tryPromise({
        try: () => initializeHandle(ctx),
        catch: (e) => new FFFError({ reason: e instanceof Error ? e.message : String(e) }),
      })

      if (!handle.available) {
        return yield* Effect.fail(new FFFNotReadyError())
      }

      const finder = handle.finder

      const svc: Interface = {
        available: Effect.succeed(true),

        waitForScan: (timeoutMs = 5000) =>
          Effect.sync(() => {
            const result = finder.waitForScanBlocking(timeoutMs)
            return result.ok && result.value
          }),

        files: (input) =>
          Effect.gen(function* () {
            const prefix = yield* Effect.tryPromise({
              try: () => relativePrefix(input.cwd),
              catch: (e) => new FFFError({ reason: e instanceof Error ? e.message : String(e) }),
            })
            if (prefix === undefined) return []

            const output: string[] = []
            const pageSize = Math.max(input.limit ?? 500, 500)

            for (let pageIndex = 0; ; pageIndex++) {
              const page = finder.fileSearch("", { pageIndex, pageSize })
              if (!page.ok) {
                log.warn("fileSearch failed", { query: "", error: page.error })
                return yield* Effect.fail(new FFFError({ reason: `fileSearch failed: ${page.error}` }))
              }
              if (finder.isScanning()) {
                return yield* Effect.fail(new FFFNotReadyError())
              }
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
          }),

        searchFiles: (query, opts) =>
          Effect.gen(function* () {
            const result = finder.fileSearch(query, opts)
            if (!result.ok) {
              log.warn("fileSearch failed", { query, error: result.error })
              return yield* Effect.fail(new FFFError({ reason: `fileSearch failed: ${result.error}` }))
            }
            if (finder.isScanning()) {
              return yield* Effect.fail(new FFFNotReadyError())
            }
            return result.value.items.map((item) => item.relativePath)
          }),

        searchDirs: (query, opts) =>
          Effect.gen(function* () {
            const result = finder.directorySearch(query, opts)
            if (!result.ok) {
              log.warn("directorySearch failed", { query, error: result.error })
              return yield* Effect.fail(new FFFError({ reason: `directorySearch failed: ${result.error}` }))
            }
            if (finder.isScanning()) {
              return yield* Effect.fail(new FFFNotReadyError())
            }
            return result.value.items.map((item) => item.relativePath)
          }),

        searchMixed: (query, opts) =>
          Effect.gen(function* () {
            const result = finder.mixedSearch(query, opts)
            if (!result.ok) {
              log.warn("mixedSearch failed", { query, error: result.error })
              return yield* Effect.fail(new FFFError({ reason: `mixedSearch failed: ${result.error}` }))
            }
            if (finder.isScanning()) {
              return yield* Effect.fail(new FFFNotReadyError())
            }
            return result.value.items.map((entry) => entry.item.relativePath)
          }),

        grep: (query, opts) =>
          Effect.gen(function* () {
            const result = finder.grep(query, opts)
            if (!result.ok) {
              log.warn("grep failed", { query, error: result.error })
              return yield* Effect.fail(new FFFError({ reason: `grep failed: ${result.error}` }))
            }
            if (finder.isScanning()) {
              return yield* Effect.fail(new FFFNotReadyError())
            }
            return result.value
          }),

        filesRich: (query, opts) =>
          Effect.gen(function* () {
            const result = finder.fileSearch(query, opts)
            if (!result.ok) {
              log.warn("fileSearch (rich) failed", { query, error: result.error })
              return yield* Effect.fail(new FFFError({ reason: `fileSearch failed: ${result.error}` }))
            }
            if (finder.isScanning()) {
              return yield* Effect.fail(new FFFNotReadyError())
            }
            return result.value
          }),

        mixed: (query, opts) =>
          Effect.gen(function* () {
            const result = finder.mixedSearch(query, opts)
            if (!result.ok) {
              log.warn("mixedSearch (rich) failed", { query, error: result.error })
              return yield* Effect.fail(new FFFError({ reason: `mixedSearch failed: ${result.error}` }))
            }
            if (finder.isScanning()) {
              return yield* Effect.fail(new FFFNotReadyError())
            }
            return result.value
          }),

        allowed: (input) =>
          Effect.sync(() => {
            const rel = input.rel.replaceAll("\\", "/")
            const file = input.file ?? rel.split("/").at(-1) ?? rel
            if (input.hidden === false) {
              const isHidden = rel.split("/").some((part) => part.startsWith(".") && part.length > 1)
              if (isHidden) return false
            }
            return matchesGlobs(rel, input.glob)
          }),
      }

      return Service.of(svc)
    }),
  )

  export const defaultLayer = layer

  // ============================================
  // Backward Compatibility (Legacy API)
  // ============================================

  // Uses the same state pattern as before for backward compatibility
  const state = Instance.state(
    async (): Promise<Handle> => {
      const dir = Instance.directory
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
              return { available: true, finder: retry.value }
            }
            if (retry.ok === false && isLMDBError(retry.error)) {
              log.error("lmdb recovery failed twice, giving up", { error: retry.error })
              return { available: false, error: retry.error }
            }
          }
          return { available: false, error: created.error }
        }

        log.info("initialized", { dir, dbDir })
        return { available: true, finder: created.value }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (isLMDBError(message)) {
          log.warn("lmdb corruption during init, resetting cache")
          const dbDir = path.join(Global.Path.cache, "fff", projectKey(Instance.directory))
          await resetCorruptedDB(dbDir)
        }
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

  async function ready(): Promise<{ available: true; finder: Picker } | undefined> {
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
      if (isScanning(r.finder)) return undefined
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
    const file = input.file ?? rel.split("/").at(-1) ?? rel
    if (input.hidden === false) {
      const isHidden = rel.split("/").some((part) => part.startsWith(".") && part.length > 1)
      if (isHidden) return false
    }
    return matchesGlobs(rel, input.glob)
  }

  // Type aliases for convenient access from tools
  export type FileSearchResult = SearchResult
  export type MixedResult = MixedSearchResult
  export type GrepHit = GrepMatch
  export type SearchOpts = SearchOptions
  export type GrepOpts = GrepOptions
}
