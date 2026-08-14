/**
 * Native request builder for @nikcli-ai/llm.
 *
 * Converts AI SDK-shaped session data into @nikcli-ai/llm LLMRequest objects.
 * The actual provider routing is handled by LLMClient.stream().
 */
import type { LLMRequest } from "@nikcli-ai/llm"
import type { ModelMessage } from "ai"
import type { Provider } from "@/provider/provider"
import { isRecord } from "@nikcli-ai/util/record"

type ToolInput = {
  readonly description?: string
  readonly inputSchema?: unknown
}

export type RequestInput = {
  readonly model: Provider.Model
  readonly apiKey?: string
  readonly baseURL?: string
  readonly system?: readonly string[]
  readonly messages: readonly ModelMessage[]
  readonly tools?: Record<string, ToolInput>
  readonly toolChoice?: "auto" | "required" | "none"
  readonly temperature?: number
  readonly topP?: number
  readonly topK?: number
  readonly maxOutputTokens?: number
  readonly providerOptions?: LLMRequest["providerOptions"]
  readonly headers?: Record<string, string>
}

function textPart(part: Record<string, unknown>) {
  return {
    type: "text" as const,
    text: typeof part.text === "string" ? part.text : "",
  }
}

function contentPart(part: unknown) {
  if (!isRecord(part)) throw new Error("Native request adapter only supports object content parts")
  if (part.type === "text") return textPart(part)
  if (part.type === "reasoning")
    return {
      type: "reasoning" as const,
      text: typeof part.text === "string" ? part.text : "",
    }
  if (part.type === "tool-call")
    return {
      type: "tool-call" as const,
      id: typeof part.toolCallId === "string" ? part.toolCallId : "",
      name: typeof part.toolName === "string" ? part.toolName : "",
      input: part.input,
    }
  if (part.type === "tool-result")
    return {
      type: "tool-result" as const,
      id: typeof part.toolCallId === "string" ? part.toolCallId : "",
      name: typeof part.toolName === "string" ? part.toolName : "",
      result: part.output,
    }
  return textPart(part)
}

function content(value: ModelMessage["content"]) {
  return typeof value === "string" ? [{ type: "text" as const, text: value }] : value.map(contentPart)
}

// Build messages array from AI SDK ModelMessage[]
function buildMessages(input: readonly ModelMessage[]): { messages: unknown[] } {
  const messages = input
    .filter((m) => m.role !== "system")
    .map((message) => ({
      role: message.role,
      content: content(message.content),
    }))
  return { messages }
}

function schema(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return { type: "object", properties: {} }
  if (isRecord(value.jsonSchema)) return value.jsonSchema as Record<string, unknown>
  return value as Record<string, unknown>
}

function tools(input: Record<string, ToolInput> | undefined): unknown[] {
  return Object.entries(input ?? {}).map(([name, item]) => ({
    name,
    description: item.description ?? "",
    inputSchema: schema(item.inputSchema),
  }))
}

function generation(input: RequestInput) {
  const result: Record<string, unknown> = {}
  if (input.temperature !== undefined) result.temperature = input.temperature
  if (input.topP !== undefined) result.topP = input.topP
  if (input.topK !== undefined) result.topK = input.topK
  if (input.maxOutputTokens !== undefined) result.maxTokens = input.maxOutputTokens
  return Object.keys(result).length > 0 ? result : undefined
}

function toolChoice(input: RequestInput): string | undefined {
  if (input.toolChoice === "required") return "any"
  if (input.toolChoice === "none") return "none"
  return undefined
}

// Build model reference from Provider.Model
// Note: LLMClient.stream() expects an AI SDK model instance (e.g., from OpenAI SDK)
// that the route system can process. We construct the appropriate model based on provider.
function buildModel(input: RequestInput): unknown {
  const model = input.model
  // Build a model identifier for the route system
  // The route will resolve this to the appropriate provider model
  return {
    id: model.id,
    provider: model.providerID,
    baseURL: input.baseURL ?? model.api.url,
    apiKey: input.apiKey,
    api: model.api,
    limits: model.limit,
    headers: input.headers,
  }
}

export function request(input: RequestInput): LLMRequest {
  const converted = buildMessages(input.messages)

  return {
    model: buildModel(input),
    system: [...(input.system ?? [])],
    messages: converted.messages,
    tools: tools(input.tools),
    toolChoice: toolChoice(input),
    generation: generation(input),
    providerOptions: input.providerOptions,
  } as unknown as LLMRequest
}

export * as LLMNative from "./native-request"
