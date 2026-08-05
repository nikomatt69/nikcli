import { and, asc, eq } from "drizzle-orm"
import { Database } from "@/database/database"
import { sessionEntry } from "./entry.sql"
import { SessionEntry } from "./entry"

/**
 * SQL-backed store for flat v2 entries — the persisted v2 read model.
 *
 * Rows are written by the session projectors (session/projectors.ts) in the
 * same transaction as the v1 message/part row they derive from, so `entries()`
 * reads a view that cannot have drifted from storage.
 *
 * Identity is `ref`, not the entry id: a streaming part is re-emitted many
 * times and every emission has to land on the same row. The entry id assigned
 * on first sight is preserved across upserts, because consumers key renders
 * on it.
 */
export namespace SessionEntryRepo {
  type Executor = Database.TxOrDb

  function db() {
    return Database.syncDb()
  }

  export interface UpsertInput {
    entry: SessionEntry.Entry
    /** Stable identity within the session — the upsert key. */
    ref: string
  }

  export function upsert(input: UpsertInput, tx: Executor = db()): void {
    const { entry, ref } = input
    const messageID = entry.messageID ?? ""

    // No read-before-write: entry ids are derived from the v1 id they come
    // from (SessionEntry.idForPart / idForMessage), so re-projecting the same
    // part always produces the same id. That is also what lets the live
    // projection agree with this one without coordinating.
    const stable = entry
    const info = JSON.stringify(stable)

    tx.insert(sessionEntry)
      .values({
        id: stable.id,
        sessionId: stable.sessionID,
        messageId: messageID,
        type: stable.type,
        ref,
        info,
        timestamp: stable.timestamp,
      })
      .onConflictDoUpdate({
        target: sessionEntry.id,
        set: { info, type: stable.type, timestamp: stable.timestamp },
      })
      .run()
  }

  export function list(sessionID: string): SessionEntry.Entry[] {
    const rows = db()
      .select({ info: sessionEntry.info })
      .from(sessionEntry)
      .where(eq(sessionEntry.sessionId, sessionID))
      .orderBy(asc(sessionEntry.id))
      .all()
    return rows.map((row) => JSON.parse(row.info) as SessionEntry.Entry)
  }

  /** One entry by its stable identity within a session. */
  export function byRef(sessionID: string, ref: string): SessionEntry.Entry | undefined {
    const row = db()
      .select({ info: sessionEntry.info })
      .from(sessionEntry)
      .where(and(eq(sessionEntry.sessionId, sessionID), eq(sessionEntry.ref, ref)))
      .get()
    return row ? (JSON.parse(row.info) as SessionEntry.Entry) : undefined
  }

  export function count(sessionID: string): number {
    return db().select({ id: sessionEntry.id }).from(sessionEntry).where(eq(sessionEntry.sessionId, sessionID)).all()
      .length
  }

  export function removeRef(sessionID: string, ref: string, tx: Executor = db()): void {
    tx.delete(sessionEntry)
      .where(and(eq(sessionEntry.sessionId, sessionID), eq(sessionEntry.ref, ref)))
      .run()
  }

  export function removeMessage(messageID: string, tx: Executor = db()): void {
    tx.delete(sessionEntry).where(eq(sessionEntry.messageId, messageID)).run()
  }

  export function clear(sessionID: string, tx: Executor = db()): void {
    tx.delete(sessionEntry).where(eq(sessionEntry.sessionId, sessionID)).run()
  }
}
