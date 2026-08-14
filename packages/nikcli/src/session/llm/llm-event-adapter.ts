import type { LLMEvent } from "@nikcli-ai/llm"
import { APICallError } from "@ai-sdk/provider"
import type { streamText } from "ai"
import { Log } from "@nikcli-ai/util/log"

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
    // A step is what the processor snapshots and bills against. No native
    // protocol emits step-start/step-finish — only request-start/request-finish
    // — so the adapter opens and closes the step itself, and these two guards
    // keep it from doubling up for a provider that emits both.
    stepOpen: false,
    stepFinished: false,
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

type FinishEvent = LLMEvent & { type: "step-finish" | "request-finish" }

function usageToAISDK(usage: FinishEvent) {
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

// `LanguageModelV2Usage` has no cache-write field, so Session.getUsage recovers
// it from provider metadata. The native protocols decode cache writes uniformly
// into `Usage.cacheWriteInputTokens`, so republish that under one provider-
// neutral key instead of forcing getUsage to learn every native shape.
function metadataWithCacheWrite(event: FinishEvent) {
  const write = event.usage?.cacheWriteInputTokens
  if (write === undefined) return event.providerMetadata
  return { ...event.providerMetadata, nikcli: { cacheWriteInputTokens: write } }
}

/**
 * The processor bills and snapshots on `finish-step`; without one, a whole
 * assistant turn persists with no finish reason, cost, or token count.
 */
function finishStep(state: AdapterState, event: FinishEvent): ProcessorStreamEvent[] {
  if (state.stepFinished) return []
  state.stepOpen = false
  state.stepFinished = true
  return [
    {
      type: "finish-step",
      finishReason: finishReason(event.reason),
      ...(event.rawReason ? { rawReason: event.rawReason } : {}),
      usage: usageToAISDK(event),
      providerMetadata: metadataWithCacheWrite(event),
    } as ProcessorStreamEvent,
  ]
}

function startStep(state: AdapterState): ProcessorStreamEvent[] {
  if (state.stepOpen) return []
  state.stepOpen = true
  state.stepFinished = false
  return [{ type: "start-step" } as ProcessorStreamEvent]
}

/**
 * Text and reasoning parts stay `pending` until closed. A provider that ends
 * the request without an explicit `text-end` would otherwise leave the last
 * part of the turn hanging in the UI.
 */
function closeOpenParts(state: AdapterState): ProcessorStreamEvent[] {
  const out: ProcessorStreamEvent[] = []
  if (state.currentReasoningID) {
    out.push({ type: "reasoning-end", id: state.currentReasoningID } as ProcessorStreamEvent)
    state.currentReasoningID = undefined
  }
  if (state.currentTextID) {
    out.push({ type: "text-end", id: state.currentTextID } as ProcessorStreamEvent)
    state.currentTextID = undefined
  }
  return out
}

/**
 * `ToolStateCompleted` demands a string output plus a title and metadata
 * record. nikcli builds those itself for the tools it runs, but a
 * provider-executed tool (Cursor's shell, OpenAI's web search) arrives as raw
 * JSON straight from the wire — persist that as-is and the completed part is
 * rejected by the schema.
 */
function providerExecutedOutput(
  name: string,
  normalized: { output: unknown; title?: string; metadata?: Record<string, unknown> },
) {
  const output =
    typeof normalized.output === "string" ? normalized.output : JSON.stringify(normalized.output ?? "", null, 2)
  return {
    output,
    title: normalized.title ?? name,
    metadata: normalized.metadata ?? {},
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
      return [{ type: "start" } as ProcessorStreamEvent, ...startStep(state)]
    }

    case "step-start":
      return startStep(state)

    case "step-finish":
      return finishStep(state, event)

    case "request-finish":
      return [
        ...closeOpenParts(state),
        ...finishStep(state, event),
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

    case "text-delta": {
      // missing start at the adapter boundary. // needs a text part before it can persist the delta, so synthesize the // Native providers may emit deltas without text-start. The processor
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
      if (state.currentTextID === event.id) state.currentTextID = undefined
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
        providerExecuted: event.providerExecuted,
        providerMetadata: event.providerMetadata,
      } as ProcessorStreamEvent)
      return out
    }

    case "tool-result": {
      // A provider-executed tool reports its own failures through the result
      // channel; surfacing that as a successful result would persist the error
      // text as tool output.
      const failed =
        event.result && typeof event.result === "object" && (event.result as { type?: string }).type === "error"
      if (failed) {
        return [
          {
            type: "tool-error",
            toolCallId: event.id,
            toolName: event.name,
            input: undefined,
            error: new Error(String((event.result as { value?: unknown }).value ?? "Tool failed")),
          } as ProcessorStreamEvent,
        ]
      }
      const normalized = normalizeToolOutput(event.result)
      return [
        {
          type: "tool-result",
          toolCallId: event.id,
          toolName: event.name,
          input: undefined,
          output: event.providerExecuted ? providerExecutedOutput(event.name, normalized) : normalized,
          providerExecuted: event.providerExecuted,
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
    // A stream that ends without `request-finish` (an aborted turn, a provider
    // that just closes the socket) still has to leave every part closed.
    for (const event of closeOpenParts(state)) {
      yield event
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
