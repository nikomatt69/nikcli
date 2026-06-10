import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import z from "zod"
import { Session } from "../index"
import { MessageV2 } from "../message-v2"
import { SessionEvent } from "./event"
import { Stepper } from "./stepper"

/**
 * SessionProjector — live v2 read model over the v1 session engine.
 *
 * The v1 engine (session/processor.ts) stays the only writer: it persists
 * messages and publishes `message.updated` / `message.part.updated` /
 * `message.part.removed` on the Bus. This projector translates those events
 * into the v2 `SessionEvent` vocabulary and reduces them through
 * `Stepper.stepWith`, so the live tail a consumer reads from `snapshot()` is
 * produced by the exact reducer the future native v2 engine will use —
 * migration by strangler, no behavior change in v1.
 *
 * Memory is bounded by construction: only the single in-flight assistant
 * message per session is reduced, and its state is dropped the moment v1
 * marks it completed (it is then readable from storage via
 * `SessionV2.entries()`), when it is removed, or when its session is
 * deleted/disposed.
 *
 * Consumers that need character-level deltas keep using the v1
 * `message.part.updated` events; `session.v2.updated` fires only on
 * entry-grade changes (message lifecycle, tool state transitions, retries,
 * part removal) to stay quiet during text streaming.
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

  interface Live {
    state: Stepper.MemoryState
    /** messageID of the in-flight assistant message being reduced */
    inflight?: string
    /** partID → last entry-grade signature, to publish only on grade changes */
    seen: Map<string, string>
  }

  interface State {
    /** sessionID → live reduction */
    sessions: Map<string, Live>
    unsubscribes: (() => void)[]
  }

  const empty = (): Stepper.MemoryState => ({ entries: [], pending: [] })

  // stepWith's adapter is not consulted on the in-memory reduction path; a
  // single shared no-op instance keeps the call sites honest.
  const memoryAdapter = Stepper.memory().adapter

  const state = Instance.state<State>(
    () => {
      const s: State = {
        sessions: new Map(),
        unsubscribes: [],
      }

      const live = (sessionID: string): Live => {
        let target = s.sessions.get(sessionID)
        if (!target) {
          target = { state: empty(), seen: new Map() }
          s.sessions.set(sessionID, target)
        }
        return target
      }

      const step = (target: Live, sessionID: string, draft: SessionEvent.Draft) => {
        target.state = Stepper.stepWith(target.state, memoryAdapter, sessionID, SessionEvent.create(draft))
      }

      const drop = (target: Live) => {
        target.state = empty()
        target.inflight = undefined
        target.seen.clear()
      }

      s.unsubscribes.push(
        Bus.subscribe(MessageV2.Event.Updated, (event) => {
          const info = event.properties.info
          if (info.role !== "assistant") return
          const target = live(info.sessionID)
          if (info.time.completed) {
            if (target.inflight !== info.id) return
            // storage is authoritative from here on: drop the live tail
            drop(target)
            publish(info.sessionID)
            return
          }
          if (target.inflight === info.id) return
          // a new assistant message went in flight: restart the reduction
          drop(target)
          target.inflight = info.id
          step(target, info.sessionID, {
            type: "step.started",
            sessionID: info.sessionID,
            messageID: info.id,
            providerID: info.providerID,
            modelID: info.modelID,
            agent: info.agent,
          })
          publish(info.sessionID)
        }),
        Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
          const part = event.properties.part
          const target = s.sessions.get(part.sessionID)
          if (!target || target.inflight !== part.messageID) return
          if (part.type === "retry") {
            // retries are terminal per attempt — translate once
            if (target.seen.has(part.id)) return
            target.seen.set(part.id, "retry")
            step(target, part.sessionID, {
              type: "retry.error",
              sessionID: part.sessionID,
              messageID: part.messageID,
              attempt: part.attempt,
              error: part.error,
            })
            publish(part.sessionID)
            return
          }
          const grade = part.type === "tool" ? part.state.status : "·"
          const before = target.seen.get(part.id)
          target.seen.set(part.id, grade)
          step(target, part.sessionID, {
            type: "part.updated",
            sessionID: part.sessionID,
            part,
          })
          if (before === undefined || before !== grade) publish(part.sessionID)
        }),
        Bus.subscribe(MessageV2.Event.PartRemoved, (event) => {
          const { sessionID, messageID, partID } = event.properties
          const target = s.sessions.get(sessionID)
          if (!target || target.inflight !== messageID) return
          target.seen.delete(partID)
          step(target, sessionID, { type: "part.removed", sessionID, messageID, partID })
          publish(sessionID)
        }),
        Bus.subscribe(MessageV2.Event.Removed, (event) => {
          const { sessionID, messageID } = event.properties
          const target = s.sessions.get(sessionID)
          if (!target || target.inflight !== messageID) return
          drop(target)
          publish(sessionID)
        }),
        Bus.subscribe(Session.Event.Deleted, (event) => {
          s.sessions.delete(event.properties.info.id)
        }),
      )

      log.info("initialized")
      return s
    },
    async (s) => {
      for (const unsubscribe of s.unsubscribes) unsubscribe()
      s.sessions.clear()
    },
  )

  /** Initialize (idempotent — first call per instance subscribes). */
  export function init() {
    state()
  }

  /** Live v2 state for a session — `pending` is the in-flight assistant tail. */
  export function snapshot(sessionID: string): Stepper.MemoryState {
    return state().sessions.get(sessionID)?.state ?? empty()
  }

  /** Drop all live state for a session. */
  export function clear(sessionID: string) {
    state().sessions.delete(sessionID)
  }

  function publish(sessionID: string) {
    void Bus.publish(Event.Updated, { sessionID })
  }
}
