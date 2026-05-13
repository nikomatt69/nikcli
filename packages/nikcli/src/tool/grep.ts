import path from "path"
import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { Tool } from "./tool"
import DESCRIPTION from "./grep.txt"
import { FFF } from "../file/fff"
import type { GrepMode, GrepMatch } from "@ff-labs/fff-bun"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"

const MAX_LINE = 180
const MAX_MATCH = 100
const MAX_DEF_FIRST = 8
const MAX_DEF_NEXT = 5

function isRegex(pattern: string): boolean {
  return /[.*+?^${}()|[\]\\]/.test(pattern)
}

function isConstraint(text: string): boolean {
  return text.startsWith("!") || text.startsWith("*") || text.endsWith("/")
}

function clean(text: string): string {
  return text.replaceAll(":", "").replaceAll("-", "").replaceAll("_", "").toLowerCase().trim()
}

function inc(text?: string): string | undefined {
  if (!text) return undefined
  const val = text.trim().replaceAll("\\", "/")
  if (!val) return undefined
  const flat = val.replaceAll("**/", "").replaceAll("/**", "/")
  const idx = flat.lastIndexOf("/")
  if (idx < 0) return flat
  const dir = flat.slice(0, idx + 1)
  const glob = flat.slice(idx + 1)
  if (!glob) return dir
  return `${dir} ${glob}`
}

function buildQuery(pattern: string, include?: string): string {
  if (!include) return pattern
  return `${include} ${pattern}`.trim()
}

function def(line: string): boolean {
  const text = line.trim()
  if (!text) return false
  return /^(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var)\b/.test(text)
}

function imp(line: string): boolean {
  return /^(import\b|export\s+\{.*\}\s+from\b|use\b|#include\b|require\()/.test(line.trim())
}

function line(text: string, ranges: [number, number][]): string {
  const trim = text.trim()
  if (trim.length <= MAX_LINE) return trim
  const first = ranges[0]
  if (!first) return trim.slice(0, MAX_LINE - 3) + "..."
  const start = Math.max(0, first[0] - Math.floor(MAX_LINE / 3))
  const end = Math.min(trim.length, start + MAX_LINE)
  const body = trim.slice(start, end)
  const pre = start > 0 ? "..." : ""
  const post = end < trim.length ? "..." : ""
  return pre + body + post
}

type Item = {
  hit: GrepMatch
  def: boolean
  imp: boolean
  idx: number
}

function group(rows: Item[]): Map<string, Item[]> {
  const out = new Map<string, Item[]>()
  for (const row of rows) {
    const list = out.get(row.hit.relativePath)
    if (list) {
      list.push(row)
      continue
    }
    out.set(row.hit.relativePath, [row])
  }
  return out
}

async function run(input: {
  cwd: string
  pattern: string
  inc?: string
  mode: GrepMode
  max: number
  before: number
  after: number
}): Promise<{ items: GrepMatch[]; regexFallbackError?: string }> {
  const first = await FFF.grep(buildQuery(input.pattern, inc(input.inc)), {
    mode: input.mode,
    maxMatchesPerFile: input.max,
    beforeContext: input.before,
    afterContext: input.after,
  })
  if (first && (first.items.length || !input.inc)) {
    return { items: first.items, regexFallbackError: first.regexFallbackError }
  }
  // Retry without include filter
  const raw = await FFF.grep(input.pattern, {
    mode: input.mode,
    maxMatchesPerFile: input.max,
    beforeContext: input.before,
    afterContext: input.after,
  })
  return { items: raw?.items ?? [], regexFallbackError: raw?.regexFallbackError }
}

const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The regex pattern to search for in file contents" }),
  path: Schema.optional(Schema.String).annotate({
    description: "The directory to search in. Defaults to the current working directory.",
  }),
  include: Schema.optional(Schema.String).annotate({
    description: 'File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")',
  }),
})

export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: zod(Parameters),
  async execute(params, ctx) {
    if (!params.pattern) {
      throw new Error("pattern is required")
    }

    await ctx.ask({
      permission: "grep",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
        include: params.include,
      },
    })

    let dir = params.path ?? Instance.directory
    dir = path.isAbsolute(dir) ? dir : path.resolve(Instance.directory, dir)
    await assertExternalDirectory(ctx, dir, { kind: "directory" })

    const mode: GrepMode = isRegex(params.pattern) ? "regex" : "plain"

    // Phase 1: Exact match
    const exact = await run({
      cwd: dir,
      pattern: params.pattern,
      inc: params.include,
      mode,
      max: 10,
      before: 0,
      after: 4,
    })

    let phase = "exact"
    let note = ""
    let warn = exact.regexFallbackError
    let hits = exact.items

    // Phase 2: Broaden query if no results
    if (!hits.length) {
      const words = params.pattern.trim().split(/\s+/).filter(Boolean)
      if (words.length >= 2 && !isConstraint(words[0])) {
        const next = words.slice(1).join(" ")
        const step = await run({
          cwd: dir,
          pattern: next,
          inc: params.include,
          mode: isRegex(next) ? "regex" : "plain",
          max: 10,
          before: 0,
          after: 4,
        })
        warn = warn ?? step.regexFallbackError
        if (step.items.length > 0 && step.items.length <= 10) {
          phase = "broad"
          note = `0 exact matches. Broadened query \`${next}\`:`
          hits = step.items
        }
      }
    }

    // Phase 3: Fuzzy fallback
    if (!hits.length) {
      const fuzzy = clean(params.pattern)
      if (fuzzy) {
        const step = await run({
          cwd: dir,
          pattern: fuzzy,
          inc: params.include,
          mode: "fuzzy",
          max: 3,
          before: 0,
          after: 2,
        })
        if (step.items.length) {
          phase = "fuzzy"
          note = `0 exact matches. ${step.items.length} approximate:`
          hits = step.items
        }
      }
    }

    // Phase 4: File path suggestion if pattern looks like a path
    if (!hits.length && params.pattern.includes("/")) {
      const fffResult = await FFF.filesRich(params.pattern, { pageSize: 1 })
      const row = fffResult?.items[0]
      const score = fffResult?.scores[0]
      if (row && score && score.baseScore > params.pattern.length * 10) {
        const meta: Record<string, unknown> = { matches: 0, truncated: false }
        return {
          title: params.pattern,
          metadata: meta,
          output: `0 content matches. But there is a relevant file path:\n${row.relativePath}`,
        }
      }
    }

    // No results at all
    if (!hits.length) {
      const meta: Record<string, unknown> = { matches: 0, truncated: false, phase }
      return {
        title: params.pattern,
        metadata: meta,
        output: "No files found",
      }
    }

    // Score and sort: definitions first, then regular, then imports
    const rows: Item[] = hits.map((hit, idx) => ({
      hit,
      idx,
      def: def(hit.lineContent),
      imp: imp(hit.lineContent),
    }))
    const hasDef = rows.some((row) => row.def)
    const show = hasDef ? rows.filter((row) => !row.imp || row.def) : rows
    show.sort((a, b) => {
      const ak = a.def ? 0 : a.imp ? 2 : 1
      const bk = b.def ? 0 : b.imp ? 2 : 1
      if (ak !== bk) return ak - bk
      return a.idx - b.idx
    })

    const total = show.length
    const trim = show.slice(0, MAX_MATCH)
    const over = total > MAX_MATCH
    const fileCount = new Set(trim.map((row) => row.hit.relativePath)).size
    const budget = fileCount <= 3 ? 5000 : fileCount <= 8 ? 3500 : 2500
    const read = (trim.find((row) => row.def) ?? trim[0]).hit.relativePath

    const out: string[] = []
    if (phase === "exact") out.push(`Found ${total} matches${over ? ` (showing first ${MAX_MATCH})` : ""}`)
    if (phase !== "exact") out.push(note)
    out.push(`Read ${read}`)
    if (warn) out.push(`! regex failed: ${warn}`)

    const by = group(trim)
    let used = out.join("\n").length
    let cut = false
    let firstDef = true
    let shown = 0
    for (const [file, list] of by.entries()) {
      const chunk: string[] = ["", `${file}:`]
      let add = 0
      for (const row of list) {
        add++
        chunk.push(`  Line ${row.hit.lineNumber}: ${line(row.hit.lineContent, row.hit.matchRanges)}`)
        if (!row.def) continue
        const max = firstDef ? MAX_DEF_FIRST : MAX_DEF_NEXT
        firstDef = false
        for (const extra of (row.hit.contextAfter ?? []).slice(0, max)) {
          chunk.push(`    ${line(extra, [])}`)
        }
      }
      const text = chunk.join("\n")
      if (used + text.length > budget && shown > 0) {
        cut = true
        break
      }
      out.push(...chunk)
      used += text.length
      shown += add
    }

    if (over || cut) {
      out.push("")
      out.push(`(Results truncated: showing first ${shown} results. Consider using a more specific path or pattern.)`)
    }

    const resultMeta: Record<string, unknown> = {
      matches: total,
      truncated: over || cut,
      phase,
    }
    return {
      title: params.pattern,
      metadata: resultMeta,
      output: out.join("\n"),
    }
  },
})
