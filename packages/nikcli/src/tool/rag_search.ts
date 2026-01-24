import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./rag_search.txt"
import { Rag } from "@/rag"

const parameters = z.object({
  query: z.string().describe("Semantic search query"),
  limit: z.number().int().min(1).max(50).optional().describe("Maximum results"),
  minScore: z.number().min(0).max(1).optional().describe("Minimum similarity score"),
  provider: z.string().optional().describe("Embedding provider"),
})

export const RagSearchTool = Tool.define("rag_search", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "rag_search",
      patterns: [params.query],
      always: ["*"],
      metadata: {
        query: params.query,
        limit: params.limit,
        minScore: params.minScore,
      },
    })

    const result = await Rag.search({
      query: params.query,
      limit: params.limit,
      minScore: params.minScore,
      provider: params.provider,
    })

    if (!result.ready) {
      return {
        title: "RAG search",
        output: "RAG index not found. Run rag_index first.",
        metadata: { count: 0 },
      }
    }

    if (result.results.length === 0) {
      return {
        title: "RAG search",
        output: "No semantic matches found.",
        metadata: { count: 0 },
      }
    }

    const lines = result.results.map((item) => {
      const score = item.score.toFixed(3)
      return `- [${score}] ${item.file}:${item.start}-${item.end} ${item.snippet}`
    })

    return {
      title: "RAG search",
      output: lines.join("\n"),
      metadata: { count: result.results.length },
    }
  },
})
