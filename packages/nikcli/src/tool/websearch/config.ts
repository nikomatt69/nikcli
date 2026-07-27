import z from "zod"

/**
 * The `websearch` block of the nikcli config.
 *
 * Every field is optional and the defaults reproduce the pre-configurable
 * behaviour exactly: Exa's hosted endpoint, no key. Declared here rather than
 * inline in `config/config.ts` so the providers can depend on the shape without
 * pulling in the whole config module.
 */
export const WebSearchConfigSchema = z
  .object({
    provider: z
      .enum(["exa", "parallel", "mcp"])
      .optional()
      .describe('Web search backend. Defaults to "exa" (hosted endpoint, no key required).'),
    apiKey: z
      .string()
      .optional()
      .describe(
        "API key for the selected provider. Falls back to EXA_API_KEY or PARALLEL_API_KEY. Optional for exa, required for parallel.",
      ),
    url: z
      .string()
      .optional()
      .describe('MCP endpoint to query. Required for the "mcp" provider; overrides the default endpoint otherwise.'),
    tool: z.string().optional().describe("MCP tool name to call. Defaults to the provider's own search tool."),
  })
  .describe("Web search provider configuration for the websearch tool")

export type WebSearchConfig = z.infer<typeof WebSearchConfigSchema>
