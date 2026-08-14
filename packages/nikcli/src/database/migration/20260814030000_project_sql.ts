import { Database as BunDatabase } from "bun:sqlite"
import fs from "fs"
import path from "path"
import { Log } from "@nikcli-ai/util/log"
import type { DatabaseMigration } from "../migration"

const log = Log.create({ service: "database-migration.project" })

/**
 * Project identity moves from JSON storage to SQL.
 *
 * Legacy layout (relative to the directory holding the main database file):
 *
 * - `storage/project/<id>.json`                      — Project.Info
 * - `storage/project_directory/<projectID>.json`     — Directory[]
 *
 * The directory list folds into `project.directories`, which stays nullable
 * so "never written" is still distinguishable from a stored empty list —
 * that distinction drives the bootstrap-from-sandboxes path.
 *
 * JSON files are left in place as the downgrade fallback. Project inserts
 * are `OR IGNORE`. Directory updates only fill a NULL column, so a re-run
 * against a database whose journal was reset cannot clobber a runtime write.
 */

function readJson(file: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (error) {
    log.warn("skipping unreadable project record", { file, error: String(error) })
    return undefined
  }
}

function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
}

function importProjects(database: BunDatabase, storageDir: string) {
  const insert = database.query(
    `INSERT OR IGNORE INTO project
     (id, data, directories, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?)`,
  )
  const fillDirectories = database.query(
    `UPDATE project SET directories = ? WHERE id = ? AND directories IS NULL`,
  )

  let projects = 0
  const projectRoot = path.join(storageDir, "project")
  for (const file of listJsonFiles(projectRoot)) {
    const info = readJson(path.join(projectRoot, file))
    const id = typeof info?.id === "string" ? info.id : path.basename(file, ".json")
    if (!id || typeof info?.worktree !== "string") continue
    insert.run(
      id,
      JSON.stringify(info),
      typeof info.time?.created === "number" ? info.time.created : 0,
      typeof info.time?.updated === "number" ? info.time.updated : 0,
    )
    projects++
  }

  let directories = 0
  const directoryRoot = path.join(storageDir, "project_directory")
  for (const file of listJsonFiles(directoryRoot)) {
    const items = readJson(path.join(directoryRoot, file))
    if (!Array.isArray(items)) continue
    const id = path.basename(file, ".json")
    fillDirectories.run(JSON.stringify(items), id)
    directories++
  }

  return { projects, directories }
}

export default {
  id: "20260814030000_project_sql",
  up(database: BunDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS project (
        id           TEXT    NOT NULL PRIMARY KEY,
        data         TEXT    NOT NULL,
        directories  TEXT,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_project_updated
        ON project(updated_at);
    `)

    const filename = database.filename
    if (!filename || filename === ":memory:") return
    const storageDir = path.join(path.dirname(filename), "storage")
    if (!fs.existsSync(storageDir)) return

    const imported = importProjects(database, storageDir)
    if (imported.projects > 0 || imported.directories > 0) {
      log.info("imported project records", imported)
    }
  },
} satisfies DatabaseMigration.Migration
