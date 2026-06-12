import { Database as BunDatabase } from "bun:sqlite"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260612000000_session_v2_event",
  up(database: BunDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS session_v2_event (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        type TEXT NOT NULL,
        info TEXT NOT NULL,
        sort_key TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_v2_event_session ON session_v2_event(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_v2_event_message ON session_v2_event(message_id);
      CREATE INDEX IF NOT EXISTS idx_session_v2_event_sort ON session_v2_event(session_id, sort_key);
    `)
  },
} satisfies DatabaseMigration.Migration
