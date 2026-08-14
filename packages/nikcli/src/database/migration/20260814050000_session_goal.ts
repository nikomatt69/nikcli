import { Database as BunDatabase } from "bun:sqlite"
import fs from "fs"
import path from "path"
import { Log } from "@/util/log"
import type { DatabaseMigration } from "../migration"

const log = Log.create({ service: "database-migration.session-goal" })

/**
 * Session goals move from JSON storage to SQL.
 *
 * Legacy layout (relative to the directory holding the main database file):
 *
 * - `storage/goal/<sessionID>.json` — SessionGoal.State
 *
 * JSON files are left in place as the downgrade fallback. Inserts are
 * `OR IGNORE`, so re-running against a database whose journal was reset
 * cannot double-import.
 */

function readJson(file: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (error) {
    log.warn("skipping unreadable goal record", { file, error: String(error) })
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
  id: "20260814050000_session_goal",
  up(database: BunDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS session_goal (
        session_id  TEXT    NOT NULL PRIMARY KEY,
        data        TEXT    NOT NULL,
        updated_at  INTEGER NOT NULL
      );
    `)

    const filename = database.filename
    if (!filename || filename === ":memory:") return
    const root = path.join(path.dirname(filename), "storage", "goal")
    if (!fs.existsSync(root)) return

    const insert = database.query(
      `INSERT OR IGNORE INTO session_goal (session_id, data, updated_at) VALUES (?, ?, ?)`,
    )
    let imported = 0
    for (const file of listJsonFiles(root)) {
      const state = readJson(path.join(root, file))
      const sessionID = typeof state?.sessionID === "string" ? state.sessionID : path.basename(file, ".json")
      if (!sessionID || typeof state?.goalID !== "string" || typeof state?.objective !== "string") continue
      insert.run(sessionID, JSON.stringify(state), typeof state.timeUpdated === "number" ? state.timeUpdated : 0)
      imported++
    }
    if (imported > 0) {
      log.info("imported session goals", { imported })
    }
  },
} satisfies DatabaseMigration.Migration
