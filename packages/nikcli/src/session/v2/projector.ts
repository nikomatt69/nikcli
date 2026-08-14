import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Schema } from "effect"
import { Session } from "../index"
import { MessageRepo } from "../message-repo"
import { MessageV2 } from "../message-v2"
import { SessionEntry } from "./entry"
import { SessionEntryRepo } from "./entry-repo"
import { SessionEvent } from "./event"
import { Stepper } from "./stepper"

/**
 * SessionProjector — the live half of the v2 projection.
 *
 * There are two halves and they are deliberately split:
 *
 *   persistence   `SessionEntryProjection`, run by the sync projectors inside
 *                 the transaction that writes the v1 row (session/projectors.ts)
 *   live          this module, driven by the v1 bus, publishing every entry
 *                 change as `session.entry.updated` / `.removed`
 *
 * They agree without coordinating because entry ids are *derived* from the v1
 * id they come from (`SessionEntry.idForPart` / `idForMessage`): a client that
 * applies a live event and a client that re-reads `/v2/entries` converge on
 * the same rows.
 *
 * The split exists because the two have different latencies on purpose.
 * Streaming text deltas are coalesced before they hit disk (150ms, see
 * `SessionProcessor.updatePartCoalesced`), so the table lags the stream; the
 * bus does not. Publishing from here gives consumers a per-token v2 stream
 * without a transaction per token, which is exactly the split v1 already uses
 * for messages and parts.
 *
 * `pending` is the in-memory Stepper reduction of the in-flight step, served
 * by `/v2/state`. It is bounded by construction: only the single in-flight
 * assistant message per session is reduced, and it is dropped the moment v1
 * marks it completed, removed, or its session is deleted.
 */
export namespace SessionProjector {
  const log = Log.create({ service: "session.v2.projector" })

  export const Event = {
    /**
     * A session's entry set changed. Coarse, kept for consumers that only
     * want to know something moved.
     */
    Updated: BusEvent.schema(
      "session.v2.updated",
      Schema.Struct({
        sessionID: Schema.String,
      }),
    ),
    /**
     * One entry appeared or changed.
     *
     * `entry` is `Unknown` on the wire because `SessionEntry` is defined in
     * zod and the Effect contract needs an Effect Schema here — the same
     * choice `SessionV2EntryList` and `SessionV2State` already make in
     * server/httpapi/session.ts. The typed shape is what `GET
     * /session/:id/v2/entries` returns, so clients type the read and cast the
     * delta.
     */
    EntryUpdated: BusEvent.schema(
      "session.entry.updated",
      Schema.Struct({
        sessionID: Schema.String,
        entry: Schema.Unknown,
      }),
    ),
    /** One entry went away (a part was removed, or its message was). */
    EntryRemoved: BusEvent.schema(
      "session.entry.removed",
      Schema.Struct({
        sessionID: Schema.String,
        entryID: Schema.String,
      }),
    ),
  }

  interface Live {
    state: Stepper.MemoryState
    /** messageID of the in-flight assistant message being reduced */
    inflight?: string
    /** partID → last entry-grade signature, to publish the coarse event only
     *  on grade changes */
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
        const event = SessionEvent.create(draft)
        target.state = Stepper.stepWith(target.state, memoryAdapter, sessionID, event)
        return event
      }

      const drop = (target: Live) => {
        target.state = empty()
        target.inflight = undefined
        target.seen.clear()
      }

      s.unsubscribes.push(
        Bus.subscribe(MessageV2.Event.Updated, (event) => {
          const info = event.properties.info

          if (info.role === "user") {
            // A user entry aggregates its message's parts, which this module
            // does not hold. The transactional projection has already written
            // it by the time the bus fires, so republish what it wrote.
            publishStored(info.sessionID, SessionEntry.refForMessage(info.id, "user"))
            return
          }

          const target = live(info.sessionID)

          if (info.time.completed !== undefined || info.error) {
            if (target.inflight !== info.id) return
            // Persist rewrites `start` on every message update (in-flight cost,
            // then the seal). Publish it here too so a live client matches
            // `/v2/entries`.
            publishEntry(info.sessionID, startEntry(info))
            publishEntry(info.sessionID, completeEntry(info))
            drop(target)
            publish(info.sessionID)
            return
          }

          if (target.inflight === info.id) {
            // finish-step updates cost/tokens/finish on the message before
            // `time.completed`; republish start so live matches the persisted row.
            publishEntry(info.sessionID, startEntry(info))
            return
          }
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
          publishEntry(info.sessionID, startEntry(info))
          publish(info.sessionID)
        }),

        Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
          const part = event.properties.part
          const target = s.sessions.get(part.sessionID)

          if (part.type === "retry") {
            if (!target || target.inflight !== part.messageID) return
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
          }

          // Entries are published for every part of every message, in flight
          // or not: the live stream is the v2 read model, so a consumer that
          // only listens to it must not miss anything.
          //
          // Text, file and agent parts of a user message fold into that
          // message's single `user` entry. Everything else — including
          // compaction / snapshot / patch on a user message — is its own
          // entry, exactly as the persisted projection does.
          if (isUserMessage(part.sessionID, part.messageID) && SessionEntry.foldsIntoUser(part)) {
            publishStored(part.sessionID, SessionEntry.refForMessage(part.messageID, "user"))
          } else {
            const entry = SessionEntry.fromV1Part(part, {
              sessionID: part.sessionID,
              messageID: part.messageID,
            })
            if (entry) publishEntry(part.sessionID, entry)
          }

          if (!target || target.inflight !== part.messageID) return
          if (part.type !== "retry") {
            step(target, part.sessionID, { type: "part.updated", sessionID: part.sessionID, part })
          }

          const grade = part.type === "tool" ? part.state.status : "·"
          const before = target.seen.get(part.id)
          target.seen.set(part.id, grade)
          if (before === undefined || before !== grade) publish(part.sessionID)
        }),

        Bus.subscribe(MessageV2.Event.PartRemoved, (event) => {
          const { sessionID, messageID, partID } = event.properties
          if (isUserMessage(sessionID, messageID)) {
            publishStored(sessionID, SessionEntry.refForMessage(messageID, "user"))
          }
          void Bus.publish(Event.EntryRemoved, { sessionID, entryID: SessionEntry.idForPart(messageID, partID) })
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

  // ============================================================================
  // Entry construction — the same derivations the persisted projection uses
  // ============================================================================

  function startEntry(info: MessageV2.Assistant): SessionEntry.Entry {
    return SessionEntry.fromV1Assistant(info).find((entry) => entry.type === "start")!
  }

  function completeEntry(info: MessageV2.Assistant): SessionEntry.Entry {
    const complete = SessionEntry.fromV1Assistant(info).find((entry) => entry.type === "complete")
    if (!complete) throw new Error("assistant message has no complete entry")
    return complete
  }

  /**
   * Whether a part belongs to a user message. The bus fires after the write
   * commits, so the row is there to be read.
   */
  function isUserMessage(sessionID: string, messageID: string): boolean {
    try {
      return MessageRepo.getMessage(sessionID, messageID)?.role === "user"
    } catch (error) {
      log.warn("failed to resolve message role", { sessionID, messageID, error })
      return false
    }
  }

  function publishEntry(sessionID: string, entry: SessionEntry.Entry) {
    void Bus.publish(Event.EntryUpdated, { sessionID, entry })
  }

  /** Republish an entry the persisted projection already wrote. */
  function publishStored(sessionID: string, ref: string) {
    try {
      const entry = SessionEntryRepo.byRef(sessionID, ref)
      if (entry) publishEntry(sessionID, entry)
    } catch (error) {
      log.warn("failed to read stored entry for publication", { sessionID, ref, error })
    }
  }

  // ============================================================================
  // Public surface
  // ============================================================================

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
