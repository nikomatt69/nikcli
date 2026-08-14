import { and, desc, eq } from "drizzle-orm"
import { Database } from "@/database/database"
import { artifact } from "./artifact.sql"
import type { Artifact } from "./index"

/**
 * SQL-backed repository for published artifacts.
 *
 * Replaces the `["artifact", sessionID, artifactID]` JSON key tree. The
 * secret stays inside `data`; callers that must not leak it strip it on
 * the way out, as they did before.
 */
export namespace ArtifactRepo {
  function db() {
    return Database.syncDb()
  }

  type Executor = Database.TxOrDb

  type StoredRecord = Artifact.Info & { secret: string }

  function readRecord(data: string): StoredRecord | undefined {
    try {
      return JSON.parse(data) as StoredRecord
    } catch {
      return undefined
    }
  }

  export function get(sessionId: string, id: string): StoredRecord | undefined {
    const row = db()
      .select({ data: artifact.data })
      .from(artifact)
      .where(and(eq(artifact.sessionId, sessionId), eq(artifact.id, id)))
      .get()
    return row ? readRecord(row.data) : undefined
  }

  export function upsert(record: StoredRecord, executor: Executor = db()): void {
    executor
      .insert(artifact)
      .values({
        id: record.id,
        sessionId: record.sessionID,
        data: JSON.stringify(record),
        createdAt: record.time.created,
        updatedAt: record.time.updated,
      })
      .onConflictDoUpdate({
        target: [artifact.sessionId, artifact.id],
        set: {
          data: JSON.stringify(record),
          updatedAt: record.time.updated,
        },
      })
      .run()
  }

  /** Newest-updated first. Secrets still present; the manager strips them. */
  export function list(sessionId: string): StoredRecord[] {
    const rows = db()
      .select({ data: artifact.data })
      .from(artifact)
      .where(eq(artifact.sessionId, sessionId))
      .orderBy(desc(artifact.updatedAt))
      .all()
    return rows.flatMap((row) => {
      const record = readRecord(row.data)
      return record ? [record] : []
    })
  }
}
