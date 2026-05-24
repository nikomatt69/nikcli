import type { ChatMessage, ContentPart } from "../types"

export interface ChatOptions {
  temperature?: number
  top_p?: number
  maxTokens?: number
  stream?: boolean
  tools?: unknown
  tool_choice?: unknown
  response_format?: unknown
  stop?: unknown
  seed?: number
  /** OpenRouter-style unified reasoning param. */
  reasoning?: { effort?: "low" | "medium" | "high"; enabled?: boolean; max_tokens?: number; exclude?: boolean }
  extra?: Record<string, unknown>
}

export abstract class BaseProvider {
  abstract name: string
  abstract apiKey: string
  abstract baseUrl: string

  abstract chatCompletions(model: string, messages: ChatMessage[], options?: ChatOptions): Promise<Response>

  async listModels(): Promise<string[]> {
    return []
  }

  async ping(): Promise<boolean> {
    return true
  }

  protected request(endpoint: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    })
  }

  /**
   * Convert array content to string format for providers that don't support array content.
   * Extracts text from text parts and joins them.
   */
  protected static contentToString(content: string | ContentPart[]): string {
    if (typeof content === "string") return content
    if (!Array.isArray(content)) return " "
    const text = content
      .filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text)
      .join("\n")
      .trim()
    return text || " "
  }
}

/**
 * Local vLLM provider. Default upstream when no managed provider is configured.
 * Kept as its own class because local vLLM may need custom flags (e.g. extra_body
 * for guided decoding) that managed providers don't expose.
 */
export class LocalProvider extends BaseProvider {
  name = "local"
  apiKey = process.env.LOCAL_API_KEY || "local-dev-key"
  baseUrl = process.env.VLLM_BASE_URL || "http://localhost:8000/v1"

  async chatCompletions(model: string, messages: ChatMessage[], options: ChatOptions = {}): Promise<Response> {
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      stream: options.stream ?? false,
    }
    if (options.top_p !== undefined) body.top_p = options.top_p
    if (options.tools !== undefined) body.tools = options.tools
    if (options.tool_choice !== undefined) body.tool_choice = options.tool_choice
    if (options.response_format !== undefined) body.response_format = options.response_format
    if (options.stop !== undefined) body.stop = options.stop
    if (options.seed !== undefined) body.seed = options.seed
    if (options.reasoning !== undefined) body.reasoning = options.reasoning
    if (options.extra) Object.assign(body, options.extra)

    return this.request("/chat/completions", { method: "POST", body: JSON.stringify(body) })
  }

  override async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(3_000),
      })
      return res.ok
    } catch {
      return false
    }
  }
}
