import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import type { BunFile } from "bun"
import { Git } from "@/git"
import { formatPatch, structuredPatch } from "diff"
import path from "path"
import fs from "fs"
import ignore from "ignore"
import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { FFF } from "./fff"
import { SearchBackend } from "./searchBackend"
import fuzzysort from "fuzzysort"
import { Global } from "../global"
import { InstanceState } from "@/effect"
import type { InstanceContext } from "@/effect"
import { zodObject } from "@/util/effect-zod"
import { Context, Effect, Layer, Schema } from "effect"

export namespace File {
  const log = Log.create({ service: "file" })

  export const Info = z
    .object({
      path: z.string(),
      added: z.number().int(),
      removed: z.number().int(),
      status: z.enum(["added", "deleted", "modified"]),
    })
    .meta({
      ref: "File",
    })

  export type Info = z.infer<typeof Info>

  /**
   * Thrown when a caller tries to read or list a path that escapes the
   * instance directory or its worktree. Carries the resolved path that was
   * rejected for diagnostics. Tagged so the Effect channel can be narrowed
   * and call sites can use `Effect.catchTag("FileAccessDenied", ...)`.
   */
  export class AccessDeniedError extends Schema.TaggedErrorClass<AccessDeniedError>()("FileAccessDenied", {
    path: Schema.String,
    message: Schema.String,
  }) {}

  /**
   * Generic filesystem or git failure surfaced from one of the file service
   * methods. Carries the original cause so `Effect.catchTag` handlers can
   * still inspect the underlying error if needed.
   */
  export class IOError extends Schema.TaggedErrorClass<IOError>()("FileIOError", {
    message: Schema.String,
    path: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Unknown),
  }) {}

  /**
   * Union of all errors that any `File.Service` method can fail with.
   * Use this in downstream Effect error channels so the channel is narrowed
   * from `unknown` to a tagged union instead of an opaque error blob.
   */
  export type Error = AccessDeniedError | IOError

  const NodeSchema = Schema.Struct({
    name: Schema.String,
    path: Schema.String,
    absolute: Schema.String,
    type: Schema.Literals(["file", "directory"]),
    ignored: Schema.Boolean,
  }).annotate({ identifier: "FileNode" })
  export const Node = zodObject(NodeSchema)
  export type Node = Schema.Schema.Type<typeof NodeSchema>

  const ContentSchema = Schema.Struct({
    type: Schema.Literal("text"),
    content: Schema.String,
    diff: Schema.optional(Schema.String),
    patch: Schema.optional(
      Schema.Struct({
        oldFileName: Schema.String,
        newFileName: Schema.String,
        oldHeader: Schema.optional(Schema.String),
        newHeader: Schema.optional(Schema.String),
        hunks: Schema.Array(
          Schema.Struct({
            oldStart: Schema.Number,
            oldLines: Schema.Number,
            newStart: Schema.Number,
            newLines: Schema.Number,
            lines: Schema.Array(Schema.String),
          }),
        ),
        index: Schema.optional(Schema.String),
      }),
    ),
    encoding: Schema.optional(Schema.Literal("base64")),
    mimeType: Schema.optional(Schema.String),
  }).annotate({ identifier: "FileContent" })
  export const Content = zodObject(ContentSchema)
  export type Content = Schema.Schema.Type<typeof ContentSchema>

  async function shouldEncode(file: BunFile): Promise<boolean> {
    const type = file.type?.toLowerCase()
    log.info("shouldEncode", { type })
    if (!type) return false

    if (type.startsWith("text/")) return false
    if (type.includes("charset=")) return false

    const parts = type.split("/", 2)
    const top = parts[0]
    const rest = parts[1] ?? ""
    const sub = rest.split(";", 1)[0]

    const tops = ["image", "audio", "video", "font", "model", "multipart"]
    if (tops.includes(top)) return true

    const bins = [
      "zip",
      "gzip",
      "bzip",
      "compressed",
      "binary",
      "pdf",
      "msword",
      "powerpoint",
      "excel",
      "ogg",
      "exe",
      "dmg",
      "iso",
      "rar",
    ]
    if (bins.some((mark) => sub.includes(mark))) return true

    return false
  }

  async function countLines(filepath: string) {
    const content = await fs.promises.readFile(filepath)
    if (content.length === 0) return 0

    let lines = 0
    for (const byte of content) {
      if (byte === 10) lines++
    }

    if (content[content.length - 1] !== 10) {
      lines++
    }

    return lines
  }

  export const Event = {
    Edited: BusEvent.define(
      "file.edited",
      z.object({
        file: z.string(),
      }),
    ),
  }

  type Entry = { files: string[]; dirs: string[] }
  type State = {
    context: InstanceContext
    files(): Promise<Entry>
    cachedFiles(): Entry | undefined
    ignoreCache?: {
      worktree: string
      ignored: (path: string) => boolean
    }
  }

  export interface Interface {
    init(): Effect.Effect<void, Error>
    status(): Effect.Effect<Info[], Error>
    read(file: string): Effect.Effect<Content, Error>
    list(dir?: string): Effect.Effect<Node[], Error>
    search(input: {
      query: string
      limit?: number
      dirs?: boolean
      type?: "file" | "directory"
    }): Effect.Effect<string[], Error>
  }

  export class Service extends Context.Service<Service, Interface>()("File.Service") {}

  /**
   * Map an arbitrary error thrown by a file service implementation into the
   * `File.Error` union. The pre-tagged error classes pass through unchanged so
   * `Effect.catchTag` can still match them; everything else collapses to
   * `IOError` with the original cause preserved.
   */
  function mapError(e: unknown): Error {
    if (e instanceof AccessDeniedError) return e
    if (e instanceof IOError) return e
    if (e instanceof Error) {
      return new IOError({
        message: e.message,
        cause: e,
      })
    }
    return new IOError({ message: String(e) })
  }

  const state = InstanceState.make<State>((ctx) =>
    Effect.gen(function* () {
      let cache: Entry = { files: [], dirs: [] }
      let cacheReady = false
      let fetching = false

      const isGlobalHome = ctx.directory === Global.Path.home && ctx.project.id === "global"

      const fn = async (result: Entry) => {
        // Disable scanning if in root of file system
        if (ctx.directory === path.parse(ctx.directory).root) return
        fetching = true

        if (isGlobalHome) {
          const dirs = new Set<string>()
          const ignore = new Set<string>()

          if (process.platform === "darwin") ignore.add("Library")
          if (process.platform === "win32") ignore.add("AppData")

          const ignoreNested = new Set(["node_modules", "dist", "build", "target", "vendor"])
          const shouldIgnore = (name: string) => name.startsWith(".") || ignore.has(name)
          const shouldIgnoreNested = (name: string) => name.startsWith(".") || ignoreNested.has(name)

          const top = await fs.promises.readdir(ctx.directory, { withFileTypes: true }).catch(() => [] as fs.Dirent[])

          for (const entry of top) {
            if (!entry.isDirectory()) continue
            if (shouldIgnore(entry.name)) continue
            dirs.add(entry.name + "/")

            const base = path.join(ctx.directory, entry.name)
            const children = await fs.promises.readdir(base, { withFileTypes: true }).catch(() => [] as fs.Dirent[])
            for (const child of children) {
              if (!child.isDirectory()) continue
              if (shouldIgnoreNested(child.name)) continue
              dirs.add(entry.name + "/" + child.name + "/")
            }
          }

          result.dirs = Array.from(dirs).toSorted()
          cache = result
          cacheReady = true
          fetching = false
          return
        }

        const set = new Set<string>()
        const fffFiles = await FFF.files({
          cwd: ctx.directory,
          hidden: true,
          limit: 100000,
        })
        const files =
          fffFiles ??
          (
            await SearchBackend.fileList({
              cwd: ctx.directory,
              hidden: true,
              limit: 100000,
              prefer: "rg",
            }).catch((error) => {
              log.warn("file cache ripgrep fallback failed", { error })
              return SearchBackend.fileList({
                cwd: ctx.directory,
                hidden: true,
                limit: 100000,
                prefer: "bun",
              })
            })
          ).files
        for (const file of files) {
          result.files.push(file)
          let current = file
          while (true) {
            const dir = path.dirname(current)
            if (dir === ".") break
            if (dir === current) break
            current = dir
            if (set.has(dir)) continue
            set.add(dir)
            result.dirs.push(dir + "/")
          }
        }
        cache = result
        cacheReady = true
        fetching = false
      }
      const refresh = (result: Entry) => {
        fn(result).catch((error) => {
          fetching = false
          log.warn("file cache refresh failed", { error })
        })
      }

      refresh(cache)

      return {
        context: ctx,
        async files() {
          if (!fetching) {
            refresh({
              files: [],
              dirs: [],
            })
          }
          return cache
        },
        cachedFiles() {
          return cacheReady ? cache : undefined
        },
      }
    }),
  )

  function containsPath(ctx: InstanceContext, filepath: string) {
    try {
      const canonicalInstance = fs.realpathSync(ctx.directory)
      const canonicalWorktree = ctx.worktree === "/" ? "/" : fs.realpathSync(ctx.worktree)
      const canonicalPath = Filesystem.canonicalizePath(filepath)
      if (Filesystem.contains(canonicalInstance, canonicalPath)) return true
      if (canonicalWorktree === "/") return false
      return Filesystem.contains(canonicalWorktree, canonicalPath)
    } catch {
      return false
    }
  }

  async function statusImpl(ctx: InstanceContext) {
    const project = ctx.project
    if (project.vcs !== "git") return []

    const cwd = ctx.directory
    const [hasHead, list] = await Promise.all([Git.hasHead(cwd), Git.status(cwd)])
    const stats = hasHead ? await Git.stats(cwd, "HEAD") : []
    const statsByFile = new Map(stats.map((s) => [s.file, s]))

    const changedFiles: Info[] = []

    for (const item of list) {
      if (item.code === "??") {
        try {
          const fullPath = path.join(ctx.directory, item.file)
          const stat = await fs.promises.lstat(fullPath)
          let lines = 0

          if (stat.isSymbolicLink()) {
            const target = await fs.promises.readlink(fullPath)
            lines = target.length === 0 ? 0 : target.split(/\r\n|\r|\n/).length
          } else {
            if (!stat.isFile()) continue
            if (!containsPath(ctx, fullPath)) continue
            lines = await countLines(fullPath)
          }

          changedFiles.push({
            path: item.file,
            added: lines,
            removed: 0,
            status: "added",
          })
        } catch {
          continue
        }
        continue
      }

      const num = statsByFile.get(item.file)
      changedFiles.push({
        path: item.file,
        added: num?.additions ?? 0,
        removed: num?.deletions ?? 0,
        status: item.status,
      })
    }

    return changedFiles.map((x) => ({
      ...x,
      path: path.isAbsolute(x.path) ? path.relative(ctx.directory, x.path) : x.path,
    }))
  }

  async function readImpl(ctx: InstanceContext, file: string): Promise<Content> {
    using _ = log.time("read", { file })
    const project = ctx.project
    const full = path.isAbsolute(file) ? path.normalize(file) : path.join(ctx.directory, file)

    // TODO: Filesystem.contains is lexical only - symlinks inside the project can escape.
    // TODO: On Windows, cross-drive paths bypass this check. Consider realpath canonicalization.
    if (!containsPath(ctx, full)) {
      throw new AccessDeniedError({
        path: full,
        message: "Access denied: path escapes project directory",
      })
    }

    const bunFile = Bun.file(full)

    if (!(await bunFile.exists())) {
      return { type: "text", content: "" }
    }

    const encode = await shouldEncode(bunFile)

    if (encode) {
      const buffer = await bunFile.arrayBuffer().catch(() => new ArrayBuffer(0))
      const content = Buffer.from(buffer).toString("base64")
      const mimeType = bunFile.type || "application/octet-stream"
      return { type: "text", content, mimeType, encoding: "base64" }
    }

    const content = await bunFile
      .text()
      .catch(() => "")
      .then((x) => x.trim())

    if (project.vcs === "git") {
      const cwd = ctx.directory
      const [unstagedDiff, stagedDiff] = await Promise.all([
        Git.diffFile(cwd, file, false),
        Git.diffFile(cwd, file, true),
      ])
      const diff = unstagedDiff.trim() ? unstagedDiff : stagedDiff
      if (diff.trim()) {
        const original = await Git.show(cwd, "HEAD", file)
        const patch = structuredPatch(file, file, original, content, "old", "new", {
          context: Infinity,
          ignoreWhitespace: true,
        })
        const diff = formatPatch(patch)
        return { type: "text", content, patch, diff }
      }
    }
    return { type: "text", content }
  }

  async function listImpl(s: State, dir?: string) {
    const ctx = s.context
    const exclude = [".git", ".DS_Store"]
    const project = ctx.project
    let ignored = (_: string) => false
    if (project.vcs === "git") {
      if (!s.ignoreCache || s.ignoreCache.worktree !== ctx.worktree) {
        const ig = ignore()
        const gitignore = Bun.file(path.join(ctx.worktree, ".gitignore"))
        if (await gitignore.exists()) {
          ig.add(await gitignore.text())
        }
        const ignoreFile = Bun.file(path.join(ctx.worktree, ".ignore"))
        if (await ignoreFile.exists()) {
          ig.add(await ignoreFile.text())
        }
        s.ignoreCache = {
          worktree: ctx.worktree,
          ignored: ig.ignores.bind(ig),
        }
      }
      ignored = s.ignoreCache.ignored
    }
    const resolved = dir ? (path.isAbsolute(dir) ? path.normalize(dir) : path.join(ctx.directory, dir)) : ctx.directory

    // TODO: Filesystem.contains is lexical only - symlinks inside the project can escape.
    // TODO: On Windows, cross-drive paths bypass this check. Consider realpath canonicalization.
    if (!containsPath(ctx, resolved)) {
      throw new AccessDeniedError({
        path: resolved,
        message: "Access denied: path escapes project directory",
      })
    }

    const nodes: Node[] = []
    for (const entry of await fs.promises
      .readdir(resolved, {
        withFileTypes: true,
      })
      .catch(() => [])) {
      if (exclude.includes(entry.name)) continue
      const fullPath = path.join(resolved, entry.name)
      const relativePath = path.relative(ctx.directory, fullPath)
      const type = entry.isDirectory() ? "directory" : "file"
      nodes.push({
        name: entry.name,
        path: relativePath,
        absolute: fullPath,
        type,
        ignored: ignored(type === "directory" ? relativePath + "/" : relativePath),
      })
    }
    return nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  }

  function searchHidden(item: string) {
    const normalized = item.replaceAll("\\", "/").replace(/\/+$/, "")
    return normalized.split("/").some((p) => p.startsWith(".") && p.length > 1)
  }

  function sortSearchHiddenLast(items: string[], preferHidden: boolean) {
    if (preferHidden) return items
    const visible: string[] = []
    const hiddenItems: string[] = []
    for (const item of items) {
      const isHidden = searchHidden(item)
      if (isHidden) hiddenItems.push(item)
      if (!isHidden) visible.push(item)
    }
    return [...visible, ...hiddenItems]
  }

  function fuzzysortSearch(
    result: Entry,
    query: string,
    limit: number,
    kind: "file" | "directory" | "all",
    preferHidden: boolean,
  ) {
    if (!query) {
      if (kind === "file") return result.files.slice(0, limit)
      return sortSearchHiddenLast(result.dirs.toSorted(), preferHidden).slice(0, limit)
    }

    const items =
      kind === "file" ? result.files : kind === "directory" ? result.dirs : [...result.files, ...result.dirs]

    const searchLimit = kind === "directory" && !preferHidden ? limit * 20 : limit
    const sorted = fuzzysort.go(query, items, { limit: searchLimit }).map((r) => r.target)
    return kind === "directory" ? sortSearchHiddenLast(sorted, preferHidden).slice(0, limit) : sorted
  }

  async function fileCacheForSearch(s: State): Promise<Entry> {
    const cached = s.cachedFiles()
    if (cached) return cached

    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const ready = s.cachedFiles()
      if (ready) return ready
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    const afterWait = s.cachedFiles()
    if (afterWait) return afterWait
    return s.files()
  }

  async function searchImpl(
    s: State,
    input: {
      query: string
      limit?: number
      dirs?: boolean
      type?: "file" | "directory"
    },
  ) {
    const query = input.query.trim()
    const limit = input.limit ?? 100
    const kind = input.type ?? (input.dirs === false ? "file" : "all")
    log.info("search", { query, kind })

    const preferHidden = query.startsWith(".") || query.includes("/.")

    const fffResult = await (async () => {
      if (kind === "file") return FFF.searchFiles(query, { pageSize: limit })
      if (kind === "directory") {
        // Over-fetch like the fuzzysort path so sortHiddenLast has headroom
        // before truncation; matches the original `limit * 20` behavior.
        const fetchSize = preferHidden ? limit : limit * 20
        const dirs = await FFF.searchDirs(query, { pageSize: fetchSize })
        if (!dirs) return undefined
        if (preferHidden) return dirs.slice(0, limit)
        const ordered = query
          ? sortSearchHiddenLast(dirs, preferHidden)
          : sortSearchHiddenLast(dirs.toSorted(), preferHidden)
        return ordered.slice(0, limit)
      }
      return FFF.searchMixed(query, { pageSize: limit })
    })().catch((error) => {
      log.warn("fff search threw, falling back", { error })
      return undefined
    })

    if (fffResult) {
      log.info("search", {
        query,
        kind,
        results: fffResult.length,
        backend: "fff",
      })
      return fffResult
    }

    const result = await fileCacheForSearch(s)
    const output = fuzzysortSearch(result, query, limit, kind, preferHidden)

    log.info("search", {
      query,
      kind,
      results: output.length,
      backend: "fuzzysort",
    })
    return output
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const scopedState = yield* state

      const init = Effect.fn("File.init")(function* () {
        yield* InstanceState.get(scopedState)
      })

      const status = Effect.fn("File.status")(function* () {
        const s = yield* InstanceState.get(scopedState)
        return yield* Effect.tryPromise({
          try: () => statusImpl(s.context),
          catch: mapError,
        })
      })

      const read = Effect.fn("File.read")(function* (file: string) {
        const s = yield* InstanceState.get(scopedState)
        return yield* Effect.tryPromise({
          try: () => readImpl(s.context, file),
          catch: mapError,
        })
      })

      const list = Effect.fn("File.list")(function* (dir?: string) {
        const s = yield* InstanceState.get(scopedState)
        return yield* Effect.tryPromise({
          try: () => listImpl(s, dir),
          catch: mapError,
        })
      })

      const search = Effect.fn("File.search")(function* (input: {
        query: string
        limit?: number
        dirs?: boolean
        type?: "file" | "directory"
      }) {
        const s = yield* InstanceState.get(scopedState)
        return yield* Effect.tryPromise({
          try: () => searchImpl(s, input),
          catch: mapError,
        })
      })

      return Service.of({
        init,
        status,
        read,
        list,
        search,
      })
    }),
  )

  export const defaultLayer = layer
}
