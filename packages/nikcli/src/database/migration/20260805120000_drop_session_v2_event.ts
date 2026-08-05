import { Database as BunDatabase } from "bun:sqlite"
import type { DatabaseMigration } from "../migration"

/**
 * `session_v2_event` held a v2 event stream translated off the bus, written
 * in parallel with the v1 rows it derived from. Entries are now persisted
 * transactionally (`session_entry`) and the durable event log is `sync_event`,
 * so the table was a second answer to a question that already had one.
 */
export default {
  id: "20260805120000_drop_session_v2_event",
  up(database: BunDatabase) {
    database.exec(`
      DROP INDEX IF EXISTS idx_session_v2_event_session;
      DROP INDEX IF EXISTS idx_session_v2_event_message;
      DROP INDEX IF EXISTS idx_session_v2_event_sort;
      DROP TABLE IF EXISTS session_v2_event;
    `)
  },
} satisfies DatabaseMigration.Migration
