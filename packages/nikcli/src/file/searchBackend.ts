import fs from "fs/promises"
import path from "path"
import { minimatch } from "minimatch"
import { FFF } from "./fff"
import { Instance } from "../project/instance"
import { Log } from "@/util/log"
import { zod, zodObject } from "@/util/effect-zod"
import { Schema } from "effect"

export namespace SearchBackend {
  const log = Log.create({ service: "search.backend" })

  const BackendSchema = Schema.Literal("fff", "bun")
  export const Backend = zod(BackendSchema)
  export type Backend = Schema.Schema.Type<typeof BackendSchema>

  const MatchSchema = Schema.Struct({
    path: Schema.Struct({
      text: Schema.String,
    }),
    lines: Schema.Struct({
      text: Schema.String,
    }),
    line_number: Schema.Number,
    absolute_offset: Schema.Number,
    submatches: Schema.mutable(
      Schema.Array(
        Schema.Struct({
          match: Schema.Struct({
            text: Schema.String,
          }),
          start: Schema.Number,
          end: Schema.Number,
        }),
      ),
    ),
  })
  export const Match = zodObject(MatchSchema)
  export type Match = Schema.Schema.Type<typeof MatchSchema>

  export type FilesInput = {
    cwd: string
    glob?: string[]
    hidden?: boolean
    follow?: boolean
    maxDepth?: number
    limit?: number
    prefer?: Backend
  }

  export type SearchInput = {
    cwd: string
    pattern: string
    glob?: string[]
    limit?: number
    follow?: boolean
    prefer?: Backend
  }

  export type FileListResult = {
    backend: Backend
    files: string[]
  }

  export type SearchResult = {
    backend: Backend
    matches: Match[]
  }

  export type GrepMatch = {
    path: string
    lineNum: number
    lineText: string
    mtime: number
    backend: Backend
  }

  export type GrepResult = {
    backend: Backend
    matches: GrepMatch[]
  }

  export type BenchmarkResult = {
    rounds: number
    files: {
      fff?: BenchmarkSample
      bun: BenchmarkSample
    }
    grep: {
      fff?: BenchmarkSample
      bun: BenchmarkSample
    }
  }

  export type BenchmarkSample = {
    available: boolean
    averageMs: number
    minMs: number
    maxMs: number
    count: number
  }

  function normalizeRelative(item: string) {
    return item.replaceAll("\\", "/")
  }

  function isGitInternal(item: string) {
    const normalized = normalizeRelative(item)
    return normalized === ".git" || normalized.startsWith(".git/")
  }

  function hidden(item: string): boolean {
    return normalizeRelative(item)
      .split("/")
      .some((part) => part.startsWith(".") && part.length > 1)
  }

  function depth(item: string): number {
    return normalizeRelative(item).split("/").filter(Boolean).length
  }

  async function relativePrefix(cwd: string): Promise<string | undefined> {
    const base = await fs.realpath(Instance.directory).catch(() => Instance.directory)
    const target = await fs.realpath(cwd).catch(() => path.resolve(cwd))
    const relative = path.relative(base, target).replaceAll(path.sep, "/")
    if (relative === "") return ""
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined
    return relative.endsWith("/") ? relative : `${relative}/`
  }

  function stripPrefix(relativePath: string, prefix: string) {
    const normalized = normalizeRelative(relativePath)
    if (!prefix) return normalized
    if (!normalized.startsWith(prefix)) return undefined
    return normalized.slice(prefix.length)
  }

  function matchesGlob(item: string, pattern: string): boolean {
    const normalized = normalizeRelative(item)
    const candidate = normalizeRelative(pattern)
    return minimatch(normalized, candidate, {
      dot: true,
      matchBase: !candidate.includes("/"),
    })
  }

  function matchesGlobs(item: string, globs: string[] | undefined): boolean {
    if (!globs?.length) return true
    let included = !globs.some((glob) => !glob.startsWith("!"))
    for (const glob of globs) {
      if (!glob) continue
      const excluded = glob.startsWith("!")
      const pattern = excluded ? glob.slice(1) : glob
      if (!pattern || !matchesGlob(item, pattern)) continue
      if (excluded) return false
      included = true
    }
    return included
  }

  function matchText(line: string, start: number, end: number) {
    const buffer = Buffer.from(line, "utf8")
    return buffer.subarray(start, end).toString("utf8")
  }

  function fffToMatch(input: {
    path: string
    item: NonNullable<Awaited<ReturnType<typeof FFF.grep>>>["items"][number]
  }): Match {
    return {
      path: { text: input.path },
      lines: { text: input.item.lineContent },
      line_number: input.item.lineNumber,
      absolute_offset: input.item.byteOffset,
      submatches: input.item.matchRanges.map(([start, end]) => ({
        match: { text: matchText(input.item.lineContent, start, end) },
        start,
        end,
      })),
    }
  }

  async function fffFileList(input: FilesInput): Promise<FileListResult | undefined> {
    if (input.prefer === "bun") return undefined
    const files = await FFF.files(input).catch((error) => {
      log.warn("fff files failed", { error })
      return undefined
    })
    if (!files) return undefined
    return { backend: "fff", files }
  }

  async function bunFileList(input: FilesInput): Promise<FileListResult> {
    const info = await fs.stat(input.cwd).catch(() => undefined)
    if (!info?.isDirectory()) {
      throw Object.assign(new Error(`No such file or directory: '${input.cwd}'`), {
        code: "ENOENT",
        errno: -2,
        path: input.cwd,
      })
    }

    const files: string[] = []
    const glob = new Bun.Glob("**/*")
    for await (const entry of glob.scan({ cwd: input.cwd, onlyFiles: true, dot: input.hidden !== false })) {
      const relative = normalizeRelative(entry)
      if (isGitInternal(relative)) continue
      if (input.hidden === false && hidden(relative)) continue
      if (input.maxDepth !== undefined && depth(relative) > input.maxDepth) continue
      if (!matchesGlobs(relative, input.glob)) continue
      files.push(relative)
      if (input.limit && files.length >= input.limit) break
    }
    return { backend: "bun", files }
  }

  async function fffSearch(input: SearchInput): Promise<SearchResult | undefined> {
    if (input.prefer === "bun") return undefined
    if (input.follow === false) return undefined
    const prefix = await relativePrefix(input.cwd)
    if (prefix === undefined) return undefined

    const result = await FFF.grep(input.pattern, {
      mode: "regex",
      smartCase: false,
      maxMatchesPerFile: input.limit,
    }).catch((error) => {
      log.warn("fff grep failed", { error })
      return undefined
    })
    if (!result || result.regexFallbackError) return undefined

    const matches = result.items
      .map((item) => {
        const local = stripPrefix(item.relativePath, prefix)
        if (!local || isGitInternal(local) || !matchesGlobs(local, input.glob)) return undefined
        return fffToMatch({ path: local, item })
      })
      .filter((item): item is Match => Boolean(item))
    return { backend: "fff", matches }
  }

  function compileRegex(pattern: string): RegExp | undefined {
    try {
      return new RegExp(pattern, "g")
    } catch {
      return undefined
    }
  }

  function lineMatches(line: string, regex: RegExp) {
    const matches: Match["submatches"] = []
    regex.lastIndex = 0
    for (let match = regex.exec(line); match; match = regex.exec(line)) {
      const text = match[0] ?? ""
      matches.push({
        match: { text },
        start: match.index,
        end: match.index + text.length,
      })
      if (text.length === 0) regex.lastIndex++
    }
    return matches
  }

  async function bunSearch(input: SearchInput): Promise<SearchResult> {
    const regex = compileRegex(input.pattern)
    if (!regex) return { backend: "bun", matches: [] }

    const listed = await bunFileList({
      cwd: input.cwd,
      glob: input.glob,
      hidden: true,
      follow: input.follow,
    })
    const matches: Match[] = []
    for (const file of listed.files) {
      const full = path.join(input.cwd, file)
      const text = await Bun.file(full)
        .text()
        .catch(() => "")
      if (!text) continue
      let offset = 0
      const lines = text.split(/\r?\n/)
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]
        const submatches = lineMatches(line, regex)
        if (submatches.length > 0) {
          matches.push({
            path: { text: file },
            lines: { text: line },
            line_number: index + 1,
            absolute_offset: offset,
            submatches,
          })
          if (input.limit && matches.filter((item) => item.path.text === file).length >= input.limit) break
        }
        offset += Buffer.byteLength(line, "utf8") + 1
      }
    }
    return { backend: "bun", matches }
  }

  export async function fileList(input: FilesInput): Promise<FileListResult> {
    const fff = await fffFileList(input)
    if (fff) return fff
    return bunFileList(input)
  }

  export async function* files(input: FilesInput): AsyncGenerator<string> {
    const result = await fileList(input)
    for (const file of result.files) yield file
  }

  export async function search(input: SearchInput): Promise<SearchResult> {
    const fff = await fffSearch(input)
    if (fff) return fff
    return bunSearch(input)
  }

  async function statMtime(filePath: string) {
    return Bun.file(filePath)
      .stat()
      .then((x) => x.mtime.getTime())
      .catch(() => 0)
  }

  export async function grep(input: SearchInput): Promise<GrepResult> {
    const result = await search(input)
    const matches = await Promise.all(
      result.matches.map(async (match) => {
        const full = path.resolve(input.cwd, match.path.text)
        return {
          path: full,
          lineNum: match.line_number,
          lineText: match.lines.text,
          mtime: await statMtime(full),
          backend: result.backend,
        }
      }),
    )
    return { backend: result.backend, matches }
  }

  export async function tree(input: { cwd: string; limit?: number; prefer?: Backend }) {
    const listed = await fileList({ cwd: input.cwd, prefer: input.prefer })
    interface Node {
      path: string[]
      children: Node[]
    }

    function getPath(node: Node, parts: string[], create: boolean) {
      if (parts.length === 0) return node
      let current = node
      for (const part of parts) {
        let existing = current.children.find((x) => x.path.at(-1) === part)
        if (!existing) {
          if (!create) return
          existing = {
            path: current.path.concat(part),
            children: [],
          }
          current.children.push(existing)
        }
        current = existing
      }
      return current
    }

    const root: Node = { path: [], children: [] }
    for (const file of listed.files) {
      if (file.includes(".nikcli")) continue
      getPath(root, normalizeRelative(file).split("/"), true)
    }

    function sort(node: Node) {
      node.children.sort((a, b) => {
        if (!a.children.length && b.children.length) return 1
        if (!b.children.length && a.children.length) return -1
        return a.path.at(-1)!.localeCompare(b.path.at(-1)!)
      })
      for (const child of node.children) sort(child)
    }
    sort(root)

    let current = [root]
    const result: Node = { path: [], children: [] }
    let processed = 0
    const limit = input.limit ?? 50
    while (current.length > 0) {
      const next = []
      for (const node of current) {
        if (node.children.length) next.push(...node.children)
      }
      const max = Math.max(...current.map((x) => x.children.length))
      for (let i = 0; i < max && processed < limit; i++) {
        for (const node of current) {
          const child = node.children[i]
          if (!child) continue
          getPath(result, child.path, true)
          processed++
          if (processed >= limit) break
        }
      }
      if (processed >= limit) {
        for (const node of [...current, ...next]) {
          const compare = getPath(result, node.path, false)
          if (!compare) continue
          if (compare.children.length !== node.children.length) {
            const diff = node.children.length - compare.children.length
            compare.children.push({
              path: compare.path.concat(`[${diff} truncated]`),
              children: [],
            })
          }
        }
        break
      }
      current = next
    }

    const lines: string[] = []
    function render(node: Node, depth: number) {
      const indent = "\t".repeat(depth)
      lines.push(indent + node.path.at(-1) + (node.children.length ? "/" : ""))
      for (const child of node.children) render(child, depth + 1)
    }
    result.children.map((x) => render(x, 0))
    return lines.join("\n")
  }

  async function measure(fn: () => Promise<number>, rounds: number): Promise<BenchmarkSample> {
    const samples: number[] = []
    let count = 0
    for (let i = 0; i < rounds; i++) {
      const start = performance.now()
      count = await fn()
      samples.push(performance.now() - start)
    }
    return {
      available: true,
      averageMs: samples.reduce((sum, item) => sum + item, 0) / samples.length,
      minMs: Math.min(...samples),
      maxMs: Math.max(...samples),
      count,
    }
  }

  async function waitForFFF(input: SearchInput, timeoutMs: number = 1000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const files = await fffFileList({ cwd: input.cwd, glob: input.glob, hidden: false, prefer: "fff" })
      if (files) return true
      await Bun.sleep(25)
    }
    return false
  }

  export async function benchmark(input: SearchInput & { rounds?: number }): Promise<BenchmarkResult> {
    const rounds = input.rounds ?? 5
    await waitForFFF(input)
    const bunFiles = await measure(
      async () => (await bunFileList({ cwd: input.cwd, glob: input.glob })).files.length,
      rounds,
    )
    const fffFilesInput = { cwd: input.cwd, glob: input.glob, hidden: false as const, prefer: "fff" as const }
    const fffFilesProbe = await fffFileList(fffFilesInput)
    const fffFiles = fffFilesProbe
      ? await measure(async () => (await fffFileList(fffFilesInput))?.files.length ?? 0, rounds)
      : undefined

    const bunGrep = await measure(async () => (await bunSearch({ ...input, prefer: "bun" })).matches.length, rounds)
    const fffGrepProbe = await fffSearch({ ...input, prefer: "fff" })
    const fffGrep = fffGrepProbe
      ? await measure(async () => (await fffSearch({ ...input, prefer: "fff" }))?.matches.length ?? 0, rounds)
      : undefined

    return {
      rounds,
      files: {
        fff: fffFiles,
        bun: bunFiles,
      },
      grep: {
        fff: fffGrep,
        bun: bunGrep,
      },
    }
  }
}
