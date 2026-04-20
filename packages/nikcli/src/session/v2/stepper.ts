import { produce, enablePatches } from "immer"
import { SessionEvent } from "./event"
import { SessionEntry } from "./entry"
import { Identifier } from "@/id/id"

// Enable immer patches for replay functionality
enablePatches()

export namespace Stepper {
  // ============================================================================
  // Types
  // ============================================================================

  /**
   * The complete memory state managed by the stepper
   */
  export interface MemoryState {
    entries: SessionEntry.Entry[]
    pending: SessionEntry.Entry[]
  }

  /**
   * Adapter interface for external state management
   */
  export interface Adapter<R = unknown> {
    getCurrentAssistant(sessionID: string): R | undefined
    appendEntry(sessionID: string, entry: SessionEntry.Entry): Promise<void>
    appendPending(sessionID: string, entry: SessionEntry.Entry): Promise<void>
    removeLastPending(sessionID: string): Promise<void>
    replacePending(sessionID: string, entries: SessionEntry.Entry[]): Promise<void>
    finish(sessionID: string, result: StepResult): Promise<void>
  }

  /**
   * Result of a completed step
   */
  export interface StepResult {
    finish?: string
    usage?: {
      inputTokens?: number
      outputTokens?: number
      reasoningTokens?: number
      totalTokens?: number
    }
  }

  /**
   * Reducer action for the stepper
   */
  export type Action =
    | { type: "append"; entry: SessionEntry.Entry }
    | { type: "appendPending"; entry: SessionEntry.Entry }
    | { type: "removeLastPending" }
    | { type: "replacePending"; entries: SessionEntry.Entry[] }
    | { type: "finish"; result: StepResult }
    | { type: "reset" }

  // ============================================================================
  // In-memory adapter
  // ============================================================================

  /**
   * In-memory adapter that keeps state in a Map
   */
  export function memory(initial: MemoryState = { entries: [], pending: [] }): {
    adapter: Adapter<MemoryState>
    state: MemoryState
  } {
    const state: MemoryState = {
      entries: [...initial.entries],
      pending: [...initial.pending],
    }

    const adapter: Adapter<MemoryState> = {
      getCurrentAssistant() {
        return state
      },
      async appendEntry(_sessionID, entry) {
        state.entries.push(entry)
      },
      async appendPending(_sessionID, entry) {
        state.pending.push(entry)
      },
      async removeLastPending(_sessionID) {
        state.pending.pop()
      },
      async replacePending(_sessionID, entries) {
        state.pending = entries
      },
      async finish(_sessionID) {
        state.entries.push(...state.pending)
        state.pending = []
      },
    }

    return { adapter, state }
  }

  // ============================================================================
  // Reducer
  // ============================================================================

  /**
   * Produce the next state based on an action (immer producer)
   */
  export function reduce(state: MemoryState, action: Action): MemoryState {
    return produce(state, (draft) => {
      switch (action.type) {
        case "append": {
          draft.entries.push(action.entry)
          break
        }
        case "appendPending": {
          draft.pending.push(action.entry)
          break
        }
        case "removeLastPending": {
          draft.pending.pop()
          break
        }
        case "replacePending": {
          draft.pending = action.entries
          break
        }
        case "finish": {
          draft.entries.push(...draft.pending)
          draft.pending = []
          break
        }
        case "reset": {
          draft.entries = []
          draft.pending = []
          break
        }
      }
    })
  }

  /**
   * Apply an event from the event stream and produce new state
   */
  export function stepWith(
    state: MemoryState,
    _adapter: Adapter,
    sessionID: string,
    event: SessionEvent.Event,
  ): MemoryState {
    switch (event.type) {
      case "prompt": {
        const entry = SessionEntry.User.parse({
          id: Identifier.ascending("event"),
          sessionID,
          timestamp: event.timestamp ?? Date.now(),
          role: "user",
          text: event.text,
          files: event.files,
          agents: event.agents,
        })
        return reduce(state, { type: "append", entry })
      }

      case "synthetic": {
        const entry = SessionEntry.Synthetic.parse({
          id: Identifier.ascending("event"),
          sessionID,
          timestamp: event.timestamp ?? Date.now(),
          role: "synthetic",
          text: event.text,
          roleType: event.role,
        })
        return reduce(state, { type: "append", entry })
      }

      case "step.started": {
        const entry = SessionEntry.AssistantText.parse({
          id: Identifier.ascending("event"),
          sessionID,
          timestamp: event.timestamp ?? Date.now(),
          role: "assistant",
          sub: "text",
          modelID: event.modelID,
          providerID: event.providerID,
          agent: event.agent,
          parts: [],
        })
        return reduce(state, { type: "appendPending", entry })
      }

      case "step.ended": {
        return reduce(state, { type: "finish", result: { finish: event.finish } })
      }

      case "part.updated": {
        const part = event.part
        if (part.type === "text" || part.type === "reasoning" || part.type === "tool") {
          const entry = SessionEntry.AssistantText.parse({
            id: Identifier.ascending("event"),
            sessionID,
            timestamp: event.timestamp ?? Date.now(),
            role: "assistant",
            sub: "text",
            modelID: "",
            providerID: "",
            agent: "",
            parts: [
              part as
                | SessionEntry.TextPart
                | SessionEntry.ReasoningPart
                | SessionEntry.ToolCallPart
                | SessionEntry.ToolResultPart,
            ],
          })
          return reduce(state, { type: "appendPending", entry })
        }
        return state
      }

      case "part.removed": {
        return reduce(state, { type: "removeLastPending" })
      }

      case "retry.error": {
        const entry = SessionEntry.AssistantRetry.parse({
          id: Identifier.ascending("event"),
          sessionID,
          timestamp: event.timestamp ?? Date.now(),
          role: "assistant",
          sub: "retry",
          attempt: event.attempt,
          error: event.error,
        })
        return reduce(state, { type: "appendPending", entry })
      }

      default: {
        return state
      }
    }
  }

  // ============================================================================
  // Event stream processor
  // ============================================================================

  /**
   * Process a stream of events and apply them through the stepper
   */
  export async function processEvents(
    events: AsyncIterable<SessionEvent.Event>,
    adapter: Adapter,
    sessionID: string,
    initialState: MemoryState = { entries: [], pending: [] },
  ): Promise<MemoryState> {
    let state = initialState

    for await (const event of events) {
      state = stepWith(state, adapter, sessionID, event)
    }

    return state
  }
}
