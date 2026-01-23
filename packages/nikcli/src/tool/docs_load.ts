import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./docs_load.txt"
import { loadDocs } from "@/docs/context"

const parameters = z.object({
  ids: z.array(z.string()).min(1).describe("Documentation IDs to load"),
})

export const DocsLoadTool = Tool.define("docs_load", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "docs_load",
      patterns: params.ids,
      always: ["*"],
      metadata: {
        ids: params.ids,
      },
    })

    const result = await loadDocs(params.ids)
    const loaded = result.loaded.map((entry) => `- ${entry.title} (${entry.id})`)
    const missing = result.missing.map((id) => `- ${id}`)
    const output = [
      loaded.length > 0 ? `Loaded:\n${loaded.join("\n")}` : "No documents loaded.",
      missing.length > 0 ? `Missing:\n${missing.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n")

    return {
      title: "Docs loaded",
      output,
      metadata: {
        count: result.loaded.length,
      },
    }
  },
})
