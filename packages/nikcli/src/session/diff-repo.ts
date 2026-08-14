import { eq } from "drizzle-orm"
import { Database } from "@/database/database"
import { sessionDiff } from "./diff.sql"
import type { Snapshot } from "@/snapshot"

/**
 * SQL-backed repository for the session-level file diff list.
 *
 * Replaces the `["session_diff", sessionID]` JSON key. A missing or corrupt
 * row is an empty list, matching `SessionSummary.diff` on a cache miss.
 */
export namespace SessionDiffRepo {
  function db() {
    return Database.syncDb()
  }

  function readDiffs(data: string): Snapshot.FileDiff[] {
    try {
      const parsed = JSON.parse(data)
      return Array.isArray(parsed) ? (parsed as Snapshot.FileDiff[]) : []
    } catch {
      return []
    }
  }

  export function get(sessionId: string): Snapshot.FileDiff[] {
    const row = db()
      .select({ data: sessionDiff.data })
      .from(sessionDiff)
      .where(eq(sessionDiff.sessionId, sessionId))
      .get()
    return row ? readDiffs(row.data) : []
  }

  export function upsert(sessionId: string, diffs: Snapshot.FileDiff[]): void {
    const now = Date.now()
    db()
      .insert(sessionDiff)
      .values({
        sessionId,
        data: JSON.stringify(diffs),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: sessionDiff.sessionId,
        set: {
          data: JSON.stringify(diffs),
          updatedAt: now,
        },
      })
      .run()
  }

  export function remove(sessionId: string): boolean {
    const result = db().delete(sessionDiff).where(eq(sessionDiff.sessionId, sessionId)).run()
    return (result as any).changes > 0
  }
}
