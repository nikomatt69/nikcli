/**
 * Native runtime bridge to @nikcli-ai/llm.
 *
 * Request-only streaming: tools are advertised as schemas; session processor
 * executes tools (same contract as AI SDK streamText).
 */
import type { Auth } from "@/auth"
import type { Provider } from "@/provider/provider"
import type { ModelMessage } from "ai"
import type { LLMEvent, LLMRequest, ModelRef } from "@nikcli-ai/llm"
import { streamRequest as llmStreamRequest } from "@nikcli-ai/llm/runtime"

export type RuntimeStatus = { readonly type: "supported" } | { readonly type: "unsupported"; readonly reason: string }

export type StreamResult =
  | { readonly type: "supported"; readonly events: AsyncIterable<LLMEvent> }
  | { readonly type: "unsupported"; readonly reason: string }

type StreamInput = {
  readonly model: Provider.Model
  readonly provider: Provider.Info
  readonly auth: Auth.Info | undefined
  readonly modelRef: ModelRef
  readonly llmRequest: LLMRequest
  readonly messages: ModelMessage[]
  readonly abort: AbortSignal
}

export function status(input: {
  readonly model: Provider.Model
  readonly provider: Provider.Info
  readonly auth: Auth.Info | undefined
  readonly modelRef: ModelRef | undefined
}): RuntimeStatus {
  if (!input.modelRef) {
    return { type: "unsupported", reason: "model ref is not resolved" }
  }

  if (input.auth?.type === "oauth") {
    if (input.provider.id !== "openai") {
      return {
        type: "unsupported",
        reason: "OAuth auth is only supported for openai in native runtime",
      }
    }
    const fetch = providerFetch(input)
    if (!fetch) {
      return {
        type: "unsupported",
        reason: "OAuth auth requires a provider fetch override",
      }
    }
    // P0: OAuth fetch override is not wired into LLMRuntime.streamRequest yet — fall back to AI SDK.
    return {
      type: "unsupported",
      reason: "OAuth native streaming is not enabled in P0 (use AI SDK)",
    }
  }

  const apiKey = typeof input.provider.options.apiKey === "string" ? input.provider.options.apiKey : input.provider.key
  if (!apiKey) {
    return { type: "unsupported", reason: "API key is not configured" }
  }

  return { type: "supported" }
}

export function streamRequestOnly(input: StreamInput): StreamResult {
  const current = status({
    model: input.model,
    provider: input.provider,
    auth: input.auth,
    modelRef: input.modelRef,
  })
  if (current.type === "unsupported") return current

  return {
    type: "supported",
    events: llmStreamRequest(input.llmRequest),
  }
}

function providerFetch(input: Pick<StreamInput, "provider" | "auth">): typeof globalThis.fetch | undefined {
  if (input.provider.id !== "openai" || input.auth?.type !== "oauth") return undefined
  const value: unknown = input.provider.options.fetch
  if (typeof value !== "function") return undefined
  return value as typeof globalThis.fetch
}

export * as LLMNativeRuntime from "./native-runtime"
