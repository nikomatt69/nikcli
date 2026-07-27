import path from "path"
import fs from "fs/promises"
import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { Tool } from "./tool"
import DESCRIPTION from "./glob.txt"
import { FFF } from "../file/fff"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"

type Row = {
  path: string
  rel: string
}

function include(pattern: string): string {
  const val = pattern.trim().replaceAll("\\", "/")
  if (!val) return "*"
  const flat = val.replaceAll("**/", "").replaceAll("/**", "/")
  const idx = flat.lastIndexOf("/")
  if (idx < 0) return flat
  const dir = flat.slice(0, idx + 1)
  const glob = flat.slice(idx + 1)
  if (!glob) return dir
  return `${dir} ${glob}`
}

function norm(text: string): string {
  return text.replaceAll("\\", "/")
}

function hidden(rel: string): boolean {
  return norm(rel)
    .split("/")
    .some((part) => part.startsWith(".") && part.length > 1)
}

function broad(pattern: string): boolean {
  const val = norm(pattern.trim())
  if (!val) return true
  if (["*", "**", "**/*", "./**", "./**/*"].includes(val)) return true
  return /^(\*\*\/)?\*$/.test(val)
}

function pick(items: string[], cwd: string): Row[] {
  return items
    .map((rel) => ({
      path: path.resolve(cwd, rel),
      rel: norm(rel),
    }))
    .filter((item) => !hidden(item.rel))
}

function top(rows: Row[]): [string, number][] {
  const out = new Map<string, number>()
  for (const row of rows) {
    const parts = row.rel.split("/")
    const key = parts.length < 2 ? "." : parts.slice(0, Math.min(2, parts.length - 1)).join("/") + "/"
    out.set(key, (out.get(key) ?? 0) + 1)
  }
  return Array.from(out.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
}

async function scan(pattern: string, dir: string): Promise<Row[]> {
  const direct: string[] = []
  const glob1 = new Bun.Glob(pattern)
  for await (const entry of glob1.scan({ cwd: dir, onlyFiles: true, dot: true })) {
    direct.push(entry)
  }
  const out =
    direct.length > 0
      ? direct
      : await (async () => {
          const results: string[] = []
          const glob2 = new Bun.Glob(`**/${pattern}`)
          for await (const entry of glob2.scan({ cwd: dir, onlyFiles: true, dot: true })) {
            results.push(entry)
          }
          return results
        })()
  return out
    .map((file) => ({
      path: path.resolve(dir, file),
      rel: norm(file),
    }))
    .filter((item) => !hidden(item.rel))
}

const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The glob pattern to match files against" }),
  path: Schema.optional(Schema.String).annotate({
    description: `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
  }),
})

export const GlobTool = Tool.define("glob", {
  description: DESCRIPTION,
  parameters: zod(Parameters),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "glob",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
      },
    })

    // Models serialize an absent path as the literal string sometimes; treat it
    // as "not provided" rather than as a directory named "undefined".
    const requested = params.path === "undefined" || params.path === "null" ? undefined : params.path
    let dir = requested ?? Instance.directory
    dir = path.isAbsolute(dir) ? dir : path.resolve(Instance.directory, dir)
    await assertExternalDirectory(ctx, dir, { kind: "directory" })

    // The search root has to be a directory. A missing or file path used to fall
    // through to the file search and come back empty, which reads as "no matches"
    // rather than "you pointed me at the wrong thing".
    const rootStat = await fs.stat(dir).catch(() => undefined)
    if (!rootStat) throw new Error(`Search path does not exist: ${requested ?? "."}`)
    if (!rootStat.isDirectory()) throw new Error(`Search path is not a directory: ${requested ?? "."}`)

    const limit = 100
    const isWide = broad(params.pattern)
    const size = isWide ? 400 : limit + 1

    // Phase 1: Try FFF fuzzy file search
    const fffResult = await FFF.filesRich(include(params.pattern), {
      pageSize: size,
      currentFile: path.join(dir, ".nikcli"),
    })

    let rows: Row[] = []
    if (fffResult) {
      rows = pick(
        fffResult.items.map((item: { relativePath: string }) => item.relativePath),
        dir,
      )
    }

    // Phase 2: If FFF returned nothing and pattern has many words, try with fewer
    if (!rows.length) {
      const words = params.pattern.trim().split(/\s+/).filter(Boolean)
      if (words.length >= 3) {
        const short = words.slice(0, 2).join(" ")
        const next = await FFF.filesRich(include(short), {
          pageSize: size,
          currentFile: path.join(dir, ".nikcli"),
        })
        if (next) {
          rows = pick(
            next.items.map((item: { relativePath: string }) => item.relativePath),
            dir,
          )
        }
      }
    }

    // Phase 3: Fallback to filesystem glob scan
    let fallback = false
    if (!rows.length) {
      fallback = true
      rows = await scan(params.pattern, dir)
    }

    const truncated = rows.length > limit
    const files = rows.slice(0, limit).map((row) => row.path)

    const output: string[] = []
    if (files.length === 0) output.push("No files found")
    if (files.length > 0) {
      output.push(...files)
      if (isWide && truncated) {
        const dirs = top(rows)
        if (dirs.length > 0) {
          output.push("")
          output.push("Top directories in this result set:")
          output.push(...dirs.map(([d, count]) => `${d} (${count})`))
        }
      }
      if (fallback) {
        output.push("")
        output.push("(Used filesystem glob fallback for this pattern.)")
      }
      if (truncated) {
        output.push("")
        output.push(
          `(Results are truncated: showing first ${limit} results. Consider using a more specific path or pattern.)`,
        )
      }
    }

    return {
      title: path.relative(Instance.worktree, dir),
      metadata: {
        count: files.length,
        truncated,
      },
      output: output.join("\n"),
    }
  },
})
