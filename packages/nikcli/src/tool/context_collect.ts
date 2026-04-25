import z from "zod"
import path from "path"
import { pathToFileURL } from "url"
import { Tool } from "./tool"
import DESCRIPTION from "./context_collect.txt"
import { Instance } from "@/project/instance"
import { SearchBackend } from "@/file/searchBackend"
import { assertExternalDirectory } from "./external-directory"
import { FileIgnore } from "@/file/ignore"
import { LSP } from "@/lsp"

const parameters = z.object({
  paths: z.array(z.string()).optional().describe("Files or directories to include"),
  pattern: z.string().optional().describe("Optional regex filter for lines"),
  maxFiles: z.number().int().min(1).max(100).optional().describe("Maximum files to collect"),
  maxLines: z.number().int().min(1).max(2000).optional().describe("Maximum lines per file"),
  includeSymbols: z.boolean().optional().describe("Include LSP symbols for files"),
  includeDiagnostics: z.boolean().optional().describe("Include LSP diagnostics for files"),
})

export const ContextCollectTool = Tool.define<typeof parameters, { count: number; truncated: boolean }>(
  "context_collect",
  {
    description: DESCRIPTION,
    parameters,
    async execute(params, ctx) {
      const roots = params.paths?.length ? params.paths : [Instance.directory]
      const limitFiles = params.maxFiles ?? 20
      const limitLines = params.maxLines ?? 200
      const includeSymbols = params.includeSymbols ?? false
      const includeDiagnostics = params.includeDiagnostics ?? false
      const resolved = roots.map((item) => (path.isAbsolute(item) ? item : path.resolve(Instance.directory, item)))
      const regex = params.pattern ? new RegExp(params.pattern) : undefined

      await ctx.ask({
        permission: "context_collect",
        patterns: resolved,
        always: ["*"],
        metadata: {
          paths: resolved,
          pattern: params.pattern,
          maxFiles: limitFiles,
          maxLines: limitLines,
        },
      })

      for (const item of resolved) {
        const info = await Bun.file(item)
          .stat()
          .catch(() => undefined)
        const kind = info && info.isDirectory() ? "directory" : "file"
        await assertExternalDirectory(ctx, item, { kind })
      }

      const files = await collectFiles(resolved, limitFiles)
      const diagnostics = includeDiagnostics ? await LSP.diagnostics() : undefined
      const lines: string[] = []

      if (files.length === 0) {
        return {
          title: "Context collect",
          output: "No files found.",
          metadata: {
            count: 0,
            truncated: false,
          },
        }
      }

      lines.push(`Collected ${files.length} files`)

      for (const file of files) {
        const rel = path.relative(Instance.directory, file) || file
        const body = await readSnippet(file, limitLines, regex)
        const snippet = body || "(no matching content)"
        lines.push("")
        lines.push(`file: ${rel}`)
        lines.push(snippet)

        if (includeSymbols) {
          const symbols = await collectSymbols(file)
          if (symbols.length > 0) {
            lines.push("")
            lines.push("symbols:")
            lines.push(...symbols.map((item) => `- ${item}`))
          }
        }

        if (includeDiagnostics && diagnostics) {
          const issues = diagnostics[file] ?? []
          if (issues.length > 0) {
            lines.push("")
            lines.push("diagnostics:")
            lines.push(...issues.slice(0, 10).map((item) => `- ${LSP.Diagnostic.pretty(item)}`))
          }
        }
      }

      return {
        title: "Context collect",
        output: lines.join("\n"),
        metadata: {
          count: files.length,
          truncated: files.length >= limitFiles,
        },
      }
    },
  },
)

async function collectFiles(roots: string[], limit: number) {
  const files: string[] = []
  for (const root of roots) {
    if (files.length >= limit) break
    const info = await Bun.file(root)
      .stat()
      .catch(() => undefined)
    if (!info) continue
    if (info.isFile()) {
      files.push(root)
      continue
    }
    if (!info.isDirectory()) continue

    for await (const entry of SearchBackend.files({ cwd: root, limit: limit - files.length })) {
      if (files.length >= limit) break
      const full = path.join(root, entry)
      const rel = path.relative(Instance.directory, full)
      if (FileIgnore.match(rel)) continue
      files.push(full)
    }
  }
  return files
}

async function readSnippet(filePath: string, limit: number, regex?: RegExp) {
  const file = Bun.file(filePath)
  if (file.type.startsWith("image/") || file.type === "application/pdf") {
    return ""
  }
  const text = await file.text().catch(() => "")
  if (!text) return ""
  const lines = text.split("\n")
  const filtered = regex ? lines.filter((line) => regex.test(line)) : lines
  return filtered.slice(0, limit).join("\n")
}

async function collectSymbols(filePath: string) {
  const uri = pathToFileURL(filePath).href
  const symbols = await LSP.documentSymbol(uri).catch(() => [])
  return symbols.map((item) => item.name).slice(0, 20)
}
