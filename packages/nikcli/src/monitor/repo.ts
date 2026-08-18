import { and, eq } from "drizzle-orm"
import { Database } from "@/database/database"
import { monitor } from "./monitor.sql"
import type { Monitor } from "./manager"

/**
 * SQL-backed repository for monitor records.
 *
 * Replaces the `["monitor", sessionID, monitorID]` JSON key tree. The
 * in-process `ActiveRuntime` map is still the live source for a running
 * monitor; this is the durable copy `reconcile` and `get` fall back to.
 */
export namespace MonitorRepo {
  function db() {
    return Database.syncDb()
  }

  type Executor = Database.TxOrDb

  function toRow(record: Monitor.Record) {
    return {
      id: record.id,
      sessionId: record.sessionID,
      status: record.status,
      data: JSON.stringify(record),
      createdAt: record.time.created,
      updatedAt: record.time.updated,
    }
  }

  function readRecord(data: string): Monitor.Record | undefined {
    try {
      // SAFETY: `data` is the column written by `toRow`, which only ever stores
      // `JSON.stringify(record)` for a `Monitor.Record`. Unparsable JSON is
      // caught below and reported as a missing record.
      return JSON.parse(data) as Monitor.Record
    } catch {
      return undefined
    }
  }

  export function get(sessionId: string, id: string): Monitor.Record | undefined {
    const row = db()
      .select({ data: monitor.data })
      .from(monitor)
      .where(and(eq(monitor.sessionId, sessionId), eq(monitor.id, id)))
      .get()
    return row ? readRecord(row.data) : undefined
  }

  export function upsert(record: Monitor.Record, executor: Executor = db()): void {
    const row = toRow(record)
    executor
      .insert(monitor)
      .values(row)
      .onConflictDoUpdate({
        target: monitor.id,
        set: {
          sessionId: row.sessionId,
          status: row.status,
          data: row.data,
          updatedAt: row.updatedAt,
        },
      })
      .run()
  }

  /** Every monitor still marked `running`, across every session. */
  export function listRunning(): Monitor.Record[] {
    const rows = db().select({ data: monitor.data }).from(monitor).where(eq(monitor.status, "running")).all()
    return rows.flatMap((row) => {
      const record = readRecord(row.data)
      return record ? [record] : []
    })
  }
}
