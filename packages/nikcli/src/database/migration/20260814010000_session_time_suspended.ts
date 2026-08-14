import { Database as BunDatabase } from "bun:sqlite"
import type { DatabaseMigration } from "../migration"

/**
 * `session_info.time_suspended` — graceful-restart continuation.
 *
 * A non-null value means exactly: a server suspended this session during
 * graceful shutdown, at this time, and the next server may make **one**
 * attempt to resume it.
 *
 * It is a private column. It is not projected into `Session.Info` (which is
 * serialized whole into `data`), never appears in an HTTP response, and is not
 * a status clients can render — session status stays derived from the live
 * process. See `specs/v2/session-restart-continuation.md`.
 *
 * The index is partial: the column is null for essentially every row, and a
 * full index would be almost entirely dead weight on a hot table.
 */
export default {
  id: "20260814010000_session_time_suspended",
  up(database: BunDatabase) {
    const columns = database.query<{ name: string }, []>("PRAGMA table_info(session_info)").all()
    if (!columns.some((column) => column.name === "time_suspended")) {
      database.exec("ALTER TABLE session_info ADD COLUMN time_suspended INTEGER")
    }
    database.exec(`
      CREATE INDEX IF NOT EXISTS session_info_time_suspended_idx
        ON session_info(time_suspended)
        WHERE time_suspended IS NOT NULL;
    `)
  },
} satisfies DatabaseMigration.Migration
