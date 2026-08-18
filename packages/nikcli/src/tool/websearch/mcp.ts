// Minimal MCP-over-HTTP client for the streamable-HTTP transport.
//
// Every hosted search backend we talk to (Exa, Parallel, and any MCP server a
// user points us at) exposes a single `tools/call` over one POST, so a full MCP
// client session — initialize, capability negotiation, a persistent connection —
// buys nothing here. This is that one call and nothing else.
//
// Generalized from the former `tool/mcp-exa.ts`, which hardcoded Exa's URL.
import z from "zod"

/** Cap on a single response body. Search results are text; anything larger is a runaway. */
export const MAX_RESPONSE_BYTES = 256 * 1024

const DEFAULT_TIMEOUT_MS = 25_000

type McpResponse = {
  jsonrpc?: string
  result?: {
    content?: { type: string; text?: string }[]
    structuredContent?: unknown
  }
  error?: {
    code: number
    message: string
  }
}

export const CallInputSchema = z.object({
  url: z.string(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  headers: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().positive().optional(),
  signal: z.instanceof(globalThis.AbortSignal).optional(),
  /** Label used in error messages, so failures name the backend rather than "MCP". */
  label: z.string().optional(),
})

export type CallInput = z.infer<typeof CallInputSchema>

export type CallResult = {
  /** First text content block, if the server returned one. */
  text?: string
  /** `structuredContent`, when the server provides it (Parallel does, Exa does not). */
  structured?: unknown
}

export async function callTool(input: CallInput): Promise<CallResult> {
  const label = input.label ?? "MCP"
  const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  const signal = input.signal ? AbortSignal.any([controller.signal, input.signal]) : controller.signal

  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...input.headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: input.tool, arguments: input.args },
      }),
      signal,
    })

    if (!response.ok) {
      const errorText = await readBounded(response)
      throw new Error(`${label} request failed (${response.status}): ${errorText}`)
    }

    return parseResponse(await readBounded(response), label)
  } catch (error) {
    // `AbortSignal.any` reports our timeout and the caller's cancellation the
    // same way; only ours has fired if the caller's signal is still open.
    if (error instanceof Error && error.name === "AbortError" && !input.signal?.aborted) {
      throw new Error(`${label} request timed out after ${timeout}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * The transport answers with either a bare JSON body or an SSE stream carrying
 * the same envelope in a `data:` frame, and which one you get is not something
 * the request can pin down — so handle both.
 */
export function parseResponse(body: string, label = "MCP"): CallResult {
  const payloads: string[] = []
  const trimmed = body.trim()
  if (trimmed.startsWith("{")) payloads.push(trimmed)
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue
    const payload = line.slice(5).trim()
    if (payload.startsWith("{")) payloads.push(payload)
  }

  for (const payload of payloads) {
    let data: McpResponse
    try {
      data = JSON.parse(payload)
    } catch {
      // A frame we cannot parse is not fatal on its own — a later one may carry
      // the result. Only an exhausted list is an error.
      continue
    }
    if (data.error) throw new Error(`${label} error: ${data.error.code} ${data.error.message}`)
    const text = data.result?.content?.find((item) => item.text)?.text
    const structured = data.result?.structuredContent
    if (text !== undefined || structured !== undefined) return { text, structured }
  }

  return {}
}

async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error(`response exceeded ${MAX_RESPONSE_BYTES} bytes`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  // SAFETY: `chunks` collects the `Uint8Array` values the stream reader yields,
  // which are valid `BlobPart`s.
  return new TextDecoder().decode(await new Blob(chunks as BlobPart[]).arrayBuffer())
}
