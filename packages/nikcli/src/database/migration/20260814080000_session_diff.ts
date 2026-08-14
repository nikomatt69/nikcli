import { Database as BunDatabase } from "bun:sqlite"
import fs from "fs"
import path from "path"
import { Log } from "@/util/log"
import type { DatabaseMigration } from "../migration"

const log = Log.create({ service: "database-migration.session-diff" })

/**
 * Session-level file diffs move from JSON storage to SQL.
 *
 * Legacy layout (relative to the directory holding the main database file):
 *
 * - `storage/session_diff/<sessionID>.json` — Snapshot.FileDiff[]
 *
 * This list is the durable copy: snapshot git trees are written with
 * `write-tree` and never referenced, so `gc --prune=7.days` drops them.
 * JSON files stay on disk as the downgrade fallback. Inserts are `OR IGNORE`.
 */

function readJson(file: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (error) {
    log.warn("skipping unreadable session diff", { file, error: String(error) })
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
  id: "20260814080000_session_diff",
  up(database: BunDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS session_diff (
        session_id  TEXT    NOT NULL PRIMARY KEY,
        data        TEXT    NOT NULL,
        updated_at  INTEGER NOT NULL
      );
    `)

    const filename = database.filename
    if (!filename || filename === ":memory:") return
    const root = path.join(path.dirname(filename), "storage", "session_diff")
    if (!fs.existsSync(root)) return

    const insert = database.query(`INSERT OR IGNORE INTO session_diff (session_id, data, updated_at) VALUES (?, ?, ?)`)
    let imported = 0
    for (const file of listJsonFiles(root)) {
      const diffs = readJson(path.join(root, file))
      if (!Array.isArray(diffs)) continue
      const sessionID = path.basename(file, ".json")
      if (!sessionID) continue
      insert.run(sessionID, JSON.stringify(diffs), 0)
      imported++
    }
    if (imported > 0) {
      log.info("imported session diffs", { imported })
    }
  },
} satisfies DatabaseMigration.Migration
