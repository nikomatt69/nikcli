import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./rag_status.txt"
import { Rag } from "@/rag"

const parameters = z.object({})

export const RagStatusTool = Tool.define("rag_status", {
  description: DESCRIPTION,
  parameters,
  async execute(_params, ctx) {
    await ctx.ask({
      permission: "rag_status",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const status = await Rag.status()
    if (!status.ready) {
      return {
        title: "RAG status",
        output: `No RAG index found at ${status.path}`,
        metadata: { ready: false },
      }
    }

    const state = status.state
    const output = [
      `Index path: ${status.path}`,
      state?.model ? `Model: ${state.model}` : "",
      state?.files !== undefined ? `Files: ${state.files}` : "",
      state?.chunks !== undefined ? `Chunks: ${state.chunks}` : "",
      state?.updated ? `Updated: ${new Date(state.updated).toISOString()}` : "",
    ]
      .filter(Boolean)
      .join("\n")

    return {
      title: "RAG status",
      output,
      metadata: { ready: true },
    }
  },
})
