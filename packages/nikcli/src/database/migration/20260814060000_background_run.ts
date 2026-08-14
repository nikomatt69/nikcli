import { Database as BunDatabase } from "bun:sqlite"
import fs from "fs"
import path from "path"
import { Log } from "@nikcli-ai/util/log"
import type { DatabaseMigration } from "../migration"

const log = Log.create({ service: "database-migration.background-run" })

/**
 * Background/delegation runs move from JSON storage to SQL.
 *
 * Legacy layout (relative to the directory holding the main database file):
 *
 * - `storage/background_run/<projectID>/<id>.json` — BackgroundRun.Record
 *
 * JSON files are left in place as the downgrade fallback. Inserts are
 * `OR IGNORE`, so re-running against a database whose journal was reset
 * cannot double-import.
 */

function readJson(file: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (error) {
    log.warn("skipping unreadable background run", { file, error: String(error) })
    return undefined
  }
}

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
}

export default {
  id: "20260814060000_background_run",
  up(database: BunDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS background_run (
        id                 TEXT    NOT NULL,
        project_id         TEXT    NOT NULL,
        status             TEXT    NOT NULL,
        parent_session_id  TEXT    NOT NULL,
        data               TEXT    NOT NULL,
        created_at         INTEGER NOT NULL,
        updated_at         INTEGER NOT NULL,
        PRIMARY KEY (project_id, id)
      );

      CREATE INDEX IF NOT EXISTS idx_background_run_project
        ON background_run(project_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_background_run_status
        ON background_run(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_background_run_parent
        ON background_run(parent_session_id, created_at);
    `)

    const filename = database.filename
    if (!filename || filename === ":memory:") return
    const root = path.join(path.dirname(filename), "storage", "background_run")
    if (!fs.existsSync(root)) return

    const insert = database.query(
      `INSERT OR IGNORE INTO background_run
       (id, project_id, status, parent_session_id, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    let imported = 0
    for (const projectID of listDirs(root)) {
      for (const file of listJsonFiles(path.join(root, projectID))) {
        const record = readJson(path.join(root, projectID, file))
        const id = typeof record?.id === "string" ? record.id : path.basename(file, ".json")
        if (!id || typeof record?.parentSessionID !== "string" || typeof record?.status !== "string") continue
        insert.run(
          id,
          projectID,
          record.status,
          record.parentSessionID,
          JSON.stringify(record),
          typeof record.createdAt === "number" ? record.createdAt : 0,
          typeof record.updatedAt === "number" ? record.updatedAt : 0,
        )
        imported++
      }
    }
    if (imported > 0) {
      log.info("imported background runs", { imported })
    }
  },
} satisfies DatabaseMigration.Migration
