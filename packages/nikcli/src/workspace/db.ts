import { eq } from "drizzle-orm"
import { Database } from "@/database/database"

import { Log } from "@/util/log"
import { workspace } from "./workspace.sql"
import type { Config } from "./config"
import { storageList, storageRead } from "@/storage/effect"

/** Drizzle's .run() returns void in types but actually returns {changes, lastInsertRowid} at runtime */
type RunResult = { changes: number; lastInsertRowid: number | bigint }
function getChanges(result: void | RunResult): number {
  return (result as RunResult).changes
}

export namespace WorkspaceDB {
  const log = Log.create({ service: "workspace-db" })
  const migrationByDatabase = new Map<string, Promise<number>>()

  export type Row = {
    id: string
    project_id: string
    name: string
    branch: string | null
    config: Config
    status?: string
    time_used: number
    created_at: number
    updated_at: number
  }

  export type Info = {
    id: string
    projectID: string
    name: string
    timeUsed: number
    branch: string | null
    config: Config
  }

  /**
   * Get the shared Drizzle database instance from the central Database.Service.
   */
  function db() {
    return Database.syncDb()
  }

  // ============================================================================
  // Internal helpers
  // ============================================================================

  /** Convert a Drizzle row to the legacy Info type */
  function toInfo(row: typeof workspace.$inferSelect): Info {
    return {
      id: row.id,
      projectID: row.projectId,
      name: row.name ?? "",
      timeUsed: row.timeUsed,
      branch: row.branch,
      config: JSON.parse(row.config) as Config,
    }
  }

  // ============================================================================
  // CRUD operations
  // ============================================================================

  export function get(id: string): Info | undefined {
    const row = db().select().from(workspace).where(eq(workspace.id, id)).get()
    return row ? toInfo(row) : undefined
  }

  export function list(projectID?: string): Info[] {
    const query = db().select().from(workspace).orderBy(workspace.id)
    const rows = projectID ? query.where(eq(workspace.projectId, projectID)).all() : query.all()
    return rows.map(toInfo)
  }

  export function getStatus(id: string): string | undefined {
    const row = db().select({ status: workspace.status }).from(workspace).where(eq(workspace.id, id)).get()
    return row?.status ?? undefined
  }

  /**
   * Update the connection status column only. Phase 0 split this from
   * the old `updateState` because state.events and state.eventLimit are
   * gone — events live in `sync_event`, the limit in `sync_snapshot`.
   */
  export function setStatusColumn(id: string, status: string): void {
    db().update(workspace).set({ status, updatedAt: Date.now() }).where(eq(workspace.id, id)).run()
  }

  /**
   * Insert or update a workspace using UPSERT.
   * Replaces the old read-then-write pattern with a single atomic operation.
   */
  export function upsert(info: Info): Info {
    const now = Date.now()
    db()
      .insert(workspace)
      .values({
        id: info.id,
        projectId: info.projectID,
        name: info.name ?? "",
        branch: info.branch,
        config: JSON.stringify(info.config),
        timeUsed: info.timeUsed ?? now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: workspace.id,
        set: {
          projectId: info.projectID,
          name: info.name ?? "",
          branch: info.branch,
          config: JSON.stringify(info.config),
          timeUsed: info.timeUsed ?? now,
          updatedAt: now,
        },
      })
      .run()
    return info
  }

  export function touch(id: string, timeUsed = Date.now()): boolean {
    const result = db().update(workspace).set({ timeUsed }).where(eq(workspace.id, id)).run()
    return getChanges(result) > 0
  }

  export function remove(id: string): boolean {
    const result = db().delete(workspace).where(eq(workspace.id, id)).run()
    return getChanges(result) > 0
  }

  /**
   * Migrate any pre-existing JSON workspace records (storage key ["workspace", ...])
   * into SQLite. Idempotent: existing rows are preserved (INSERT OR IGNORE).
   * Safe to call on every bootstrap; no-op once all JSON rows have landed in the table.
   */
  export async function migrateFromStorage(): Promise<number> {
    const migrationKey = Database.path()
    const existingMigration = migrationByDatabase.get(migrationKey)
    if (existingMigration) return existingMigration

    const migration = (async () => {
      let imported = 0
      try {
        const keys = await storageList(["workspace"])
        for (const key of keys) {
          const row = await storageRead<Info>(key).catch(() => undefined)
          if (!row || !row.id || !row.projectID || !row.config) continue
          // Check if already migrated using Drizzle
          const existing = db().select({ id: workspace.id }).from(workspace).where(eq(workspace.id, row.id)).get()
          if (existing) continue
          const now = Date.now()
          db()
            .insert(workspace)
            .values({
              id: row.id,
              projectId: row.projectID,
              name: row.name ?? "",
              branch: row.branch ?? null,
              config: JSON.stringify(row.config),
              timeUsed: row.timeUsed ?? now,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing()
            .run()
          imported++
        }
        if (imported > 0) {
          log.info("migrated workspaces from JSON to SQLite", { imported })
        }
      } catch (err) {
        log.warn("workspace migration skipped", { error: err })
        migrationByDatabase.delete(migrationKey)
      }
      return imported
    })()

    migrationByDatabase.set(migrationKey, migration)
    return migration
  }
}
