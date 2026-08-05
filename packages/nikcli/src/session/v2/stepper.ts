import { produce, enablePatches } from "immer"
import { SessionEvent } from "./event"
import { SessionEntry } from "./entry"
import { Identifier } from "@/id/id"

// Enable immer patches for replay functionality
enablePatches()

/**
 * Stepper — the reducer that turns a `SessionEvent` stream into flat
 * `SessionEntry` state.
 *
 * With the flat entry model every streamed part is a top-level entry, so a
 * live delta is an upsert keyed on `ref` (the originating v1 part id) rather
 * than a rewrite of a nested `parts[]` array. That keeps `stepWith`
 * idempotent for streams that re-emit the same part once per token, which is
 * what both the live projector and the durable-log replay depend on.
 */
export namespace Stepper {
  // ============================================================================
  // Types
  // ============================================================================

  /**
   * The complete memory state managed by the stepper.
   *
   * `entries` holds sealed conversation history; `pending` holds the
   * in-flight assistant step, which is flushed into `entries` by a
   * `step.ended` event.
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
    | { type: "upsertPending"; entry: SessionEntry.Entry }
    | { type: "removePending"; ref: string }
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
   * Index of the entry an incoming one replaces, or -1.
   *
   * Identity is the originating v1 part (`ref`); a tool additionally matches
   * on `callID` so its pending → running → completed transitions collapse
   * onto one entry even if the underlying part id changes.
   */
  function indexOf(entries: SessionEntry.Entry[], entry: SessionEntry.Entry): number {
    const ref = SessionEntry.refOf(entry)
    return entries.findIndex((existing) => {
      if (ref !== undefined && SessionEntry.refOf(existing) === ref) return true
      if (entry.type === "tool" && existing.type === "tool" && existing.callID === entry.callID) return true
      return false
    })
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
        case "upsertPending": {
          // Live streams re-emit the same part many times, so the reduction
          // must replace in place rather than append. An entry with no match
          // is new and lands at the end of the step.
          const index = indexOf(draft.pending, action.entry)
          if (index >= 0) {
            // keep the id the entry was first seen with: consumers key
            // renders on it, and the id is the stable position in the step
            const existing = draft.pending[index]!
            draft.pending[index] = { ...action.entry, id: existing.id }
            break
          }
          draft.pending.push(action.entry)
          break
        }
        case "removePending": {
          const index = draft.pending.findIndex((existing) => SessionEntry.refOf(existing) === action.ref)
          if (index >= 0) draft.pending.splice(index, 1)
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
    const timestamp = event.timestamp ?? Date.now()
    const base = { id: Identifier.ascending("event"), sessionID, timestamp }

    switch (event.type) {
      case "prompt": {
        const entry = SessionEntry.User.parse({
          ...base,
          messageID: event.messageID,
          type: "user",
          text: event.text,
          files: event.files,
          agents: event.agents,
        })
        return reduce(state, { type: "append", entry })
      }

      case "synthetic": {
        const entry = SessionEntry.Synthetic.parse({
          ...base,
          messageID: event.messageID,
          type: "synthetic",
          text: event.text,
          role: event.role,
        })
        return reduce(state, { type: "append", entry })
      }

      case "step.started": {
        const entry = SessionEntry.Request.parse({
          ...base,
          messageID: event.messageID,
          type: "start",
          providerID: event.providerID,
          modelID: event.modelID,
          agent: event.agent,
          snapshot: event.snapshot,
        })
        return reduce(state, { type: "appendPending", entry })
      }

      case "step.ended": {
        // The step is sealed by its own entry, then the whole pending tail
        // moves into history in one shot.
        const entry = SessionEntry.Complete.parse({
          ...base,
          messageID: event.messageID,
          type: "complete",
          reason: event.reason,
          cost: event.cost,
          tokens: event.tokens,
          finish: event.finish,
          error: event.error,
        })
        return reduce(reduce(state, { type: "appendPending", entry }), {
          type: "finish",
          result: { finish: event.finish },
        })
      }

      case "part.updated": {
        const entry = SessionEntry.fromV1Part(event.part, { sessionID, timestamp })
        if (!entry) return state
        return reduce(state, { type: "upsertPending", entry })
      }

      case "part.removed": {
        return reduce(state, { type: "removePending", ref: event.partID })
      }

      case "retry.error": {
        const entry = SessionEntry.Retry.parse({
          ...base,
          messageID: event.messageID,
          type: "retry",
          attempt: event.attempt,
          error: event.error,
        })
        return reduce(state, { type: "appendPending", entry })
      }

      case "compaction": {
        const entry = SessionEntry.Compaction.parse({
          ...base,
          messageID: event.messageID,
          type: "compaction",
          auto: event.auto,
          overflow: event.overflow,
        })
        return reduce(state, { type: "append", entry })
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
