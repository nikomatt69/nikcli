import { Database } from "@/database/database"
import { MessageRepo } from "../message-repo"
import { MessageV2 } from "../message-v2"
import { SessionEntry } from "./entry"
import { SessionEntryRepo } from "./entry-repo"

/**
 * v1 message/part → flat v2 entry projection.
 *
 * Runs inside the transaction that writes the v1 row, so the entry table is
 * a true projection rather than a cache that can fall behind. Each function
 * touches only the entries the incoming change can affect: a streamed part
 * is one row, and a message-level change is the two or three rows that frame
 * the step.
 */
export namespace SessionEntryProjection {
  type Executor = Database.TxOrDb

  const messageRef = SessionEntry.refForMessage

  /**
   * Project a message: the `user` entry, or the `start` / `complete` /
   * `compaction` entries that frame an assistant step.
   *
   * The parts in between are projected by `part`, not here — rewriting them
   * on every message update would make a long step quadratic.
   */
  export function message(tx: Executor, info: MessageV2.Info): void {
    if (info.role === "user") {
      user(tx, info)
      return
    }

    SessionEntryRepo.upsert(
      {
        entry: SessionEntry.Request.parse({
          id: SessionEntry.idForMessage(info.id, "start"),
          sessionID: info.sessionID,
          messageID: info.id,
          timestamp: info.time.created,
          type: "start",
          providerID: info.providerID,
          modelID: info.modelID,
          agent: info.agent,
          mode: info.mode,
        }),
        ref: messageRef(info.id, "start"),
      },
      tx,
    )

    const completed = info.time.completed
    if (completed !== undefined || info.error) {
      SessionEntryRepo.upsert(
        {
          entry: SessionEntry.Complete.parse({
            id: SessionEntry.idForMessage(info.id, "complete"),
            sessionID: info.sessionID,
            messageID: info.id,
            timestamp: completed ?? info.time.created,
            type: "complete",
            reason: info.error ? "error" : "completed",
            cost: info.cost,
            tokens: info.tokens,
            finish: info.finish,
            error: info.error,
          }),
          ref: messageRef(info.id, "complete"),
        },
        tx,
      )
    }

    if (info.summary) {
      SessionEntryRepo.upsert(
        {
          entry: SessionEntry.Compaction.parse({
            id: SessionEntry.idForMessage(info.id, "compaction"),
            sessionID: info.sessionID,
            messageID: info.id,
            timestamp: completed ?? info.time.created,
            type: "compaction",
            auto: true,
          }),
          ref: messageRef(info.id, "compaction"),
        },
        tx,
      )
    }
  }

  /**
   * A user message is one entry aggregating its text, files and agents, so
   * it is rebuilt from the message's parts rather than projected per part.
   * User messages are small and written once, so the reread is cheap.
   */
  function user(tx: Executor, info: MessageV2.Info): void {
    const parts = MessageRepo.listParts(info.id)
    const text = parts
      .filter((part) => part.type === "text")
      .map((part) => (part as MessageV2.TextPart).text)
      .join("\n")

    SessionEntryRepo.upsert(
      {
        entry: SessionEntry.User.parse({
          id: SessionEntry.idForMessage(info.id, "user"),
          sessionID: info.sessionID,
          messageID: info.id,
          timestamp: info.time.created,
          type: "user",
          text,
          files: parts.filter((part) => part.type === "file"),
          agents: parts.filter((part) => part.type === "agent"),
        }),
        ref: messageRef(info.id, "user"),
      },
      tx,
    )
  }

  /**
   * Project a part. Parts of a user message fold back into that message's
   * single `user` entry; everything else is one entry of its own, upserted
   * on the part id so a stream of deltas stays one row.
   */
  export function part(tx: Executor, input: MessageV2.Part): void {
    const info = MessageRepo.getMessage(input.sessionID, input.messageID)
    if (info?.role === "user") {
      user(tx, info)
      return
    }

    const entry = SessionEntry.fromV1Part(input, {
      sessionID: input.sessionID,
      messageID: input.messageID,
    })
    if (!entry) return

    SessionEntryRepo.upsert(
      {
        entry,
        ref: input.id,
      },
      tx,
    )
  }

  export function partRemoved(tx: Executor, sessionID: string, messageID: string, partID: string): void {
    const info = MessageRepo.getMessage(sessionID, messageID)
    if (info?.role === "user") {
      user(tx, info)
      return
    }
    SessionEntryRepo.removeRef(sessionID, partID, tx)
  }

  export function messageRemoved(tx: Executor, messageID: string): void {
    SessionEntryRepo.removeMessage(messageID, tx)
  }

  export function sessionRemoved(tx: Executor, sessionID: string): void {
    SessionEntryRepo.clear(sessionID, tx)
  }

  /**
   * Rebuild every entry for a session from its v1 messages.
   *
   * Sessions that predate the entry table have no rows, and `entries()` has
   * to keep working for them — so the first read backfills. Also the repair
   * path if a projection is ever found to have drifted.
   */
  export function backfill(tx: Executor, sessionID: string, messages: MessageV2.WithParts[]): void {
    SessionEntryRepo.clear(sessionID, tx)
    for (const msg of messages) {
      message(tx, msg.info)
      if (msg.info.role === "user") continue
      for (const item of msg.parts) part(tx, item)
    }
  }

  /**
   * `backfill` in its own transaction, for the bulk importers.
   *
   * A teleport landing, `nikcli import` and a shared-session import all write
   * message rows straight through `MessageRepo`, so no projector ever sees
   * them. `entries()` would notice and rebuild on first read, but that leaves
   * a window where the session exists with no entries — long enough for a
   * client that opened it from an event to draw nothing. Projecting at the
   * end of the import closes it.
   *
   * Must run *after* the rows are written: the projection reads them back
   * (a part folds into its message's entry).
   */
  export function rebuild(sessionID: string, messages: MessageV2.WithParts[]): void {
    Database.transaction((tx) => backfill(tx, sessionID, messages))
  }
}
