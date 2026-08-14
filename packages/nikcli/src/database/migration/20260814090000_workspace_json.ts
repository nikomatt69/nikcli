import { Database as BunDatabase } from "bun:sqlite"
import fs from "fs"
import path from "path"
import { Log } from "@/util/log"
import type { DatabaseMigration } from "../migration"

const log = Log.create({ service: "database-migration.workspace-json" })

/**
 * Fold the leftover runtime JSON workspace backfill into the journal.
 *
 * `WorkspaceDB.migrateFromStorage` used to scan `storage/workspace/*.json`
 * on every list/create. Workspaces already live in the `workspace` table
 * (seeded from `workspaces.db` by `20260611020000_import_legacy_databases`).
 * This pass imports any JSON records that never made it in.
 *
 * JSON files stay on disk as the downgrade fallback. Inserts are `OR IGNORE`.
 */

function readJson(file: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (error) {
    log.warn("skipping unreadable workspace record", { file, error: String(error) })
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

export default {
  id: "20260814090000_workspace_json",
  up(database: BunDatabase) {
    const filename = database.filename
    if (!filename || filename === ":memory:") return
    const root = path.join(path.dirname(filename), "storage", "workspace")
    if (!fs.existsSync(root)) return

    const insert = database.query(
      `INSERT OR IGNORE INTO workspace
       (id, project_id, name, branch, config, time_used, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    let imported = 0
    const now = Date.now()
    for (const file of listJsonFiles(root)) {
      const row = readJson(path.join(root, file))
      const id = typeof row?.id === "string" ? row.id : path.basename(file, ".json")
      if (!id || typeof row?.projectID !== "string" || !row.config) continue
      insert.run(
        id,
        row.projectID,
        typeof row.name === "string" ? row.name : "",
        typeof row.branch === "string" ? row.branch : null,
        JSON.stringify(row.config),
        typeof row.timeUsed === "number" ? row.timeUsed : now,
        now,
        now,
      )
      imported++
    }
    if (imported > 0) {
      log.info("imported workspace JSON records", { imported })
    }
  },
} satisfies DatabaseMigration.Migration
