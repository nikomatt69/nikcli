// Exa-specific wrapper over the generic MCP-over-HTTP transport.
//
// The transport itself moved to `websearch/mcp.ts` when web search became
// pluggable. This stays for `codesearch`, which calls Exa's code-context tool
// rather than its search tool and so has no provider to choose between.
import z from "zod"
import { callTool as callMcpTool } from "./websearch/mcp"
import { EXA_ENDPOINT } from "./websearch/provider"

export const ExaRequestSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  timeoutMs: z.number().positive().optional(),
  signal: z.instanceof(globalThis.AbortSignal).optional(),
})

export type ExaRequest = z.infer<typeof ExaRequestSchema>

/** Call an Exa MCP tool and return its first text block, or "" when it returned none. */
export async function callTool(input: ExaRequest): Promise<string> {
  const url = new URL(EXA_ENDPOINT)
  // Optional: the hosted endpoint answers without a key on a shared quota.
  const apiKey = process.env["EXA_API_KEY"]
  if (apiKey) url.searchParams.set("exaApiKey", apiKey)

  const result = await callMcpTool({
    url: url.toString(),
    tool: input.tool,
    args: input.args,
    timeoutMs: input.timeoutMs ?? 30_000,
    signal: input.signal,
    label: "Exa MCP",
  })
  return result.text ?? ""
}
