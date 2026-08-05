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

  /** Rank within a message: `start` before the parts, `complete` after them. */
  export const Rank = {
    head: 0,
    part: 1,
    complete: 2,
    trailer: 3,
  } as const

  /** The stable identity of a message-level entry. */
  export function messageRef(messageID: string, kind: "user" | "start" | "complete" | "compaction") {
    return `${messageID}#${kind}`
  }

  function sortKeyFor(messageID: string, rank: number, suffix = "") {
    return `${messageID}#${rank}${suffix ? `#${suffix}` : ""}`
  }

  export interface UpsertInput {
    entry: SessionEntry.Entry
    ref: string
    rank: number
    /** Discriminates rows that share a rank — the part id, for parts. */
    suffix?: string
  }

  export function upsert(input: UpsertInput, tx: Executor = db()): void {
    const { entry, ref, rank, suffix } = input
    const messageID = entry.messageID ?? ""

    // Preserve the id the entry was first seen with: consumers key renders on
    // it, and a churning id would remount every row on every delta.
    const existing = tx
      .select({ id: sessionEntry.id })
      .from(sessionEntry)
      .where(and(eq(sessionEntry.sessionId, entry.sessionID), eq(sessionEntry.ref, ref)))
      .get()

    const stable = existing ? { ...entry, id: existing.id } : entry
    const info = JSON.stringify(stable)

    tx.insert(sessionEntry)
      .values({
        id: stable.id,
        sessionId: stable.sessionID,
        messageId: messageID,
        type: stable.type,
        ref,
        info,
        sortKey: sortKeyFor(messageID, rank, suffix),
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
      .orderBy(asc(sessionEntry.sortKey))
      .all()
    return rows.map((row) => JSON.parse(row.info) as SessionEntry.Entry)
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
