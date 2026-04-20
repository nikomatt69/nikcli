import z from "zod"

const API_CONFIG = {
  BASE_URL: "https://mcp.exa.ai",
  ENDPOINT: "/mcp",
} as const

type ExaArgs = Record<string, unknown>

type McpRequest = {
  jsonrpc: "2.0"
  id: number
  method: string
  params: {
    name: string
    arguments: ExaArgs
  }
}

type McpResponseContent = {
  type: string
  text: string
}

type McpResponse = {
  jsonrpc: string
  result?: {
    content?: McpResponseContent[]
  }
  error?: {
    code: number
    message: string
  }
}

export const ExaRequestSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  timeoutMs: z.number().positive().optional(),
  signal: z.instanceof(globalThis.AbortSignal).optional(),
})

export type ExaRequest = z.infer<typeof ExaRequestSchema>

export async function callTool(input: ExaRequest): Promise<string> {
  const timeout = input.timeoutMs ?? 30_000
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  const signals = [controller.signal]
  if (input.signal) signals.push(input.signal)

  try {
    const request: McpRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: input.tool,
        arguments: input.args,
      },
    }

    const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINT}`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
      signal: signals.length === 1 ? controller.signal : AbortSignal.any(signals),
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Exa MCP request failed (${response.status}): ${errorText}`)
    }

    const responseText = await response.text()
    const lines = responseText.split("\n")
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed
      if (!payload) continue

      const data: McpResponse = JSON.parse(payload)
      if (data.error) {
        throw new Error(`Exa MCP error: ${data.error.code} ${data.error.message}`)
      }

      const text = data.result?.content?.[0]?.text
      if (text) return text
    }

    return ""
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Exa MCP request timed out")
    }
    throw error
  }
}
