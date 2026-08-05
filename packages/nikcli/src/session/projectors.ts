import z from "zod"
import { SyncEvent } from "@/sync/sync-event"
import { MessageV2 } from "./message-v2"
import { MessageRepo } from "./message-repo"
import { SessionRepo } from "./repo"
import { SessionEntryProjection } from "./v2/projection"
import { Log } from "@/util/log"
import { Session } from "./index"

/**
 * Session sync events and their projectors.
 *
 * This is the inversion described in sync/sync-event.ts: instead of writing
 * a row and then announcing it, domain code runs an event and the projector
 * below performs the write inside the same transaction that logs it.
 *
 * Every event is layered over the session's **existing** bus definition
 * (`bus:`), so `Bus.subscribe(Session.Event.Updated, …)` and every SSE
 * consumer keep working with no change: the bus payload is identical, only
 * the order of operations behind it changed.
 *
 * `message.part.updated` is defined with `log: false`. It fires once per
 * streamed token, so logging it would be one durable row per delta — the
 * per-token disk write problem. Its projection is an upsert that already
 * carries the latest state, so it is projected and published but not logged.
 */
export namespace SessionSync {
  const log = Log.create({ service: "session.sync" })

  /**
   * Run the v2 entry projection without letting it take the v1 write with
   * it. The projection is derived data; the message and part rows are the
   * contract. A schema the projection cannot make sense of is a bug worth
   * shouting about, not a reason to roll back the conversation.
   */
  function project(what: string, fn: () => void) {
    try {
      fn()
    } catch (error) {
      log.error("v2 entry projection failed", { what, error })
    }
  }

  const SessionInfo = z.custom<Session.Info>()
  const MessageInfo = z.custom<MessageV2.Info>()
  const MessagePart = z.custom<MessageV2.Part>()

  export const Created = SyncEvent.define({
    type: "session.created",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: z.string(),
      info: SessionInfo,
    }),
    bus: () => Session.Event.Created,
  })

  export const Updated = SyncEvent.define({
    type: "session.updated",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: z.string(),
      info: SessionInfo,
    }),
    bus: () => Session.Event.Updated,
  })

  export const Deleted = SyncEvent.define({
    type: "session.deleted",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: z.string(),
      info: SessionInfo,
    }),
    bus: () => Session.Event.Deleted,
  })

  export const MessageUpdated = SyncEvent.define({
    type: "message.updated",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: z.string(),
      info: MessageInfo,
    }),
    bus: () => MessageV2.Event.Updated,
  })

  export const MessageRemoved = SyncEvent.define({
    type: "message.removed",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: z.string(),
      messageID: z.string(),
    }),
    bus: () => MessageV2.Event.Removed,
  })

  export const PartUpdated = SyncEvent.define({
    type: "message.part.updated",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: z.string(),
      part: MessagePart,
      delta: z.string().optional(),
    }),
    bus: () => MessageV2.Event.PartUpdated,
    log: false,
  })

  export const PartRemoved = SyncEvent.define({
    type: "message.part.removed",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: z.string(),
      messageID: z.string(),
      partID: z.string(),
    }),
    bus: () => MessageV2.Event.PartRemoved,
  })

  /**
   * The bus payloads predate the sync events and do not all carry
   * `sessionID` at the top level (it is the aggregate key, which the log
   * needs and the bus never did). This strips it back out so subscribers
   * see exactly the payload they saw before.
   */
  export function convertEvent(type: string, data: unknown): Record<string, unknown> {
    const payload = data as Record<string, unknown>
    switch (type) {
      case "session.created":
      case "session.updated":
      case "session.deleted":
      case "message.updated":
        return { info: payload.info }
      case "message.part.updated":
        return payload.delta === undefined ? { part: payload.part } : { part: payload.part, delta: payload.delta }
      default:
        return payload
    }
  }

  export const projectors = [
    SyncEvent.project(Created, (tx, data) => {
      SessionRepo.upsert(data.info, tx)
    }),

    SyncEvent.project(Updated, (tx, data) => {
      SessionRepo.upsert(data.info, tx)
    }),

    SyncEvent.project(Deleted, (tx, data) => {
      SessionRepo.remove(data.sessionID, tx)
      project("session.removed", () => SessionEntryProjection.sessionRemoved(tx, data.sessionID))
    }),

    // The v2 entry projection runs in the same transaction as the v1 write,
    // and always after it: `SessionEntryProjection` reads the row it is
    // deriving from (a part folds into its message's entry, and a user
    // message aggregates its parts).
    SyncEvent.project(MessageUpdated, (tx, data) => {
      MessageRepo.upsertMessage(data.info, tx)
      project("message", () => SessionEntryProjection.message(tx, data.info))
    }),

    SyncEvent.project(MessageRemoved, (tx, data) => {
      MessageRepo.removeMessage(data.sessionID, data.messageID, tx)
      project("message.removed", () => SessionEntryProjection.messageRemoved(tx, data.messageID))
    }),

    SyncEvent.project(PartUpdated, (tx, data) => {
      MessageRepo.upsertPart(data.part, tx)
      project("part", () => SessionEntryProjection.part(tx, data.part))
    }),

    SyncEvent.project(PartRemoved, (tx, data) => {
      MessageRepo.removePart(data.messageID, data.partID, tx)
      project("part.removed", () => SessionEntryProjection.partRemoved(tx, data.sessionID, data.messageID, data.partID))
    }),
  ]

  /**
   * Install the projectors if nothing has yet.
   *
   * Bootstrap normally does this, but a session write must never be the
   * thing that discovers the system was not wired up — CLI subcommands,
   * tests and embedded SDK callers all reach the domain without going
   * through a full bootstrap. Idempotent and a boolean check on the hot
   * path.
   */
  export function install() {
    if (SyncEvent.installed(Created)) return
    SyncEvent.init({ projectors, convertEvent })
  }
}
