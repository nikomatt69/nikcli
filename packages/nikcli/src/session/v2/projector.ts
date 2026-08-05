import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import z from "zod"
import { Schema } from "effect"
import { Session } from "../index"
import { MessageV2 } from "../message-v2"
import { SessionEvent } from "./event"
import { SessionV2EventRepo } from "./event-repo"
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
 *
 * The translated events are also written to the durable event log
 * (`SessionV2EventRepo`) at the same entry-grade cadence: lifecycle events
 * immediately, part updates coalesced per part and flushed on grade changes
 * and at completion (sealed with a synthesized `step.ended`). Persistence
 * failures are logged and never break the live reduction.
 */
export namespace SessionProjector {
  const log = Log.create({ service: "session.v2.projector" })

  export const Event = {
    Updated: BusEvent.schema(
      "session.v2.updated",
      Schema.Struct({
        sessionID: Schema.String,
      }),
    ),
  }

  interface Live {
    state: Stepper.MemoryState
    /** messageID of the in-flight assistant message being reduced */
    inflight?: string
    /** partID → last entry-grade signature, to publish only on grade changes */
    seen: Map<string, string>
    /** partID → latest translated part.updated event, flushed to the log on
     * grade changes and on completion (per-delta writes would reintroduce
     * the per-token disk write problem) */
    latest: Map<string, SessionEvent.Event>
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
          target = { state: empty(), seen: new Map(), latest: new Map() }
          s.sessions.set(sessionID, target)
        }
        return target
      }

      const step = (target: Live, sessionID: string, draft: SessionEvent.Draft) => {
        const event = SessionEvent.create(draft)
        target.state = Stepper.stepWith(target.state, memoryAdapter, sessionID, event)
        return event
      }

      const persist = (event: SessionEvent.Event) => {
        try {
          SessionV2EventRepo.append(event)
        } catch (error) {
          log.error("failed to persist v2 event", { type: event.type, error })
        }
      }

      const drop = (target: Live) => {
        target.state = empty()
        target.inflight = undefined
        target.seen.clear()
        target.latest.clear()
      }

      s.unsubscribes.push(
        Bus.subscribe(MessageV2.Event.Updated, (event) => {
          const info = event.properties.info
          if (info.role !== "assistant") return
          const target = live(info.sessionID)
          if (info.time.completed) {
            if (target.inflight !== info.id) return
            // flush the coalesced part rows and seal the step in the event
            // log before storage becomes authoritative for the message
            for (const event of target.latest.values()) persist(event)
            persist(
              SessionEvent.create({
                type: "step.ended",
                sessionID: info.sessionID,
                messageID: info.id,
                reason: info.error ? "error" : "completed",
                cost: info.cost,
                tokens: info.tokens,
                finish: info.finish,
                error: info.error,
              }),
            )
            // storage is authoritative from here on: drop the live tail
            drop(target)
            publish(info.sessionID)
            return
          }
          if (target.inflight === info.id) return
          // a new assistant message went in flight: restart the reduction
          drop(target)
          target.inflight = info.id
          persist(
            step(target, info.sessionID, {
              type: "step.started",
              sessionID: info.sessionID,
              messageID: info.id,
              providerID: info.providerID,
              modelID: info.modelID,
              agent: info.agent,
            }),
          )
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
            persist(
              step(target, part.sessionID, {
                type: "retry.error",
                sessionID: part.sessionID,
                messageID: part.messageID,
                attempt: part.attempt,
                error: part.error,
              }),
            )
            publish(part.sessionID)
            return
          }
          const grade = part.type === "tool" ? part.state.status : "·"
          const before = target.seen.get(part.id)
          target.seen.set(part.id, grade)
          const translated = step(target, part.sessionID, {
            type: "part.updated",
            sessionID: part.sessionID,
            part,
          })
          target.latest.set(part.id, translated)
          if (before === undefined || before !== grade) {
            persist(translated)
            publish(part.sessionID)
          }
        }),
        Bus.subscribe(MessageV2.Event.PartRemoved, (event) => {
          const { sessionID, messageID, partID } = event.properties
          const target = s.sessions.get(sessionID)
          if (!target || target.inflight !== messageID) return
          target.seen.delete(partID)
          target.latest.delete(partID)
          step(target, sessionID, { type: "part.removed", sessionID, messageID, partID })
          // a removed part un-happened: its coalesced row goes with it
          try {
            SessionV2EventRepo.removePart(partID)
          } catch (error) {
            log.error("failed to remove v2 event row", { partID, error })
          }
          publish(sessionID)
        }),
        Bus.subscribe(MessageV2.Event.Removed, (event) => {
          const { sessionID, messageID } = event.properties
          const target = s.sessions.get(sessionID)
          if (!target || target.inflight !== messageID) return
          drop(target)
          try {
            SessionV2EventRepo.removeMessage(messageID)
          } catch (error) {
            log.error("failed to remove v2 event rows", { messageID, error })
          }
          publish(sessionID)
        }),
        Bus.subscribe(Session.Event.Deleted, (event) => {
          s.sessions.delete(event.properties.info.id)
          try {
            SessionV2EventRepo.clear(event.properties.info.id)
          } catch (error) {
            log.error("failed to clear v2 event rows", { sessionID: event.properties.info.id, error })
          }
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
