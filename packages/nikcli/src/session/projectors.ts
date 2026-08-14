import z from "zod"
import { SyncEvent } from "@/sync/sync-event"
import { MessageV2 } from "./message-v2"
import { MessageRepo } from "./message-repo"
import { SessionEntry } from "./v2/entry"
import { SessionRepo } from "./repo"
import { SessionEntryProjection } from "./v2/projection"
import { Session } from "./index"
import { SessionPending } from "./pending"
import { InstructionRepo } from "./instruction-repo"

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
 *
 * Slice 2 of the v2 write path writes `session_entry` first, then persists
 * v1 as `toV1*` of those entries. A throw rolls back both — see
 * specs/v2/session-v2-write-path.md.
 */
export namespace SessionSync {
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
      promptData: z.string().optional(),
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

  export const InstructionsUpdated = SyncEvent.define({
    type: "session.instructions.updated",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: z.string(),
      delta: z.record(z.string(), z.union([z.string().regex(/^[0-9a-f]{64}$/), z.literal("removed")])),
    }),
    bus: () => Session.Event.InstructionsUpdated,
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
      SessionEntryProjection.sessionRemoved(tx, data.sessionID)
      SessionPending.removeSession(data.sessionID, tx)
      InstructionRepo.removeSession(data.sessionID, tx)
      SessionRepo.remove(data.sessionID, tx)
    }),

    // Entries first. v1 is derived from the entries just written;
    // prompt_data stays on message_info as the S1 remainder.
    SyncEvent.project(MessageUpdated, (tx, data) => {
      const written = SessionEntryProjection.message(tx, data.info)
      const derived = SessionEntry.toV1Message(written)
      if (!derived) throw new Error("session entry projection produced no v1 message")
      MessageRepo.upsertMessage(derived, tx)
      if (data.promptData !== undefined) {
        MessageRepo.setPromptData(data.info.id, data.promptData, tx)
      }
    }),

    SyncEvent.project(MessageRemoved, (tx, data) => {
      SessionEntryProjection.messageRemoved(tx, data.messageID)
      MessageRepo.removeMessage(data.sessionID, data.messageID, tx)
    }),

    SyncEvent.project(PartUpdated, (tx, data) => {
      const written = SessionEntryProjection.part(tx, data.part)
      if (!written) throw new Error("session entry projection produced no v1 part")
      const derived = SessionEntry.toV1WrittenPart(written, data.part)
      if (!derived) throw new Error("session entry projection produced no v1 part")
      MessageRepo.upsertPart(derived, tx)
    }),

    SyncEvent.project(PartRemoved, (tx, data) => {
      SessionEntryProjection.partRemoved(tx, data.sessionID, data.messageID, data.partID)
      MessageRepo.removePart(data.messageID, data.partID, tx)
    }),

    SyncEvent.project(InstructionsUpdated, (tx, data, event) => {
      InstructionRepo.applyDelta(tx, {
        sessionID: data.sessionID,
        delta: data.delta,
        seq: event.seq,
      })
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
