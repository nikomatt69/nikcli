// Re-export ChatMessage from types
export type { ChatMessage, ContentPart, TextPart, ImagePart, FilePart } from "../types"

import type { ChatMessage, ContentPart } from "../types"

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

  /**
   * Convert array content to OpenAI-compatible array format.
   */
  protected static contentToArray(content: string | ContentPart[]): Array<Record<string, unknown>> {
    if (Array.isArray(content)) {
      return content.map((p) => {
        if (p.type === "text") return { type: "text", text: (p as { type: "text"; text: string }).text }
        if (p.type === "image")
          return {
            type: "image_url",
            image_url: { url: (p as { type: "image"; image: string | URL }).image.toString() },
          }
        if (p.type === "file") return { type: "text", text: "[file]" }
        return { type: "text", text: " " }
      })
    }
    return [{ type: "text", text: content || " " }]
  }
}
