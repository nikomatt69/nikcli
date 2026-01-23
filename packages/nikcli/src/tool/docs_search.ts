import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./docs_search.txt"
import { searchDocs } from "@/docs/library"

const parameters = z.object({
  query: z.string().describe("Search query"),
  category: z.string().optional().describe("Optional category filter"),
  limit: z.number().int().min(1).max(20).optional().describe("Result limit"),
})

export const DocsSearchTool = Tool.define("docs_search", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "docs_search",
      patterns: [params.query],
      always: ["*"],
      metadata: {
        query: params.query,
        category: params.category,
      },
    })

    const results = await searchDocs(params.query, params.category, params.limit ?? 5)
    if (results.length === 0) {
      return {
        title: `Docs search: ${params.query}`,
        output: "No documentation matches found.",
        metadata: {
          count: 0,
        },
      }
    }

    const lines = results.map((result) => {
      const score = result.score.toFixed(2)
      return `- ${result.entry.title} (id: ${result.entry.id}, score: ${score})`
    })
    const output = lines.join("\n")

    return {
      title: `Docs search: ${params.query}`,
      output,
      metadata: {
        count: results.length,
      },
    }
  },
})
