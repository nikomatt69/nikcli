import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./codesearch.txt"
import { callTool } from "./mcp-exa"

interface McpCodeRequest extends Record<string, unknown> {
  query: string
  tokensNum: number
}

export const CodeSearchTool = Tool.define("codesearch", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z
      .string()
      .describe(
        "Search query to find relevant context for APIs, Libraries, and SDKs. For example, 'React useState hook examples', 'Python pandas dataframe filtering', 'Express.js middleware', 'Next js partial prerendering configuration'",
      ),
    tokensNum: z
      .number()
      .min(1000)
      .max(50000)
      .default(5000)
      .describe(
        "Number of tokens to return (1000-50000). Default is 5000 tokens. Adjust this value based on how much context you need - use lower values for focused queries and higher values for comprehensive documentation.",
      ),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "codesearch",
      patterns: [params.query],
      always: ["*"],
      metadata: {
        query: params.query,
        tokensNum: params.tokensNum,
      },
    })

    const request: McpCodeRequest = {
      query: params.query,
      tokensNum: params.tokensNum || 5000,
    }

    const text = await callTool({ tool: "get_code_context_exa", args: request, signal: ctx.abort, timeoutMs: 30000 })
    if (!text) {
      return {
        output:
          "No code snippets or documentation found. Please try a different query, be more specific about the library or programming concept, or check the spelling of framework names.",
        title: `Code search: ${params.query}`,
        metadata: {},
      }
    }
    return {
      output: text,
      title: `Code search: ${params.query}`,
      metadata: {},
    }
  },
})
