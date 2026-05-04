import z from "zod"
import { Tool } from "./tool"

export const SearchToolsTool = Tool.define("search_tools", async (initCtx) => {
  const { ToolRegistry } = await import("./registry")

  return {
    description:
      "Search available tools by name or capability keyword. Use this when you are looking for a tool that may not be in the active toolset or want to discover what tools are available for a specific task.",
    parameters: z.object({
      query: z.string().describe("A keyword or tool name to search for (e.g. 'image', 'memory', 'git', 'speak')"),
    }),

    async execute({ query }) {
      const allIds = await ToolRegistry.ids()
      const q = query.toLowerCase()
      const matches = allIds.filter((id) => id.toLowerCase().includes(q))

      if (matches.length === 0) {
        return {
          title: `search_tools: ${query}`,
          output: `No tools found matching "${query}". Available tools: ${allIds.join(", ")}`,
          metadata: { truncated: false },
        }
      }

      return {
        title: `search_tools: ${query}`,
        output: `Tools matching "${query}": ${matches.join(", ")}`,
        metadata: { truncated: false },
      }
    },
  }
})
