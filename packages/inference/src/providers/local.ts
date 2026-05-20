import type { ChatMessage } from "../types"
import { BaseProvider } from "./base"

/**
 * Local vLLM Provider - Self-hosted inference
 *
 * Run your own models on Modal, RunPod, Vast.ai, or dedicated hardware.
 * Models: Qwen (Alibaba), MiniMax, and other Apache 2.0/MIT models.
 */

export class LocalProvider extends BaseProvider {
  name = "local"
  apiKey = process.env.LOCAL_API_KEY || "local-dev-key"
  baseUrl = process.env.VLLM_BASE_URL || "http://localhost:8000/v1"

  async chatCompletions(
    model: string,
    messages: ChatMessage[],
    options: {
      temperature?: number
      maxTokens?: number
      stream?: boolean
    },
  ): Promise<Response> {
    return this.request("/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
        stream: options.stream ?? false,
      }),
    })
  }

  override async listModels(): Promise<string[]> {
    return [
      "qwen-2.5-7b-instruct",
      "qwen-2.5-14b-instruct",
      "qwen-2.5-32b-instruct",
      "qwen-coder-32b",
      "minimax-7b",
      "deepseek-v3",
      "llama-3.1-8b",
      "mistral-7b",
    ]
  }
}
