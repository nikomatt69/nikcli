import { Database } from "@/database/database"
import { MessageRepo } from "../message-repo"
import { MessageV2 } from "../message-v2"
import { SessionEntry } from "./entry"
import { SessionEntryRepo } from "./entry-repo"

/**
 * Event payload → flat v2 entry write.
 *
 * Runs inside the same transaction as the v1 row, and is a function of the
 * payload plus already-committed rows — not of the row this event is about
 * to write. That lets the projector persist `session_entry` first. See
 * specs/v2/session-v2-write-path.md.
 *
 * Each function touches only the entries the incoming change can affect: a
 * streamed part is one row, and a message-level change is the two or three
 * rows that frame the step.
 *
 * Callers persist v1 by converting the returned entries through
 * `SessionEntry.toV1Message` / `toV1WrittenPart`.
 */
export namespace SessionEntryProjection {
  type Executor = Database.TxOrDb

  const messageRef = SessionEntry.refForMessage

  /**
   * Parts that belong on a user entry, with this event's part applied in
   * memory so the write does not depend on `message_part` already holding it.
   */
  function partsForUser(messageID: string, incoming?: MessageV2.Part, without?: string): MessageV2.Part[] {
    let parts = MessageRepo.listParts(messageID)
    if (without) parts = parts.filter((part) => part.id !== without)
    if (!incoming) return parts
    const index = parts.findIndex((part) => part.id === incoming.id)
    if (index < 0) return [...parts, incoming]
    const next = parts.slice()
    next[index] = incoming
    return next
  }

  function upsertMessage(tx: Executor, entry: SessionEntry.Entry, kind: SessionEntry.MessageKind) {
    const messageID = entry.messageID
    if (!messageID) return
    SessionEntryRepo.upsert(
      {
        entry,
        ref: messageRef(messageID, kind),
      },
      tx,
    )
  }

  /**
   * Project a message: the `user` entry, or the `start` / `complete` /
   * `compaction` entries that frame an assistant step.
   *
   * The parts in between are projected by `part`, not here — rewriting them
   * on every message update would make a long step quadratic.
   */
  export function message(tx: Executor, info: MessageV2.Info): SessionEntry.Entry[] {
    if (info.role === "user") {
      return [user(tx, info)]
    }

    const framing = SessionEntry.fromV1Assistant(info)
    for (const entry of framing) {
      upsertMessage(tx, entry, entry.type)
    }
    return framing
  }

  /**
   * A user message is one entry aggregating its text, files and agents, so
   * it is rebuilt from the message's parts rather than projected per part.
   * User messages are small and written once, so the reread is cheap.
   *
   * Only the parts the user actually typed count toward display `text`: the
   * engine appends its own text parts to the user message (the plan-mode
   * `<system-reminder>`, the build-mode switch), and folding those into
   * `text` printed the whole reminder back at the user underneath their
   * prompt. Those parts still live on `texts` so v1 derivation keeps them.
   */
  function user(tx: Executor, info: MessageV2.Info, incoming?: MessageV2.Part, without?: string): SessionEntry.User {
    if (info.role !== "user") {
      throw new Error("SessionEntryProjection.user requires a user message")
    }
    const entry = SessionEntry.fromV1User(info, partsForUser(info.id, incoming, without))
    upsertMessage(tx, entry, "user")
    return entry
  }

  /**
   * Project a part. Text, file and agent parts of a user message fold back
   * into that message's single `user` entry; everything else is one entry
   * of its own, upserted on the part id so a stream of deltas stays one row.
   */
  export function part(tx: Executor, input: MessageV2.Part): SessionEntry.Entry | undefined {
    const info = MessageRepo.getMessage(input.sessionID, input.messageID)
    if (info?.role === "user" && SessionEntry.foldsIntoUser(input)) {
      return user(tx, info, input)
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
    return entry
  }

  export function partRemoved(tx: Executor, sessionID: string, messageID: string, partID: string): void {
    const info = MessageRepo.getMessage(sessionID, messageID)
    if (info?.role === "user") {
      user(tx, info, undefined, partID)
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
      for (const item of msg.parts) {
        if (msg.info.role === "user" && SessionEntry.foldsIntoUser(item)) continue
        part(tx, item)
      }
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
   * Must run *after* the v1 rows are written: a user entry still folds
   * already-committed parts.
   */
  export function rebuild(sessionID: string, messages: MessageV2.WithParts[]): void {
    Database.transaction((tx) => backfill(tx, sessionID, messages))
  }
}
