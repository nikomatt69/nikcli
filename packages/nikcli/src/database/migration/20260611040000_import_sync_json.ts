import { Database as BunDatabase } from "bun:sqlite"
import fs from "fs"
import path from "path"
import { Log } from "@nikcli-ai/util/log"
import type { DatabaseMigration } from "../migration"

const log = Log.create({ service: "database-migration.sync-import" })

/**
 * Data migration: backfill the per-project sync JSON files into the
 * `sync_event` and `sync_sequence` tables created by
 * 20260611010000_sync_event_sequence.
 *
 * Legacy layout (relative to the directory holding the main database file):
 *
 * - `sync/<projectID>.events.json` — SyncEventRecord[]
 * - `sync/<projectID>.sequence.json` — { [aggregate]: seq }
 *
 * Sequence counters merge via MAX so a backfill can never move a counter
 * backwards; events merge via INSERT OR IGNORE on the event ID.
 */

function readJson(file: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (error) {
    log.warn("skipping unreadable sync file", { file, error: String(error) })
    return undefined
  }
}

export default {
  id: "20260611040000_import_sync_json",
  up(database: BunDatabase) {
    const filename = database.filename
    if (!filename || filename === ":memory:") return
    const syncDir = path.join(path.dirname(filename), "sync")
    if (!fs.existsSync(syncDir)) return

    const insertEvent = database.query(
      `INSERT OR IGNORE INTO sync_event (id, project_id, aggregate, seq, type, data, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    const upsertSequence = database.query(
      `INSERT INTO sync_sequence (project_id, aggregate, seq) VALUES (?, ?, ?)
       ON CONFLICT(project_id, aggregate) DO UPDATE SET seq = MAX(seq, excluded.seq)`,
    )

    let events = 0
    let sequences = 0
    for (const entry of fs.readdirSync(syncDir)) {
      if (entry.endsWith(".events.json")) {
        const projectID = entry.slice(0, -".events.json".length)
        const records = readJson(path.join(syncDir, entry))
        if (!Array.isArray(records)) continue
        for (const record of records) {
          if (!record?.id || !record.aggregate || !record.type) continue
          insertEvent.run(
            record.id,
            projectID,
            record.aggregate,
            record.seq ?? 0,
            record.type,
            JSON.stringify(record.data ?? null),
            record.timestamp ?? 0,
          )
          events++
        }
        continue
      }
      if (entry.endsWith(".sequence.json")) {
        const projectID = entry.slice(0, -".sequence.json".length)
        const sequence = readJson(path.join(syncDir, entry))
        if (!sequence || typeof sequence !== "object") continue
        for (const [aggregate, seq] of Object.entries(sequence)) {
          if (typeof seq !== "number") continue
          upsertSequence.run(projectID, aggregate, seq)
          sequences++
        }
      }
    }

    if (events + sequences > 0) log.info("imported sync JSON records", { events, sequences })
  },
} satisfies DatabaseMigration.Migration
