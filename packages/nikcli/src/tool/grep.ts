import path from "path"
import { Schema } from "effect"
import { zod } from "@nikcli-ai/util/effect-zod"
import { Tool } from "./tool"
import DESCRIPTION from "./grep.txt"
import { FFF } from "../file/fff"
import { SearchBackend } from "../file/searchBackend"
import type { GrepMode, GrepMatch as FFFGrepMatch } from "#fff"
import { assertExternalDirectory } from "./external-directory"
import { withSearchDeadline } from "./search-deadline"

const MAX_LINE = 180
const MAX_MATCH = 100
const MAX_DEF_FIRST = 8
const MAX_DEF_NEXT = 5

function isConstraint(text: string): boolean {
  return text.startsWith("!") || text.startsWith("*") || text.endsWith("/")
}

function clean(text: string): string {
  return text.replaceAll(":", "").replaceAll("-", "").replaceAll("_", "").toLowerCase().trim()
}

function expandInclude(text?: string): string[] | undefined {
  if (!text) return undefined
  const val = text.trim().replaceAll("\\", "/")
  if (!val) return undefined
  return [val]
}

function def(line: string): boolean {
  const text = line.trim()
  if (!text) return false
  return /^(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var)\b/.test(text)
}

function imp(line: string): boolean {
  return /^(import\b|export\s+\{.*\}\s+from\b|use\b|#include\b|require\()/.test(line.trim())
}

function lineText(text: string, ranges: Array<{ start: number; end: number }>): string {
  const trim = text.trim()
  if (trim.length <= MAX_LINE) return trim
  const first = ranges[0]
  if (!first) return trim.slice(0, MAX_LINE - 3) + "..."
  const start = Math.max(0, first.start - Math.floor(MAX_LINE / 3))
  const end = Math.min(trim.length, start + MAX_LINE)
  const body = trim.slice(start, end)
  const pre = start > 0 ? "..." : ""
  const post = end < trim.length ? "..." : ""
  return pre + body + post
}

type Hit = {
  path: string
  line: number
  text: string
  ranges: Array<{ start: number; end: number }>
  contextAfter?: string[]
}

type Item = {
  hit: Hit
  def: boolean
  imp: boolean
  idx: number
}

function toHit(match: SearchBackend.Match): Hit {
  return {
    path: match.path.text,
    line: match.line_number,
    text: match.lines.text,
    ranges: match.submatches.map((s) => ({ start: s.start, end: s.end })),
  }
}

function fffToHit(match: FFFGrepMatch): Hit {
  return {
    path: match.relativePath,
    line: match.lineNumber,
    text: match.lineContent,
    ranges: match.matchRanges.map(([start, end]) => ({ start, end })),
    contextAfter: match.contextAfter,
  }
}

function group(rows: Item[]): Map<string, Item[]> {
  const out = new Map<string, Item[]>()
  for (const row of rows) {
    const list = out.get(row.hit.path)
    if (list) {
      list.push(row)
      continue
    }
    out.set(row.hit.path, [row])
  }
  return out
}

type Phase1Result = {
  hits: Hit[]
  backend: SearchBackend.Backend
  regexFallbackError?: string
}

async function exactPhase(input: {
  cwd: string
  pattern: string
  include?: string
  before: number
  after: number
  limit: number
  signal?: AbortSignal
}): Promise<Phase1Result> {
  const include = expandInclude(input.include)
  const first = await SearchBackend.search({
    cwd: input.cwd,
    pattern: input.pattern,
    glob: include,
    limit: input.limit,
    before: input.before,
    after: input.after,
    signal: input.signal,
  })
  if (first.matches.length > 0 || !include) {
    return { hits: first.matches.map(toHit), backend: first.backend }
  }
  // Retry without include filter
  const retry = await SearchBackend.search({
    cwd: input.cwd,
    pattern: input.pattern,
    limit: input.limit,
    before: input.before,
    after: input.after,
    signal: input.signal,
  })
  return { hits: retry.matches.map(toHit), backend: retry.backend }
}

/** Either a set of scored hits, or the file-path suggestion that Phase 4 short-circuits with. */
type GrepOutcome =
  | { kind: "path-suggestion"; relativePath: string }
  | {
      kind: "hits"
      phase: string
      note: string
      warn?: string
      hits: Hit[]
      backend: SearchBackend.Backend
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

    let dir = params.path ?? ctx.instance.directory
    dir = path.isAbsolute(dir) ? dir : path.resolve(ctx.instance.directory, dir)
    await assertExternalDirectory(ctx, dir, { kind: "directory" })

    const outcome = await withSearchDeadline(
      async (signal): Promise<GrepOutcome> => {
        // Phase 1: Exact match via SearchBackend (FFF → rg → Bun)
        const exact = await exactPhase({
          cwd: dir,
          pattern: params.pattern,
          include: params.include,
          before: 0,
          after: 4,
          limit: 10,
          signal,
        })

        let phase = "exact"
        let note = ""
        let warn = exact.regexFallbackError
        let hits = exact.hits
        let backend: SearchBackend.Backend = exact.backend

        // Phase 2: Broaden query if no results
        if (!hits.length) {
          const words = params.pattern.trim().split(/\s+/).filter(Boolean)
          if (words.length >= 2 && !isConstraint(words[0])) {
            const next = words.slice(1).join(" ")
            const step = await exactPhase({
              cwd: dir,
              pattern: next,
              include: params.include,
              before: 0,
              after: 4,
              limit: 10,
              signal,
            })
            warn = warn ?? step.regexFallbackError
            if (step.hits.length > 0 && step.hits.length <= 10) {
              phase = "broad"
              note = `0 exact matches. Broadened query \`${next}\`:`
              hits = step.hits
              backend = step.backend
            }
          }
        }

        // Phase 3: Fuzzy fallback (FFF-only — gracefully skip if unavailable)
        if (!hits.length) {
          const fuzzy = clean(params.pattern)
          if (fuzzy && (await FFF.available())) {
            const include = expandInclude(params.include)
            const query = include ? `${include[0]} ${fuzzy}` : fuzzy
            const result = await FFF.grep(query, {
              mode: "fuzzy" satisfies GrepMode,
              maxMatchesPerFile: 3,
              beforeContext: 0,
              afterContext: 2,
            })
            if (result?.items.length) {
              phase = "fuzzy"
              note = `0 exact matches. ${result.items.length} approximate:`
              hits = result.items.map(fffToHit)
              backend = "fff"
            }
          }
        }

        // Phase 4: File path suggestion if pattern looks like a path (FFF-only)
        if (!hits.length && params.pattern.includes("/") && (await FFF.available())) {
          const fffResult = await FFF.filesRich(params.pattern, { pageSize: 1 })
          const row = fffResult?.items[0]
          const score = fffResult?.scores[0]
          if (row && score && score.baseScore > params.pattern.length * 10) {
            return { kind: "path-suggestion", relativePath: row.relativePath }
          }
        }

        return { kind: "hits", phase, note, warn, hits, backend }
      },
      { abort: ctx.abort },
    )

    if (outcome.kind === "path-suggestion") {
      const meta: Record<string, unknown> = { matches: 0, truncated: false }
      return {
        title: params.pattern,
        metadata: meta,
        output: `0 content matches. But there is a relevant file path:\n${outcome.relativePath}`,
      }
    }

    const { phase, note, warn, hits, backend } = outcome

    // No results at all
    if (!hits.length) {
      const meta: Record<string, unknown> = { matches: 0, truncated: false, phase, backend }
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
      def: def(hit.text),
      imp: imp(hit.text),
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
    const fileCount = new Set(trim.map((row) => row.hit.path)).size
    const budget = fileCount <= 3 ? 5000 : fileCount <= 8 ? 3500 : 2500
    const read = (trim.find((row) => row.def) ?? trim[0]).hit.path

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
        chunk.push(`  Line ${row.hit.line}: ${lineText(row.hit.text, row.hit.ranges)}`)
        if (!row.def) continue
        const max = firstDef ? MAX_DEF_FIRST : MAX_DEF_NEXT
        firstDef = false
        for (const extra of (row.hit.contextAfter ?? []).slice(0, max)) {
          chunk.push(`    ${lineText(extra, [])}`)
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
      backend,
    }
    return {
      title: params.pattern,
      metadata: resultMeta,
      output: out.join("\n"),
    }
  },
})
