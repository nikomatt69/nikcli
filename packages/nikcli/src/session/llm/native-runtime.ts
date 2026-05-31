/**
 * Native runtime bridge to @nikcli-ai/llm.
 *
 * Provides streaming through @nikcli-ai/llm's route-based provider stack
 * when the provider is supported (OpenAI, Anthropic, OpenAI-compatible).
 */
import type { Auth } from "@/auth"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { isRecord } from "@/util/record"
import type { ModelMessage, Tool } from "ai"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { ToolFailure, tool as makeNativeTool, type AnyExecutableTool, type LLMEvent } from "@nikcli-ai/llm"
import type { LLMClientShape } from "@nikcli-ai/llm/route"
import { LLMNative } from "./native-request"

export type RuntimeStatus =
  | { readonly type: "supported"; readonly apiKey: string; readonly baseURL?: string }
  | { readonly type: "unsupported"; readonly reason: string }

export type StreamResult =
  | { readonly type: "supported"; readonly stream: Stream.Stream<LLMEvent, unknown> }
  | { readonly type: "unsupported"; readonly reason: string }

type StreamInput = {
  readonly model: Provider.Model
  readonly provider: Provider.Info
  readonly auth: Auth.Info | undefined
  readonly llmClient: LLMClientShape
  readonly messages: ModelMessage[]
  readonly tools: Record<string, Tool>
  readonly toolChoice?: "auto" | "required" | "none"
  readonly temperature?: number
  readonly topP?: number
  readonly topK?: number
  readonly maxOutputTokens?: number
  readonly providerOptions?: Record<string, any>
  readonly headers: Record<string, string> | undefined
  readonly abort: AbortSignal
}

export function status(input: Pick<StreamInput, "model" | "provider" | "auth">): RuntimeStatus {
  return statusWithFetch(input, providerFetch(input))
}

function statusWithFetch(
  input: Pick<StreamInput, "model" | "provider" | "auth">,
  fetch: typeof globalThis.fetch | undefined,
): RuntimeStatus {
  const providerID = input.model.providerID

  // Supported providers: OpenAI, Anthropic, and OpenAI-compatible
  if (
    providerID !== "openai" &&
    providerID !== "anthropic" &&
    !providerID.startsWith("opencode") &&
    !providerID.includes("openai-compatible")
  ) {
    return { type: "unsupported", reason: `provider ${providerID} is not supported by native runtime` }
  }

  const npm = input.model.api.npm
  if (npm !== "@ai-sdk/openai" && npm !== "@ai-sdk/openai-compatible" && npm !== "@ai-sdk/anthropic") {
    return { type: "unsupported", reason: `provider package ${npm} is not supported` }
  }

  if (input.auth?.type === "oauth" && !(input.provider.id === "openai" && fetch)) {
    return { type: "unsupported", reason: "OAuth auth requires a provider fetch override" }
  }

  const apiKey = typeof input.provider.options.apiKey === "string" ? input.provider.options.apiKey : input.provider.key
  if (!apiKey) return { type: "unsupported", reason: "API key is not configured" }

  return {
    type: "supported",
    apiKey,
    baseURL: typeof input.provider.options.baseURL === "string" ? input.provider.options.baseURL : undefined,
  }
}

export function stream(input: StreamInput): StreamResult {
  const fetch = providerFetch(input)
  const current = statusWithFetch(input, fetch)
  if (current.type === "unsupported") return current

  // Build the LLM request using ProviderTransform for message normalization
  const llmRequest = LLMNative.request({
    model: input.model,
    apiKey: current.apiKey,
    baseURL: current.baseURL,
    messages: input.messages,
    tools: input.tools,
    toolChoice: input.toolChoice,
    temperature: input.temperature,
    topP: input.topP,
    topK: input.topK,
    maxOutputTokens: input.maxOutputTokens,
    providerOptions: ProviderTransform.providerOptions(input.model, input.providerOptions ?? {}),
    headers: { ...providerHeaders(input.provider.options.headers), ...input.headers },
  })

  // Stream through @nikcli-ai/llm's route system
  const stream = input.llmClient.stream({
    request: llmRequest,
    tools: nativeTools(input.tools, input),
  })

  // Provide fetch if needed (for OAuth)
  if (fetch) {
    return { ...current, stream: stream.pipe(Stream.provideService("Fetch" as any, fetch)) }
  }

  return { ...current, stream }
}

function providerFetch(input: Pick<StreamInput, "provider" | "auth">): typeof globalThis.fetch | undefined {
  if (input.provider.id !== "openai" || input.auth?.type !== "oauth") return undefined
  const value: unknown = input.provider.options.fetch
  if (typeof value !== "function") return undefined
  return value as typeof globalThis.fetch
}

function providerHeaders(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function nativeTools(
  tools: Record<string, Tool>,
  input: Pick<StreamInput, "messages" | "abort">,
): Record<string, AnyExecutableTool> {
  return Object.fromEntries(
    Object.entries(tools).map(([name, item]) => [
      name,
      makeNativeTool({
        description: item.description ?? "",
        jsonSchema: ((item as any).parameters ?? (item as any).inputSchema ?? {}) as any,
        execute: (args: unknown) =>
          Effect.tryPromise({
            try: () => {
              if (!item.execute) throw new Error(`Tool has no execute handler: ${name}`)
              return item.execute(args, {
                toolCallId: name,
                messages: input.messages,
                abortSignal: input.abort,
              })
            },
            catch: (error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error) }),
          }),
      }),
    ]),
  )
}

export * as LLMNativeRuntime from "./native-runtime"
