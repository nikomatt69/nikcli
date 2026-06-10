import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import z from "zod"
import { Session } from "../index"
import { MessageV2 } from "../message-v2"

/**
 * SessionProjector — live v2 read model over the v1 session engine.
 *
 * The v1 engine (session/processor.ts) stays the only writer: it persists
 * messages and publishes `message.updated` / `message.part.updated` /
 * `message.part.removed` on the Bus. This projector subscribes to those
 * events and mirrors ONLY the in-flight (not yet completed) assistant
 * messages, so `SessionV2.state()` can expose live pending entries without
 * touching the engine — migration by strangler, no behavior change in v1.
 *
 * Memory is bounded by construction: a message is dropped from the mirror
 * the moment v1 marks it completed (it is then readable from storage via
 * `SessionV2.entries()`), when it is removed, or when its session is
 * deleted/disposed.
 *
 * Consumers that need character-level deltas keep using the v1
 * `message.part.updated` events; `session.v2.updated` fires only on
 * entry-grade changes (message lifecycle, tool state transitions, part
 * removal) to stay quiet during text streaming.
 */
export namespace SessionProjector {
  const log = Log.create({ service: "session.v2.projector" })

  export const Event = {
    Updated: BusEvent.define(
      "session.v2.updated",
      z.object({
        sessionID: z.string(),
      }),
    ),
  }

  interface Mirror {
    info: MessageV2.Assistant
    parts: Map<string, MessageV2.Part>
  }

  interface State {
    /** messageID → in-flight assistant message mirror */
    inflight: Map<string, Mirror>
    /** sessionID → in-flight messageIDs, for session-level lookup/cleanup */
    bySession: Map<string, Set<string>>
    unsubscribes: (() => void)[]
  }

  const state = Instance.state<State>(
    () => {
      const s: State = {
        inflight: new Map(),
        bySession: new Map(),
        unsubscribes: [],
      }

      const track = (info: MessageV2.Info) => {
        if (info.role !== "assistant") return
        if (info.time.completed) {
          drop(s, info.id, info.sessionID)
          publish(info.sessionID)
          return
        }
        const existing = s.inflight.get(info.id)
        if (existing) {
          existing.info = info
          return
        }
        s.inflight.set(info.id, { info, parts: new Map() })
        let ids = s.bySession.get(info.sessionID)
        if (!ids) {
          ids = new Set()
          s.bySession.set(info.sessionID, ids)
        }
        ids.add(info.id)
        publish(info.sessionID)
      }

      s.unsubscribes.push(
        Bus.subscribe(MessageV2.Event.Updated, (event) => {
          track(event.properties.info)
        }),
        Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
          const part = event.properties.part
          const mirror = s.inflight.get(part.messageID)
          if (!mirror) return
          const previous = mirror.parts.get(part.id)
          mirror.parts.set(part.id, part)
          if (entryGradeChange(previous, part)) publish(part.sessionID)
        }),
        Bus.subscribe(MessageV2.Event.PartRemoved, (event) => {
          const mirror = s.inflight.get(event.properties.messageID)
          if (!mirror) return
          mirror.parts.delete(event.properties.partID)
          publish(event.properties.sessionID)
        }),
        Bus.subscribe(MessageV2.Event.Removed, (event) => {
          drop(s, event.properties.messageID, event.properties.sessionID)
          publish(event.properties.sessionID)
        }),
        Bus.subscribe(Session.Event.Deleted, (event) => {
          clearSession(s, event.properties.info.id)
        }),
      )

      log.info("initialized")
      return s
    },
    async (s) => {
      for (const unsubscribe of s.unsubscribes) unsubscribe()
      s.inflight.clear()
      s.bySession.clear()
    },
  )

  function drop(s: State, messageID: string, sessionID: string) {
    s.inflight.delete(messageID)
    const ids = s.bySession.get(sessionID)
    if (!ids) return
    ids.delete(messageID)
    if (ids.size === 0) s.bySession.delete(sessionID)
  }

  function clearSession(s: State, sessionID: string) {
    const ids = s.bySession.get(sessionID)
    if (!ids) return
    for (const id of ids) s.inflight.delete(id)
    s.bySession.delete(sessionID)
  }

  /** Tool state transitions and structural parts matter; raw text/reasoning deltas do not. */
  function entryGradeChange(previous: MessageV2.Part | undefined, next: MessageV2.Part): boolean {
    if (next.type === "text" || next.type === "reasoning") return previous === undefined
    if (next.type === "tool") {
      return previous?.type !== "tool" || previous.state.status !== next.state.status
    }
    return true
  }

  function publish(sessionID: string) {
    void Bus.publish(Event.Updated, { sessionID })
  }

  /** Initialize (idempotent — first call per instance subscribes). */
  export function init() {
    state()
  }

  /** In-flight assistant messages for a session, parts ordered by ascending id. */
  export function inflight(sessionID: string): MessageV2.WithParts[] {
    const s = state()
    const ids = s.bySession.get(sessionID)
    if (!ids) return []
    const result: MessageV2.WithParts[] = []
    for (const id of [...ids].sort()) {
      const mirror = s.inflight.get(id)
      if (!mirror) continue
      result.push({
        info: mirror.info,
        parts: [...mirror.parts.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      })
    }
    return result
  }

  /** Drop all live state for a session. */
  export function clear(sessionID: string) {
    clearSession(state(), sessionID)
  }
}
