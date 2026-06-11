import { Database as BunDatabase } from "bun:sqlite"
import fs from "fs"
import path from "path"
import { Log } from "@/util/log"
import type { DatabaseMigration } from "../migration"

const log = Log.create({ service: "database-migration.legacy-import" })

/**
 * Data migration: import rows from the legacy per-domain SQLite databases
 * (`accounts.db`, `users.db`, `workspaces.db`, `mobile_auth.db`) into the
 * central `nikcli.db`. Legacy files are looked up next to the main database
 * file so test databases opened in temp directories never see production
 * data. Legacy files are left in place (readable during rollout); rows that
 * already exist in the central database win via INSERT OR IGNORE.
 */

/** Columns shared between a legacy table and its central counterpart. */
function sharedColumns(legacy: BunDatabase, table: string, target: string[]): string[] {
  const exists = legacy
    .query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table)
  if (!exists) return []
  const info = legacy.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all()
  const available = new Set(info.map((column) => column.name))
  return target.filter((column) => available.has(column))
}

function copyTable(database: BunDatabase, legacy: BunDatabase, table: string, targetColumns: string[]): number {
  const columns = sharedColumns(legacy, table, targetColumns)
  if (columns.length === 0) return 0
  const rows = legacy.query<Record<string, unknown>, []>(`SELECT ${columns.join(", ")} FROM ${table}`).all()
  if (rows.length === 0) return 0
  const insert = database.query(
    `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
  )
  let imported = 0
  for (const row of rows) {
    try {
      insert.run(...(columns.map((column) => row[column]) as any[]))
      imported++
    } catch (error) {
      // Foreign key violations are not suppressed by OR IGNORE; skip the row
      // rather than failing the whole migration on inconsistent legacy data.
      log.warn("skipping legacy row", { table, error: String(error) })
    }
  }
  return imported
}

function withLegacy(dataDir: string, filename: string, fn: (legacy: BunDatabase) => void): void {
  const file = path.join(dataDir, filename)
  if (!fs.existsSync(file)) return
  let legacy: BunDatabase
  try {
    legacy = new BunDatabase(file, { readonly: true })
  } catch (error) {
    log.warn("cannot open legacy database", { file, error: String(error) })
    return
  }
  try {
    fn(legacy)
  } finally {
    legacy.close()
  }
}

export default {
  id: "20260611020000_import_legacy_databases",
  up(database: BunDatabase) {
    const filename = database.filename
    if (!filename || filename === ":memory:") return
    const dataDir = path.dirname(filename)

    withLegacy(dataDir, "accounts.db", (legacy) => {
      const imported = copyTable(database, legacy, "account", [
        "id",
        "email",
        "url",
        "access_token",
        "refresh_token",
        "token_expiry",
        "created_at",
        "updated_at",
      ])
      if (imported > 0) log.info("imported legacy accounts", { imported })

      const config = legacy
        .query<
          { active_account_id: string | null; active_org_id: string | null },
          []
        >("SELECT active_account_id, active_org_id FROM config WHERE id = 1")
        .get()
      if (config) {
        database
          .query(
            `UPDATE config
             SET active_account_id = COALESCE(active_account_id, ?),
                 active_org_id = COALESCE(active_org_id, ?)
             WHERE id = 1`,
          )
          .run(config.active_account_id, config.active_org_id)
      }
    })

    withLegacy(dataDir, "users.db", (legacy) => {
      const users = copyTable(database, legacy, "users", [
        "id",
        "username",
        "email",
        "password_hash",
        "display_name",
        "role",
        "created_at",
        "updated_at",
      ])
      const sessions = copyTable(database, legacy, "user_sessions", [
        "id",
        "user_id",
        "token_hash",
        "expires_at",
        "created_at",
      ])
      const contacts = copyTable(database, legacy, "chat_contacts", ["user_id", "contact_id", "created_at"])
      const messages = copyTable(database, legacy, "chat_messages", [
        "id",
        "sender_id",
        "receiver_id",
        "content",
        "read",
        "created_at",
      ])
      if (users + sessions + contacts + messages > 0)
        log.info("imported legacy users", {
          users,
          sessions,
          contacts,
          messages,
        })
    })

    withLegacy(dataDir, "workspaces.db", (legacy) => {
      const imported = copyTable(database, legacy, "workspace", [
        "id",
        "project_id",
        "name",
        "branch",
        "config",
        "status",
        "events",
        "event_limit",
        "time_used",
        "created_at",
        "updated_at",
      ])
      if (imported > 0) log.info("imported legacy workspaces", { imported })
    })

    withLegacy(dataDir, "mobile_auth.db", (legacy) => {
      const imported = copyTable(database, legacy, "mobile_tokens", [
        "id",
        "name",
        "hash",
        "created_at",
        "last_used_at",
        "expires_at",
      ])
      if (imported > 0) log.info("imported legacy mobile tokens", { imported })
    })
  },
} satisfies DatabaseMigration.Migration
