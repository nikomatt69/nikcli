import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./rag_reset.txt"
import { Rag } from "@/rag"

const parameters = z.object({})

export const RagResetTool = Tool.define("rag_reset", {
  description: DESCRIPTION,
  parameters,
  async execute(_params, ctx) {
    await ctx.ask({
      permission: "rag_reset",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const result = await Rag.reset()
    return {
      title: "RAG reset",
      output: `Removed RAG index at ${result.path}`,
      metadata: { path: result.path },
    }
  },
})
