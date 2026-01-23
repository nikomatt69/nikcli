import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./smart_docs.txt"
import { searchDocs } from "@/docs/library"
import { getContextSummary, loadDocs } from "@/docs/context"

const parameters = z.object({
  query: z.string().describe("Search query"),
  category: z.string().optional().describe("Optional category filter"),
  limit: z.number().int().min(1).max(20).optional().describe("Result limit"),
  autoLoad: z.boolean().optional().describe("Load matching docs into context"),
})

export const SmartDocsTool = Tool.define("smart_docs", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const limit = params.limit ?? 5
    const autoLoad = params.autoLoad ?? true

    await ctx.ask({
      permission: "smart_docs",
      patterns: [params.query],
      always: ["*"],
      metadata: {
        query: params.query,
        category: params.category,
        limit,
        autoLoad,
      },
    })

    const results = await searchDocs(params.query, params.category, limit)
    if (results.length === 0) {
      return {
        title: `Smart docs: ${params.query}`,
        output: "No documentation matches found.",
        metadata: { count: 0 },
      }
    }

    const lines = results.map((result) => {
      const score = result.score.toFixed(2)
      const snippet = result.snippet.replace(/\s+/g, " ").trim()
      return `- ${result.entry.title} (id: ${result.entry.id}, score: ${score})\n  ${snippet}`
    })

    if (!autoLoad) {
      return {
        title: `Smart docs: ${params.query}`,
        output: lines.join("\n"),
        metadata: { count: results.length },
      }
    }

    const ids = results.map((item) => item.entry.id)
    const loaded = await loadDocs(ids)
    const summary = await getContextSummary()
    const details = [
      `Loaded docs: ${loaded.loaded.length}`,
      loaded.missing.length > 0 ? `Missing: ${loaded.missing.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n")

    const output = [lines.join("\n"), "", details, "", summary].filter(Boolean).join("\n")

    return {
      title: `Smart docs: ${params.query}`,
      output,
      metadata: { count: results.length },
    }
  },
})
