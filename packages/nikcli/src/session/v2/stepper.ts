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
    | { type: "upsertPart"; part: SessionEntry.AssistantText["parts"][number] }
    | { type: "removePart"; ref: string }
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

  /** The open step: a pending assistant-text entry that parts attach to. */
  function isOpenStep(entry: SessionEntry.Entry): entry is SessionEntry.AssistantText {
    return entry.role === "assistant" && entry.sub === "text"
  }

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
        case "upsertPart": {
          // Attach a part to the open (last pending assistant-text) step —
          // `findLast` because a retry entry may sit after the open step.
          // Idempotent: a part with the same originating v1 part (`ref`)
          // replaces in place, and a tool-result replaces its tool-call
          // (same toolCallId). Without an open step there is nowhere
          // coherent to put it.
          const open = draft.pending.findLast(isOpenStep)
          if (!open) break
          const part = action.part
          const index = open.parts.findIndex(
            (existing) =>
              (part.ref !== undefined && existing.ref === part.ref) ||
              (part.type === "tool-result" && existing.type === "tool-call" && existing.toolCallId === part.toolCallId),
          )
          if (index >= 0) open.parts[index] = part
          else open.parts.push(part)
          break
        }
        case "removePart": {
          const open = draft.pending.findLast(isOpenStep)
          if (!open) break
          const index = open.parts.findIndex((existing) => existing.ref === action.ref)
          if (index >= 0) open.parts.splice(index, 1)
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
        // The v1 part is converted to its v2 shape and upserted into the open
        // assistant step: live streams re-emit the same part (same `ref`)
        // many times, so the reduction must be idempotent, not append-only.
        const part = SessionEntry.fromV1Part(event.part)
        if (!part) return state
        if (state.pending.some(isOpenStep)) {
          return reduce(state, { type: "upsertPart", part })
        }
        const entry = SessionEntry.AssistantText.parse({
          id: Identifier.ascending("event"),
          sessionID,
          timestamp: event.timestamp ?? Date.now(),
          role: "assistant",
          sub: "text",
          modelID: "",
          providerID: "",
          agent: "",
          parts: [part],
        })
        return reduce(state, { type: "appendPending", entry })
      }

      case "part.removed": {
        return reduce(state, { type: "removePart", ref: event.partID })
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
