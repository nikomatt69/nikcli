import type { ChatMessage } from "../types"

export interface CacheKeyInput {
  model: string
  messages: ChatMessage[]
  tools?: unknown
  tool_choice?: unknown
  temperature?: number
  top_p?: number
  max_tokens?: number
  response_format?: unknown
  stop?: unknown
  seed?: number
}

export function normalize(input: CacheKeyInput) {
  return {
    model: input.model,
    messages: input.messages.map((m) => ({ role: m.role, content: m.content, name: m.name ?? null })),
    tools: input.tools ?? null,
    tool_choice: input.tool_choice ?? null,
    temperature: input.temperature ?? 0,
    top_p: input.top_p ?? 1,
    max_tokens: input.max_tokens ?? null,
    response_format: input.response_format ?? null,
    stop: input.stop ?? null,
    seed: input.seed ?? null,
  }
}

export async function hashKey(input: CacheKeyInput): Promise<string> {
  const payload = JSON.stringify(normalize(input))
  const bytes = new TextEncoder().encode(payload)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return bufToHex(digest)
}

function bufToHex(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf)
  let out = ""
  for (let i = 0; i < view.length; i++) {
    out += view[i]!.toString(16).padStart(2, "0")
  }
  return out
}

export function isDeterministic(input: Pick<CacheKeyInput, "temperature" | "top_p" | "seed">): boolean {
  if (input.seed !== undefined && input.seed !== null) return true
  const t = input.temperature ?? 0
  if (t === 0) return true
  return false
}
