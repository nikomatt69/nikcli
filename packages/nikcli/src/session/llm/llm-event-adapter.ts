import type { LLMEvent } from "@nikcli-ai/llm"
import { APICallError } from "@ai-sdk/provider"
import type { streamText } from "ai"
import { Log } from "@/util/log"

type Result = Awaited<ReturnType<typeof streamText>>
export type ProcessorStreamEvent = Result["fullStream"] extends AsyncIterable<infer T> ? T : never

const log = Log.create({ service: "llm-event-adapter" })

export function adapterState() {
  return {
    step: 0,
    text: 0,
    reasoning: 0,
    currentTextID: undefined as string | undefined,
    currentReasoningID: undefined as string | undefined,
    toolInputStarted: new Set<string>(),
    toolNames: {} as Record<string, string>,
    emittedStart: false,
  }
}

type AdapterState = ReturnType<typeof adapterState>

function finishReason(value: string | undefined): string {
  const valid = ["stop", "length", "content-filter", "tool-calls", "end-turn"]
  return valid.includes(value ?? "") ? (value as string) : "unknown"
}

/**
 * Map native `provider-error` events to `APICallError` so
 * `MessageV2.fromError` classifies them as `APIError` with
 * `isRetryable` preserved. Plain `Error` collapses to `UnknownError`
 * and loses SessionRetry auto-retry for throttles/429s (F1.2).
 *
 * Defensive: the LLM event contract may evolve; we validate the
 * expected fields at runtime so a missing/malformed event surfaces
 * a clear error instead of `undefined` reads.
 */
export function providerErrorToAPICallError(event: Extract<LLMEvent, { type: "provider-error" }>): APICallError {
  if (!event || typeof event !== "object") {
    throw new Error("providerErrorToAPICallError: event is not an object")
  }
  const rawMessage = (event as { message?: unknown }).message
  const message = typeof rawMessage === "string" && rawMessage.length > 0 ? rawMessage : "Provider error"
  const heuristicRetryable = /rate.?limit|throttl|overloaded|too many requests|\b429\b|\b503\b|\b529\b/i.test(message)
  const isRetryable = event.retryable === true || (event.retryable !== false && heuristicRetryable)

  let statusCode: number | undefined
  const meta = event.providerMetadata
  if (meta && typeof meta === "object") {
    for (const value of Object.values(meta as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue
      const record = value as Record<string, unknown>
      const status = record.statusCode ?? record.status ?? record.status_code
      if (typeof status === "number" && Number.isFinite(status)) {
        statusCode = status
        break
      }
      if (typeof status === "string" && /^\d{3}$/.test(status)) {
        statusCode = Number(status)
        break
      }
    }
  }

  return new APICallError({
    message,
    url: "nikcli://native-llm/provider-error",
    requestBodyValues: undefined,
    statusCode,
    responseHeaders: undefined,
    responseBody: undefined,
    isRetryable,
  })
}

function usageToAISDK(usage: LLMEvent & { type: "step-finish" }) {
  const u = usage.usage
  if (!u) return undefined
  return {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    reasoningTokens: u.reasoningTokens,
    totalTokens: u.totalTokens,
    cachedInputTokens: u.cacheReadInputTokens,
  }
}

function normalizeToolOutput(result: unknown): {
  output: unknown
  title?: string
  metadata?: Record<string, unknown>
} {
  if (result && typeof result === "object" && "type" in result) {
    const r = result as { type: string; value?: unknown }
    if (r.type === "text") {
      return { output: r.value ?? "" }
    }
    if (r.type === "json") {
      return { output: r.value }
    }
    if (r.type === "error") {
      return { output: String(r.value ?? "") }
    }
  }
  if (result && typeof result === "object" && "output" in result) {
    const o = result as {
      output?: unknown
      title?: string
      metadata?: Record<string, unknown>
    }
    return { output: o.output, title: o.title, metadata: o.metadata }
  }
  return { output: result }
}

export function mapLLMEvent(state: AdapterState, event: LLMEvent): ProcessorStreamEvent[] {
  switch (event.type) {
    case "request-start": {
      if (state.emittedStart) return []
      state.emittedStart = true
      return [{ type: "start" } as ProcessorStreamEvent]
    }

    case "step-start":
      return [{ type: "start-step" } as ProcessorStreamEvent]

    case "step-finish":
      return [
        {
          type: "finish-step",
          finishReason: finishReason(event.reason),
          usage: usageToAISDK(event),
          providerMetadata: event.providerMetadata,
        } as ProcessorStreamEvent,
      ]

    case "request-finish":
      return [
        {
          type: "finish",
          finishReason: finishReason(event.reason),
        } as ProcessorStreamEvent,
      ]

    case "text-start":
      state.currentTextID = event.id
      return [
        {
          type: "text-start",
          id: event.id,
          providerMetadata: event.providerMetadata,
        } as ProcessorStreamEvent,
      ]

    case "text-delta": // Native providers may emit deltas without text-start. The processor
    // needs a text part before it can persist the delta, so synthesize the
    // missing start at the adapter boundary.
    {
      const id = event.id ?? state.currentTextID ?? `text-${state.text++}`
      const out: ProcessorStreamEvent[] = []
      if (!state.currentTextID) {
        state.currentTextID = id
        out.push({
          type: "text-start",
          id,
          providerMetadata: event.providerMetadata,
        } as ProcessorStreamEvent)
      }
      out.push({
        type: "text-delta",
        id,
        text: event.text,
        providerMetadata: event.providerMetadata,
      } as ProcessorStreamEvent)
      return out
    }

    case "text-end":
      return [
        {
          type: "text-end",
          id: event.id,
          providerMetadata: event.providerMetadata,
        } as ProcessorStreamEvent,
      ]

    case "reasoning-delta": {
      const id = event.id ?? `reasoning-${state.reasoning}`
      const out: ProcessorStreamEvent[] = []
      if (state.currentReasoningID !== id) {
        if (state.currentReasoningID) {
          out.push({
            type: "reasoning-end",
            id: state.currentReasoningID,
          } as ProcessorStreamEvent)
        }
        state.currentReasoningID = id
        out.push({
          type: "reasoning-start",
          id,
          providerMetadata: event.providerMetadata,
        } as ProcessorStreamEvent)
      }
      out.push({
        type: "reasoning-delta",
        id,
        text: event.text,
        providerMetadata: event.providerMetadata,
      } as ProcessorStreamEvent)
      return out
    }

    case "tool-input-delta":
      return [
        {
          type: "tool-input-delta",
          id: event.id,
          toolName: event.name,
          delta: event.text,
          providerMetadata: event.providerMetadata,
        } as ProcessorStreamEvent,
      ]

    case "tool-call": {
      const out: ProcessorStreamEvent[] = []
      if (!state.toolInputStarted.has(event.id)) {
        state.toolInputStarted.add(event.id)
        state.toolNames[event.id] = event.name
        out.push({
          type: "tool-input-start",
          id: event.id,
          toolName: event.name,
          providerMetadata: event.providerMetadata,
        } as ProcessorStreamEvent)
        out.push({
          type: "tool-input-end",
          id: event.id,
        } as ProcessorStreamEvent)
      }
      out.push({
        type: "tool-call",
        toolCallId: event.id,
        toolName: event.name,
        input: event.input,
        providerMetadata: event.providerMetadata,
      } as ProcessorStreamEvent)
      return out
    }

    case "tool-result": {
      const normalized = normalizeToolOutput(event.result)
      return [
        {
          type: "tool-result",
          toolCallId: event.id,
          toolName: event.name,
          input: undefined,
          output: normalized,
        } as ProcessorStreamEvent,
      ]
    }

    case "tool-error":
      return [
        {
          type: "tool-error",
          toolCallId: event.id,
          toolName: event.name,
          input: undefined,
          error: new Error(event.message),
        } as ProcessorStreamEvent,
      ]

    case "provider-error":
      throw providerErrorToAPICallError(event)

    default: {
      log.debug("unmapped llm event", {
        type: (event as { type?: string }).type,
      })
      return []
    }
  }
}

export async function* toProcessorStream(llmEvents: AsyncIterable<LLMEvent>): AsyncGenerator<ProcessorStreamEvent> {
  const state = adapterState()
  try {
    for await (const event of llmEvents) {
      for (const mapped of mapLLMEvent(state, event)) {
        yield mapped
      }
    }
    if (state.currentReasoningID) {
      yield {
        type: "reasoning-end",
        id: state.currentReasoningID,
      } as ProcessorStreamEvent
    }
  } catch (e) {
    if (e instanceof Error) throw e
    throw new Error(String(e))
  }
}

export function suppressEmptyTextResult<
  T extends {
    fullStream: AsyncIterable<ProcessorStreamEvent>
    text: Promise<string>
  },
>(result: T): T {
  result.text.catch(() => {})
  return result
}

export * as LLMEventAdapter from "./llm-event-adapter"
