import { eq, asc } from "drizzle-orm"
import { Database } from "@/database/database"
import { sessionV2Event } from "./event.sql"
import { SessionEvent } from "./event"
import { Stepper } from "./stepper"

/**
 * SQL-backed log of SessionEvents — the durable form of the v2 event
 * stream. Lifecycle events append under their event id; `part.updated`
 * events coalesce under the originating v1 part id (live streams re-emit
 * the same part once per delta, so an append-only log would be one row per
 * token). `sortKey` keeps the first-seen position of a coalesced row, so
 * replaying in sortKey order through `Stepper.stepWith` reproduces the
 * final reduction exactly: the upsert-by-`ref` semantics of the reducer
 * make (latest content, first position) equivalent to the full stream.
 */
export namespace SessionV2EventRepo {
  function db() {
    return Database.syncDb()
  }

  /** Row identity: part.updated rows coalesce per part, the rest per event. */
  function rowID(event: SessionEvent.Event): string {
    if (event.type === "part.updated") return event.part.id
    return event.id
  }

  function messageID(event: SessionEvent.Event): string {
    if (event.type === "part.updated") return event.part.messageID
    return event.messageID
  }

  export function append(event: SessionEvent.Event): void {
    db()
      .insert(sessionV2Event)
      .values({
        id: rowID(event),
        sessionId: event.sessionID,
        messageId: messageID(event),
        type: event.type,
        info: JSON.stringify(event),
        sortKey: event.id,
        timestamp: event.timestamp,
      })
      .onConflictDoUpdate({
        target: sessionV2Event.id,
        set: {
          info: JSON.stringify(event),
          timestamp: event.timestamp,
        },
      })
      .run()
  }

  export function list(sessionID: string): SessionEvent.Event[] {
    const rows = db()
      .select()
      .from(sessionV2Event)
      .where(eq(sessionV2Event.sessionId, sessionID))
      .orderBy(asc(sessionV2Event.sortKey))
      .all()
    return rows.map((row) => SessionEvent.Event.parse(JSON.parse(row.info)))
  }

  /** Rebuild the Stepper reduction of a session from its persisted events. */
  export function replay(sessionID: string): Stepper.MemoryState {
    const adapter = Stepper.memory().adapter
    let state: Stepper.MemoryState = { entries: [], pending: [] }
    for (const event of list(sessionID)) {
      state = Stepper.stepWith(state, adapter, sessionID, event)
    }
    return state
  }

  export function removePart(partID: string): void {
    db().delete(sessionV2Event).where(eq(sessionV2Event.id, partID)).run()
  }

  /** A removed in-flight message un-happened: drop its rows. */
  export function removeMessage(messageID: string): void {
    db().delete(sessionV2Event).where(eq(sessionV2Event.messageId, messageID)).run()
  }

  export function clear(sessionID: string): void {
    db().delete(sessionV2Event).where(eq(sessionV2Event.sessionId, sessionID)).run()
  }
}
