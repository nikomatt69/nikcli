import { and, asc, eq } from "drizzle-orm"
import { Database } from "@/database/database"
import { backgroundRun } from "./run.sql"
import type { BackgroundRun } from "./run"

/**
 * SQL-backed repository for background/delegation runs.
 *
 * Replaces the `["background_run", projectID, id]` JSON key tree. Sanitization
 * happens on the way out: a corrupt row is dropped rather than surfaced.
 */
export namespace BackgroundRunRepo {
  function db() {
    return Database.syncDb()
  }

  function toRow(projectId: string, record: BackgroundRun.Record) {
    return {
      id: record.id,
      projectId,
      status: record.status,
      parentSessionId: record.parentSessionID,
      data: JSON.stringify(record),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }

  function readRecord(data: string): BackgroundRun.Record | undefined {
    try {
      const parsed = JSON.parse(data) as BackgroundRun.Record
      if (!parsed || typeof parsed.id !== "string") return undefined
      if (typeof parsed.parentSessionID !== "string" || typeof parsed.status !== "string") return undefined
      if (typeof parsed.createdAt !== "number" || typeof parsed.updatedAt !== "number") return undefined
      return parsed
    } catch {
      return undefined
    }
  }

  export function get(projectId: string, id: string): BackgroundRun.Record | undefined {
    const row = db()
      .select({ data: backgroundRun.data })
      .from(backgroundRun)
      .where(and(eq(backgroundRun.projectId, projectId), eq(backgroundRun.id, id)))
      .get()
    return row ? readRecord(row.data) : undefined
  }

  export function upsert(projectId: string, record: BackgroundRun.Record): void {
    const row = toRow(projectId, record)
    db()
      .insert(backgroundRun)
      .values(row)
      .onConflictDoUpdate({
        target: [backgroundRun.projectId, backgroundRun.id],
        set: {
          status: row.status,
          parentSessionId: row.parentSessionId,
          data: row.data,
          updatedAt: row.updatedAt,
        },
      })
      .run()
  }

  /** Mutate-in-place, matching `Storage.update`. Returns undefined when missing. */
  export function update(
    projectId: string,
    id: string,
    fn: (draft: BackgroundRun.Record) => void,
  ): BackgroundRun.Record | undefined {
    const current = get(projectId, id)
    if (!current) return undefined
    const draft = structuredClone(current)
    fn(draft)
    upsert(projectId, draft)
    return draft
  }

  /** Oldest first, matching the previous JSON-list sort. */
  export function list(projectId: string): BackgroundRun.Record[] {
    const rows = db()
      .select({ data: backgroundRun.data })
      .from(backgroundRun)
      .where(eq(backgroundRun.projectId, projectId))
      .orderBy(asc(backgroundRun.createdAt))
      .all()
    return rows.flatMap((row) => {
      const record = readRecord(row.data)
      return record ? [record] : []
    })
  }

  export function listRunning(projectId: string): BackgroundRun.Record[] {
    const rows = db()
      .select({ data: backgroundRun.data })
      .from(backgroundRun)
      .where(and(eq(backgroundRun.projectId, projectId), eq(backgroundRun.status, "running")))
      .orderBy(asc(backgroundRun.createdAt))
      .all()
    return rows.flatMap((row) => {
      const record = readRecord(row.data)
      return record ? [record] : []
    })
  }

  export function listForParent(projectId: string, parentSessionId: string): BackgroundRun.Record[] {
    const rows = db()
      .select({ data: backgroundRun.data })
      .from(backgroundRun)
      .where(and(eq(backgroundRun.projectId, projectId), eq(backgroundRun.parentSessionId, parentSessionId)))
      .orderBy(asc(backgroundRun.createdAt))
      .all()
    return rows.flatMap((row) => {
      const record = readRecord(row.data)
      return record ? [record] : []
    })
  }
}
