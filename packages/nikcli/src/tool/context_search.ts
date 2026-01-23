import z from "zod"
import path from "path"
import { Tool } from "./tool"
import DESCRIPTION from "./context_search.txt"
import { Ripgrep } from "@/file/ripgrep"
import { Instance } from "@/project/instance"
import { assertExternalDirectory } from "./external-directory"

const parameters = z.object({
  pattern: z.string().describe("Regex pattern to search for"),
  path: z.string().optional().describe("Directory to search in"),
  include: z.string().optional().describe('File pattern to include in the search (e.g. "*.ts")'),
  limit: z.number().int().min(1).max(200).optional().describe("Maximum number of matches"),
})

export const ContextSearchTool = Tool.define<typeof parameters, { matches: number; truncated: boolean }>(
  "context_search",
  {
    description: DESCRIPTION,
    parameters,
    async execute(params, ctx) {
      const search = params.path ?? Instance.directory
      const base = path.isAbsolute(search) ? search : path.resolve(Instance.directory, search)
      const limit = params.limit ?? 50

      await ctx.ask({
        permission: "context_search",
        patterns: [params.pattern],
        always: ["*"],
        metadata: {
          pattern: params.pattern,
          path: base,
          include: params.include,
          limit,
        },
      })

      await assertExternalDirectory(ctx, base, { kind: "directory" })

      const matches = await Ripgrep.search({
        cwd: base,
        pattern: params.pattern,
        glob: params.include ? [params.include] : undefined,
        limit,
      })

      if (matches.length === 0) {
        return {
          title: params.pattern,
          output: "No matches found.",
          metadata: { matches: 0, truncated: false },
        }
      }

      const rows = [`Found ${matches.length} matches`]
      for (const match of matches) {
        const full = path.resolve(base, match.path.text)
        const text = match.lines.text.replace(/\s+/g, " ").trim()
        rows.push(`${full}:${match.line_number}: ${text}`)
      }

      if (matches.length >= limit) {
        rows.push("")
        rows.push("(Results are truncated. Consider narrowing the pattern or path.)")
      }

      return {
        title: params.pattern,
        output: rows.join("\n"),
        metadata: { matches: matches.length, truncated: matches.length >= limit },
      }
    },
  },
)
