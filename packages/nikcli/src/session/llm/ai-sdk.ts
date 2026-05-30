import type { LLMEvent } from "@nikcli-ai/llm"
import type { streamText } from "ai"
import { errorMessage } from "@/util/error"

type Result = Awaited<ReturnType<typeof streamText>>
type AISDKEvent = Result["fullStream"] extends AsyncIterable<infer T> ? T : never

export function adapterState() {
  return {
    step: 0,
    text: 0,
    reasoning: 0,
    currentTextID: undefined as string | undefined,
    currentReasoningID: undefined as string | undefined,
    toolNames: {} as Record<string, string>,
  }
}

type AdapterState = ReturnType<typeof adapterState>

function finishReason(value: string | undefined): string {
  const valid = ["stop", "length", "content-filter", "tool-calls", "end-turn"]
  return valid.includes(value ?? "") ? (value as string) : "unknown"
}

export function toLLMEvents(state: AdapterState, event: AISDKEvent): LLMEvent[] {
  switch (event.type) {
    case "start":
      return []

    case "start-step":
      return [{ type: "step-start", index: state.step } as LLMEvent]

    case "finish-step":
      return [{ type: "step-finish", index: state.step++, reason: finishReason(event.finishReason) } as LLMEvent]

    case "finish": {
      const events = [{ type: "request-finish", reason: finishReason(event.finishReason) } as LLMEvent]
      Object.assign(state, adapterState())
      return events
    }

    case "text-start":
      state.currentTextID = event.id ?? `text-${state.text++}`
      return [{ type: "text-start", id: state.currentTextID } as LLMEvent]

    case "text-delta":
      return [{ type: "text-delta", id: state.currentTextID, text: event.text } as LLMEvent]

    case "text-end": {
      const id = state.currentTextID ?? ""
      state.currentTextID = undefined
      return [{ type: "text-end", id } as LLMEvent]
    }

    case "reasoning-start":
      state.currentReasoningID = event.id ?? `reasoning-${state.reasoning++}`
      return []

    case "reasoning-delta":
      return [{ type: "reasoning-delta", id: state.currentReasoningID, text: event.text } as LLMEvent]

    case "reasoning-end":
      state.currentReasoningID = undefined
      return []

    case "tool-input-start":
      state.toolNames[event.id] = event.toolName
      return []

    case "tool-input-delta":
      return []

    case "tool-input-end":
      return []

    case "tool-call":
      state.toolNames[event.toolCallId] = event.toolName
      return [{ type: "tool-call", id: event.toolCallId, name: event.toolName, input: event.input } as LLMEvent]

    case "tool-result": {
      const name = state.toolNames[event.toolCallId] ?? "unknown"
      delete state.toolNames[event.toolCallId]
      return [
        {
          type: "tool-result",
          id: event.toolCallId,
          name,
          result: event.output,
        } as LLMEvent,
      ]
    }

    case "tool-error": {
      const name = state.toolNames[event.toolCallId] ?? ("toolName" in event ? event.toolName : "unknown")
      delete state.toolNames[event.toolCallId]
      return [{ type: "tool-error", id: event.toolCallId, name, message: errorMessage(event.error) } as LLMEvent]
    }

    case "error":
      throw event.error

    case "abort":
    case "source":
    case "file":
    case "raw":
      return []

    default: {
      void event
      return []
    }
  }
}

export * as LLMAISDK from "./ai-sdk"
