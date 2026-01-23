import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./docs_unload.txt"
import { unloadDocs } from "@/docs/context"

const parameters = z.object({
  ids: z.array(z.string()).optional().describe("Documentation IDs to unload"),
  all: z.boolean().optional().describe("Unload all documentation"),
})

export const DocsUnloadTool = Tool.define("docs_unload", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const patterns = params.all ? ["*"] : (params.ids ?? [])
    await ctx.ask({
      permission: "docs_unload",
      patterns,
      always: ["*"],
      metadata: {
        ids: params.ids,
        all: params.all,
      },
    })

    const result = params.all ? await unloadDocs() : await unloadDocs(params.ids)
    const removed = result.removed.map((id) => `- ${id}`)
    const output = removed.length > 0 ? `Removed:\n${removed.join("\n")}` : "No documents removed."

    return {
      title: "Docs unloaded",
      output,
      metadata: {
        count: result.removed.length,
      },
    }
  },
})
