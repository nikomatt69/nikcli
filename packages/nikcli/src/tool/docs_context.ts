import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./docs_context.txt"
import { getContextSummary, getFullContext, getLoadedDocs } from "@/docs/context"

const parameters = z.object({
  full: z.boolean().optional().describe("Include full documentation content"),
})

export const DocsContextTool = Tool.define("docs_context", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "docs_context",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        full: params.full,
      },
    })

    const docs = await getLoadedDocs()
    if (docs.length === 0) {
      return {
        title: "Docs context",
        output: "No documentation loaded.",
        metadata: {
          count: 0,
        },
      }
    }

    const summary = await getContextSummary()
    if (!params.full) {
      return {
        title: "Docs context",
        output: summary,
        metadata: {
          count: docs.length,
        },
      }
    }

    const full = await getFullContext()
    const output = [summary, "", full].join("\n")

    return {
      title: "Docs context",
      output,
      metadata: {
        count: docs.length,
      },
    }
  },
})
