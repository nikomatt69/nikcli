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

  // ADR (A4 / misty-moon 2026-07-08): OAuth sessions always use the AI SDK path.
  // `@nikcli-ai/llm` streamRequest does not accept a provider `fetch` override yet,
  // so openai OAuth (and any other oauth) stay unsupported here and fall back in llm.ts.
  // Revisit when LLMRequest/runtime gains custom fetch; until then this is intentional.
  if (input.auth?.type === "oauth") {
    return {
      type: "unsupported",
      reason: "OAuth native streaming uses AI SDK (fetch override not wired into @nikcli-ai/llm)",
    }
  }

  const apiKey = typeof input.provider.options.apiKey === "string" ? input.provider.options.apiKey : input.provider.key
  if (!apiKey) {
    return { type: "unsupported", reason: "API key is not configured" }
  }

  return { type: "supported" }
}

/**
 * Race an async iterable against an AbortSignal so cancel maps to
 * DOMException AbortError (MessageV2.fromError → MessageAbortedError).
 * `@nikcli-ai/llm` streamRequest has no abort param yet (A2 wrapper).
 *
 * The abort listener is always detached after the race resolves (either
 * by iterator.next() winning or by abort firing) to prevent listener
 * accumulation on chatty streams.
 */
export async function* abortableIterable<T>(source: AsyncIterable<T>, abort: AbortSignal): AsyncGenerator<T> {
  if (abort.aborted) {
    throw new DOMException("Aborted", "AbortError")
  }

  const iterator = source[Symbol.asyncIterator]()
  try {
    while (true) {
      if (abort.aborted) {
        throw new DOMException("Aborted", "AbortError")
      }

      let onAbort: (() => void) | undefined
      const next = await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => {
          if (abort.aborted) {
            reject(new DOMException("Aborted", "AbortError"))
            return
          }
          onAbort = () => {
            reject(new DOMException("Aborted", "AbortError"))
          }
          abort.addEventListener("abort", onAbort, { once: true })
        }),
      ])
      // Always detach the abort listener, regardless of which side won the race.
      // `{ once: true }` only auto-removes on fire, so we must remove explicitly
      // when iterator.next() wins to avoid listener accumulation.
      if (onAbort) abort.removeEventListener("abort", onAbort)

      if (next.done) return
      yield next.value
    }
  } finally {
    await iterator.return?.()
  }
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
    events: abortableIterable(llmStreamRequest(input.llmRequest), input.abort),
  }
}

export * as LLMNativeRuntime from "./native-runtime"
