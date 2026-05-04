import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { eq } from "drizzle-orm"
import path from "path"
import { Global } from "@/global"
import { Storage } from "@/storage/storage"
import { Log } from "@/util/log"
import { workspace } from "./workspace.sql"
import type { Config } from "./config"

/** Drizzle's .run() returns void in types but actually returns {changes, lastInsertRowid} at runtime */
type RunResult = { changes: number; lastInsertRowid: number | bigint }
function getChanges(result: void | RunResult): number {
  return (result as RunResult).changes
}

export namespace WorkspaceDB {
  const log = Log.create({ service: "workspace-db" })
  export const DEFAULT_EVENT_LIMIT = 200

  export type Row = {
    id: string
    project_id: string
    branch: string | null
    config: Config
    status?: string
    events?: unknown[]
    eventLimit?: number
    created_at: number
    updated_at: number
  }

  export type Info = {
    id: string
    projectID: string
    branch: string | null
    config: Config
  }

  export type State = {
    status?: string
    events: unknown[]
    eventLimit?: number
  }

  let _rawDb: Database | undefined
  let _db: ReturnType<typeof drizzle> | undefined
  let _migrated = false

  /**
   * Get the raw bun:sqlite connection (for migration only).
   */
  function rawDb(): Database {
    if (!_rawDb) {
      const p = path.join(Global.Path.data, "workspaces.db")
      _rawDb = new Database(p, { create: true })
      _rawDb.exec("PRAGMA journal_mode=WAL;")
      _rawDb.exec("PRAGMA foreign_keys=ON;")
      migrateSchema(_rawDb)
    }
    return _rawDb
  }

  /**
   * Get the Drizzle database instance.
   */
  function db() {
    if (!_db) {
      _db = drizzle(rawDb(), { schema: { workspace } })
    }
    return _db
  }

  /**
   * Run schema migration on the raw SQLite connection.
   * Handles existing databases by adding columns that may not exist yet.
   */
  function migrateSchema(database: Database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS workspace (
        id         TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        branch     TEXT,
        config     TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_project ON workspace(project_id);
    `)

    const columns = database.query("PRAGMA table_info(workspace)").all() as Array<{ name?: string }>
    const names = new Set(columns.map((column) => column.name).filter(Boolean))

    if (!names.has("status")) {
      database.exec("ALTER TABLE workspace ADD COLUMN status TEXT")
    }

    if (!names.has("events")) {
      database.exec("ALTER TABLE workspace ADD COLUMN events TEXT")
    }

    if (!names.has("event_limit")) {
      database.exec("ALTER TABLE workspace ADD COLUMN event_limit INTEGER")
    }
  }

  // ============================================================================
  // Internal helpers
  // ============================================================================

  /** Convert a Drizzle row to the legacy Info type */
  function toInfo(row: typeof workspace.$inferSelect): Info {
    return {
      id: row.id,
      projectID: row.projectId,
      branch: row.branch,
      config: JSON.parse(row.config) as Config,
    }
  }

  /** Convert a Drizzle row to the legacy State type */
  function toState(
    row: Pick<typeof workspace.$inferSelect, "status" | "events" | "eventLimit"> | null | undefined,
  ): State {
    return {
      status: row?.status ?? undefined,
      events: row?.events ? ((JSON.parse(row.events) as unknown[]) ?? []) : [],
      eventLimit: row?.eventLimit ?? undefined,
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

  export function getState(id: string): State {
    const row = db()
      .select({
        status: workspace.status,
        events: workspace.events,
        eventLimit: workspace.eventLimit,
      })
      .from(workspace)
      .where(eq(workspace.id, id))
      .get()
    return toState(row)
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
        branch: info.branch,
        config: JSON.stringify(info.config),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: workspace.id,
        set: {
          projectId: info.projectID,
          branch: info.branch,
          config: JSON.stringify(info.config),
          updatedAt: now,
        },
      })
      .run()
    return info
  }

  export function updateState(id: string, state: Partial<State>): State | undefined {
    const existing = get(id)
    if (!existing) return undefined

    const current = getState(id)
    const next: State = {
      status: state.status ?? current.status,
      events: state.events ?? current.events,
      eventLimit: state.eventLimit ?? current.eventLimit,
    }

    db()
      .update(workspace)
      .set({
        status: next.status ?? null,
        events: JSON.stringify(next.events ?? []),
        eventLimit: next.eventLimit ?? null,
        updatedAt: Date.now(),
      })
      .where(eq(workspace.id, id))
      .run()

    return next
  }

  export function applyEventLimit(events: unknown[], event: unknown, eventLimit?: number): unknown[] {
    const limit = eventLimit ?? DEFAULT_EVENT_LIMIT
    return [...events, event].slice(-limit)
  }

  export function appendEvent(id: string, event: unknown): State | undefined {
    const state = getState(id)
    const events = applyEventLimit(state.events, event, state.eventLimit)
    return updateState(id, { events })
  }

  export function remove(id: string): boolean {
    const result = db().delete(workspace).where(eq(workspace.id, id)).run()
    return getChanges(result) > 0
  }

  /**
   * Migrate any pre-existing JSON workspace records (Storage.write(["workspace", ...]))
   * into SQLite. Idempotent: existing rows are preserved (INSERT OR IGNORE).
   * Safe to call on every bootstrap; no-op once all JSON rows have landed in the table.
   */
  export async function migrateFromStorage(): Promise<number> {
    if (_migrated) return 0
    _migrated = true

    let imported = 0
    try {
      const keys = await Storage.list(["workspace"])
      for (const key of keys) {
        const row = await Storage.read<Info>(key).catch(() => undefined)
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
            branch: row.branch ?? null,
            config: JSON.stringify(row.config),
            eventLimit: row.config.eventLimit ?? null,
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
    }
    return imported
  }
}
