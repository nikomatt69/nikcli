import z from "zod"
import path from "path"
import { Tool } from "./tool"
import DESCRIPTION from "./context_diagnostics.txt"
import { LSP } from "@/lsp"
import { Instance } from "@/project/instance"
import { assertExternalDirectory } from "./external-directory"

const parameters = z.object({
  filePath: z.string().optional().describe("Optional file path to filter diagnostics"),
  limit: z.number().int().min(1).max(200).optional().describe("Maximum diagnostics per file"),
})

export const ContextDiagnosticsTool = Tool.define<typeof parameters, { count: number }>("context_diagnostics", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const limit = params.limit ?? 50

    await ctx.ask({
      permission: "context_diagnostics",
      patterns: [params.filePath ?? "*"],
      always: ["*"],
      metadata: {
        filePath: params.filePath,
        limit,
      },
    })

    if (params.filePath) {
      const target = path.isAbsolute(params.filePath)
        ? params.filePath
        : path.resolve(Instance.directory, params.filePath)
      await assertExternalDirectory(ctx, target, { kind: "file" })
      await LSP.touchFile(target, true)

      const all = await LSP.diagnostics()
      const issues = all[target] ?? []
      if (issues.length === 0) {
        return {
          title: path.relative(Instance.worktree, target),
          output: "No diagnostics found.",
          metadata: { count: 0 },
        }
      }

      const output = issues
        .slice(0, limit)
        .map((item) => LSP.Diagnostic.pretty(item))
        .join("\n")
      return {
        title: path.relative(Instance.worktree, target),
        output,
        metadata: { count: issues.length },
      }
    }

    const diagnostics = await LSP.diagnostics()
    const entries = Object.entries(diagnostics).filter(([, issues]) => issues.length > 0)
    if (entries.length === 0) {
      return {
        title: "Diagnostics",
        output: "No diagnostics found.",
        metadata: { count: 0 },
      }
    }

    const lines: string[] = []
    for (const [file, issues] of entries) {
      lines.push(`${file}:`)
      lines.push(...issues.slice(0, limit).map((item) => `  ${LSP.Diagnostic.pretty(item)}`))
      lines.push("")
    }

    return {
      title: "Diagnostics",
      output: lines.join("\n").trim(),
      metadata: { count: entries.length },
    }
  },
})
