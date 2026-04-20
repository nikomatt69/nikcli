import { Database } from "bun:sqlite"
import path from "path"
import { Global } from "@/global"
import { Storage } from "@/storage/storage"
import { Log } from "@/util/log"
import type { Config } from "./config"

export namespace WorkspaceDB {
  const log = Log.create({ service: "workspace-db" })

  export type Row = {
    id: string
    project_id: string
    branch: string | null
    config: Config
    status?: string
    events?: unknown[]
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
  }

  type DbRow = {
    id: string
    project_id: string
    branch: string | null
    config: string
    status: string | null
    events: string | null
    created_at: number
    updated_at: number
  }

  let _db: Database | undefined
  let _migrated = false

  export function db(): Database {
    if (!_db) {
      const p = path.join(Global.Path.data, "workspaces.db")
      _db = new Database(p, { create: true })
      _db.exec("PRAGMA journal_mode=WAL;")
      _db.exec("PRAGMA foreign_keys=ON;")
      migrateSchema(_db)
    }
    return _db
  }

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
  }

  function rowToInfo(row: DbRow): Info {
    return {
      id: row.id,
      projectID: row.project_id,
      branch: row.branch,
      config: JSON.parse(row.config) as Config,
    }
  }

  function rowToState(row: Pick<DbRow, "status" | "events"> | null | undefined): State {
    return {
      status: row?.status ?? undefined,
      events: row?.events ? ((JSON.parse(row.events) as unknown[]) ?? []) : [],
    }
  }

  export function get(id: string): Info | undefined {
    const row = db().query("SELECT * FROM workspace WHERE id = ?").get(id) as DbRow | null
    return row ? rowToInfo(row) : undefined
  }

  export function list(projectID?: string): Info[] {
    const rows = projectID
      ? (db().query("SELECT * FROM workspace WHERE project_id = ? ORDER BY id ASC").all(projectID) as DbRow[])
      : (db().query("SELECT * FROM workspace ORDER BY id ASC").all() as DbRow[])
    return rows.map(rowToInfo)
  }

  export function getState(id: string): State {
    const row = db().query("SELECT status, events FROM workspace WHERE id = ?").get(id) as Pick<
      DbRow,
      "status" | "events"
    > | null
    return rowToState(row)
  }

  export function upsert(info: Info): Info {
    const now = Date.now()
    const existing = get(info.id)
    if (existing) {
      db().run(
        `UPDATE workspace
           SET project_id = ?, branch = ?, config = ?, updated_at = ?
         WHERE id = ?`,
        [info.projectID, info.branch, JSON.stringify(info.config), now, info.id],
      )
    } else {
      db().run(
        `INSERT INTO workspace (id, project_id, branch, config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [info.id, info.projectID, info.branch, JSON.stringify(info.config), now, now],
      )
    }
    return info
  }

  export function updateState(id: string, state: Partial<State>): State | undefined {
    const existing = get(id)
    if (!existing) return undefined

    const current = getState(id)
    const next: State = {
      status: state.status ?? current.status,
      events: state.events ?? current.events,
    }

    db().run(
      `UPDATE workspace
         SET status = ?, events = ?, updated_at = ?
       WHERE id = ?`,
      [next.status ?? null, JSON.stringify(next.events ?? []), Date.now(), id],
    )

    return next
  }

  export function appendEvent(id: string, event: unknown, limit = 200): State | undefined {
    const current = getState(id)
    const events = [...current.events, event].slice(-limit)
    return updateState(id, { events })
  }

  export function remove(id: string): boolean {
    const result = db().run("DELETE FROM workspace WHERE id = ?", [id])
    return result.changes > 0
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
        const already = db().query("SELECT id FROM workspace WHERE id = ?").get(row.id)
        if (already) continue
        const now = Date.now()
        db().run(
          `INSERT OR IGNORE INTO workspace (id, project_id, branch, config, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [row.id, row.projectID, row.branch ?? null, JSON.stringify(row.config), now, now],
        )
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
