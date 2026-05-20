// Base provider for local vLLM inference
// Uses Bun's built-in fetch, no need for @types/node

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  name?: string
}

export abstract class BaseProvider {
  abstract name: string
  abstract apiKey: string
  abstract baseUrl: string

  abstract chatCompletions(
    model: string,
    messages: ChatMessage[],
    options: { temperature?: number; maxTokens?: number; stream?: boolean },
  ): Promise<Response>

  async listModels(): Promise<string[]> {
    return []
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
}
