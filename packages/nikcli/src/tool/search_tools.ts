import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { Tool } from "./tool"
import DESCRIPTION from "./search_tools.txt"

const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "A keyword or tool name to search for (e.g. 'image', 'memory', 'git', 'speak')",
  }),
})

export const SearchToolsTool = Tool.define("search_tools", async (initCtx) => {
  const { ToolRegistry } = await import("./registry")

  return {
    description: DESCRIPTION,
    parameters: zod(Parameters),

    async execute({ query }) {
      const { runPromiseWithLayer } = await import("@/effect")
      const { Effect } = await import("effect")
      const allIds = await runPromiseWithLayer(
        ToolRegistry.defaultLayer,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          return yield* registry.ids()
        }),
      )
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
