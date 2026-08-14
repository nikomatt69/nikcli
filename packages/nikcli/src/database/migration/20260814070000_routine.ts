import { Database as BunDatabase } from "bun:sqlite"
import fs from "fs"
import path from "path"
import { Log } from "@/util/log"
import type { DatabaseMigration } from "../migration"

const log = Log.create({ service: "database-migration.routine" })

/**
 * Routines move from JSON storage to SQL.
 *
 * Legacy layout (relative to the directory holding the main database file):
 *
 * - `storage/routine/<projectID>/<id>.json` — Routine.Record
 *
 * JSON files are left in place as the downgrade fallback. Inserts are
 * `OR IGNORE`, so re-running against a database whose journal was reset
 * cannot double-import.
 */

function readJson(file: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (error) {
    log.warn("skipping unreadable routine", { file, error: String(error) })
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
  id: "20260814070000_routine",
  up(database: BunDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS routine (
        id          TEXT    NOT NULL,
        project_id  TEXT    NOT NULL,
        paused      INTEGER NOT NULL,
        data        TEXT    NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        PRIMARY KEY (project_id, id)
      );

      CREATE INDEX IF NOT EXISTS idx_routine_project
        ON routine(project_id, created_at);
    `)

    const filename = database.filename
    if (!filename || filename === ":memory:") return
    const root = path.join(path.dirname(filename), "storage", "routine")
    if (!fs.existsSync(root)) return

    const insert = database.query(
      `INSERT OR IGNORE INTO routine
       (id, project_id, paused, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    let imported = 0
    for (const projectID of listDirs(root)) {
      for (const file of listJsonFiles(path.join(root, projectID))) {
        const record = readJson(path.join(root, projectID, file))
        const id = typeof record?.id === "string" ? record.id : path.basename(file, ".json")
        if (!id || typeof record?.name !== "string" || typeof record?.prompt !== "string") continue
        insert.run(
          id,
          projectID,
          record.paused ? 1 : 0,
          JSON.stringify(record),
          typeof record.createdAt === "number" ? record.createdAt : 0,
          typeof record.updatedAt === "number" ? record.updatedAt : 0,
        )
        imported++
      }
    }
    if (imported > 0) {
      log.info("imported routines", { imported })
    }
  },
} satisfies DatabaseMigration.Migration
