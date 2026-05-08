import { BusEvent } from "@/bus/bus-event"
import { $ } from "bun"
import type { BunFile } from "bun"
import { formatPatch, structuredPatch } from "diff"
import path from "path"
import fs from "fs"
import ignore from "ignore"
import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { SearchBackend } from "./searchBackend"
import fuzzysort from "fuzzysort"
import { Global } from "../global"
import { FFF } from "./fff"
import { InstanceState } from "@/effect"
import type { InstanceContext } from "@/effect"
import { zodObject } from "@/util/effect-zod"
import { Context, Effect, Layer, Schema } from "effect"

export namespace File {
  const log = Log.create({ service: "file" })

  const InfoSchema = Schema.Struct({
    path: Schema.String,
    added: Schema.Number.pipe(Schema.int()),
    removed: Schema.Number.pipe(Schema.int()),
    status: Schema.Literal("added", "deleted", "modified"),
  }).annotations({ identifier: "File" })
  export const Info = zodObject(InfoSchema)
  export type Info = Schema.Schema.Type<typeof InfoSchema>

  const NodeSchema = Schema.Struct({
    name: Schema.String,
    path: Schema.String,
    absolute: Schema.String,
    type: Schema.Literal("file", "directory"),
    ignored: Schema.Boolean,
  }).annotations({ identifier: "FileNode" })
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
  }).annotations({ identifier: "FileContent" })
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
      Schema.Struct({
        file: Schema.String,
      }),
    ),
  }

  type Entry = { files: string[]; dirs: string[] }
  type State = {
    context: InstanceContext
    files(): Promise<Entry>
  }

  export interface Interface {
    init(): Effect.Effect<void, unknown>
    status(): Effect.Effect<Info[], unknown>
    read(file: string): Effect.Effect<Content, unknown>
    list(dir?: string): Effect.Effect<Node[], unknown>
    search(input: {
      query: string
      limit?: number
      dirs?: boolean
      type?: "file" | "directory"
    }): Effect.Effect<string[], unknown>
  }

  export class Service extends Context.Tag("File.Service")<Service, Interface>() {}

  const state = InstanceState.make<State>((ctx) =>
    Effect.gen(function* () {
      let cache: Entry = { files: [], dirs: [] }
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
          fetching = false
          return
        }

        const set = new Set<string>()
        for await (const file of SearchBackend.files({ cwd: ctx.directory })) {
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
      }
    }),
  )

  function canonicalizePath(filepath: string) {
    const absolute = path.isAbsolute(filepath) ? filepath : `${process.cwd()}${path.sep}${filepath}`
    const { root } = path.parse(absolute)
    const parts = absolute
      .slice(root.length)
      .split(/[\\/]+/)
      .filter(Boolean)

    let current = root
    for (const part of parts) {
      if (part === ".") continue
      if (part === "..") {
        current = path.dirname(current)
        continue
      }

      const candidate = path.join(current, part)
      try {
        current = fs.realpathSync(candidate)
      } catch {
        current = candidate
      }
    }

    return current
  }

  function containsPath(ctx: InstanceContext, filepath: string) {
    try {
      const canonicalInstance = fs.realpathSync(ctx.directory)
      const canonicalWorktree = ctx.worktree === "/" ? "/" : fs.realpathSync(ctx.worktree)
      const canonicalPath = canonicalizePath(filepath)
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

    const diffOutput = await $`git diff --numstat --no-renames -z HEAD`.cwd(ctx.directory).quiet().nothrow().text()
    const statusOutput = await $`git diff --name-status --no-renames -z HEAD`
      .cwd(ctx.directory)
      .quiet()
      .nothrow()
      .text()

    const changedFiles: Info[] = []
    const statusByPath = new Map<string, Info["status"]>()

    if (statusOutput.length > 0) {
      const entries = statusOutput.split("\0").filter(Boolean)
      for (const entry of entries) {
        const [statusCode, ...filepathParts] = entry.split("\t")
        const filepath = filepathParts.join("\t")
        if (!filepath) continue
        statusByPath.set(filepath, statusCode === "A" ? "added" : statusCode === "D" ? "deleted" : "modified")
      }
    }

    if (diffOutput.length > 0) {
      const entries = diffOutput.split("\0").filter(Boolean)
      for (const entry of entries) {
        const [added, removed, ...filepathParts] = entry.split("\t")
        const filepath = filepathParts.join("\t")
        if (!filepath) continue
        changedFiles.push({
          path: filepath,
          added: added === "-" ? 0 : parseInt(added, 10),
          removed: removed === "-" ? 0 : parseInt(removed, 10),
          status: statusByPath.get(filepath) ?? "modified",
        })
      }
    }

    const untrackedOutput = await $`git ls-files -z --others --exclude-standard`
      .cwd(ctx.directory)
      .quiet()
      .nothrow()
      .text()

    if (untrackedOutput.length > 0) {
      const untrackedFiles = untrackedOutput.split("\0").filter(Boolean)
      for (const filepath of untrackedFiles) {
        try {
          const fullPath = path.join(ctx.directory, filepath)
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
            path: filepath,
            added: lines,
            removed: 0,
            status: "added",
          })
        } catch {
          continue
        }
      }
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
      throw new Error(`Access denied: path escapes project directory`)
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
      let diff = await $`git diff ${file}`.cwd(ctx.directory).quiet().nothrow().text()
      if (!diff.trim()) diff = await $`git diff --staged ${file}`.cwd(ctx.directory).quiet().nothrow().text()
      if (diff.trim()) {
        const original = await $`git show HEAD:${file}`.cwd(ctx.directory).quiet().nothrow().text()
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

  async function listImpl(ctx: InstanceContext, dir?: string) {
    const exclude = [".git", ".DS_Store"]
    const project = ctx.project
    let ignored = (_: string) => false
    if (project.vcs === "git") {
      const ig = ignore()
      const gitignore = Bun.file(path.join(ctx.worktree, ".gitignore"))
      if (await gitignore.exists()) {
        ig.add(await gitignore.text())
      }
      const ignoreFile = Bun.file(path.join(ctx.worktree, ".ignore"))
      if (await ignoreFile.exists()) {
        ig.add(await ignoreFile.text())
      }
      ignored = ig.ignores.bind(ig)
    }
    const resolved = dir ? (path.isAbsolute(dir) ? path.normalize(dir) : path.join(ctx.directory, dir)) : ctx.directory

    // TODO: Filesystem.contains is lexical only - symlinks inside the project can escape.
    // TODO: On Windows, cross-drive paths bypass this check. Consider realpath canonicalization.
    if (!containsPath(ctx, resolved)) {
      throw new Error(`Access denied: path escapes project directory`)
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

  async function searchImpl(
    s: State,
    input: { query: string; limit?: number; dirs?: boolean; type?: "file" | "directory" },
  ) {
    const query = input.query.trim()
    const limit = input.limit ?? 100
    const kind = input.type ?? (input.dirs === false ? "file" : "all")
    log.info("search", { query, kind })

    const hidden = (item: string) => {
      const normalized = item.replaceAll("\\", "/").replace(/\/+$/, "")
      return normalized.split("/").some((p) => p.startsWith(".") && p.length > 1)
    }
    const preferHidden = query.startsWith(".") || query.includes("/.")
    const sortHiddenLast = (items: string[]) => {
      if (preferHidden) return items
      const visible: string[] = []
      const hiddenItems: string[] = []
      for (const item of items) {
        const isHidden = hidden(item)
        if (isHidden) hiddenItems.push(item)
        if (!isHidden) visible.push(item)
      }
      return [...visible, ...hiddenItems]
    }

    const fffResult = await (async () => {
      if (kind === "file") return FFF.searchFiles(query, { pageSize: limit })
      if (kind === "directory") {
        // Over-fetch like the fuzzysort path so sortHiddenLast has headroom
        // before truncation; matches the original `limit * 20` behavior.
        const fetchSize = preferHidden ? limit : limit * 20
        const dirs = await FFF.searchDirs(query, { pageSize: fetchSize })
        if (!dirs) return undefined
        if (preferHidden) return dirs.slice(0, limit)
        const ordered = query ? sortHiddenLast(dirs) : sortHiddenLast(dirs.toSorted())
        return ordered.slice(0, limit)
      }
      return FFF.searchMixed(query, { pageSize: limit })
    })().catch((error) => {
      log.warn("fff search threw, falling back", { error })
      return undefined
    })

    if (fffResult) {
      log.info("search", { query, kind, results: fffResult.length, backend: "fff" })
      return fffResult
    }

    const result = await s.files()

    if (!query) {
      if (kind === "file") return result.files.slice(0, limit)
      return sortHiddenLast(result.dirs.toSorted()).slice(0, limit)
    }

    const items =
      kind === "file" ? result.files : kind === "directory" ? result.dirs : [...result.files, ...result.dirs]

    const searchLimit = kind === "directory" && !preferHidden ? limit * 20 : limit
    const sorted = fuzzysort.go(query, items, { limit: searchLimit }).map((r) => r.target)
    const output = kind === "directory" ? sortHiddenLast(sorted).slice(0, limit) : sorted

    log.info("search", { query, kind, results: output.length, backend: "fuzzysort" })
    return output
  }

  export const layer = Layer.scoped(
    Service,
    Effect.gen(function* () {
      const scopedState = yield* state

      const init = Effect.fn("File.init")(function* () {
        yield* InstanceState.get(scopedState)
      })

      const status = Effect.fn("File.status")(function* () {
        const s = yield* InstanceState.get(scopedState)
        return yield* Effect.tryPromise(() => statusImpl(s.context))
      })

      const read = Effect.fn("File.read")(function* (file: string) {
        const s = yield* InstanceState.get(scopedState)
        return yield* Effect.tryPromise(() => readImpl(s.context, file))
      })

      const list = Effect.fn("File.list")(function* (dir?: string) {
        const s = yield* InstanceState.get(scopedState)
        return yield* Effect.tryPromise(() => listImpl(s.context, dir))
      })

      const search = Effect.fn("File.search")(function* (input: {
        query: string
        limit?: number
        dirs?: boolean
        type?: "file" | "directory"
      }) {
        const s = yield* InstanceState.get(scopedState)
        return yield* Effect.tryPromise(() => searchImpl(s, input))
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
