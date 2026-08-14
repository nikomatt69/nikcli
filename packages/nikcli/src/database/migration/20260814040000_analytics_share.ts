import { Database as BunDatabase } from "bun:sqlite"
import fs from "fs"
import path from "path"
import { Log } from "@nikcli-ai/util/log"
import type { DatabaseMigration } from "../migration"

const log = Log.create({ service: "database-migration.analytics-share" })

/**
 * The anonymous-reporting install UUID moves off `["analytics","share-state"]`.
 *
 * `analytics_publish` already tracks which days were sent. The JSON file only
 * still held the local install id — a random v4 UUID that must survive a
 * process restart so the collector replaces a day instead of double-counting
 * it. One row, always `id = 'local'`.
 *
 * JSON is left in place as the downgrade fallback. The insert is `OR IGNORE`,
 * so a re-run against a reset journal cannot clobber a runtime write.
 */

function readJson(file: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (error) {
    log.warn("skipping unreadable analytics share-state", { file, error: String(error) })
    return undefined
  }
}

export default {
  id: "20260814040000_analytics_share",
  up(database: BunDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS analytics_share (
        id          TEXT    NOT NULL PRIMARY KEY,
        install_id  TEXT    NOT NULL,
        created_at  INTEGER NOT NULL
      );
    `)

    const filename = database.filename
    if (!filename || filename === ":memory:") return
    const file = path.join(path.dirname(filename), "storage", "analytics", "share-state.json")
    if (!fs.existsSync(file)) return

    const state = readJson(file)
    const installID = typeof state?.installID === "string" ? state.installID : undefined
    if (!installID) return

    database
      .query(`INSERT OR IGNORE INTO analytics_share (id, install_id, created_at) VALUES ('local', ?, ?)`)
      .run(installID, Date.now())
  },
} satisfies DatabaseMigration.Migration
