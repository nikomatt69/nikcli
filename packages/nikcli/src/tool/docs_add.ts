import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./docs_add.txt"
import { addDoc } from "@/docs/library"

const parameters = z.object({
  url: z.string().describe("Documentation URL to add"),
  category: z.string().optional().describe("Category label"),
  tags: z.array(z.string()).optional().describe("Optional tags"),
})

export const DocsAddTool = Tool.define("docs_add", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "docs_add",
      patterns: [params.url],
      always: ["*"],
      metadata: {
        url: params.url,
        category: params.category,
      },
    })

    const entry = await addDoc({
      url: params.url,
      category: params.category,
      tags: params.tags,
    })

    const output = [
      `Added documentation: ${entry.title}`,
      `ID: ${entry.id}`,
      `Category: ${entry.category}`,
      entry.tags.length > 0 ? `Tags: ${entry.tags.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n")

    return {
      title: entry.title,
      output,
      metadata: {
        id: entry.id,
        url: entry.url,
      },
    }
  },
})
