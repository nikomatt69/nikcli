import { Database as BunDatabase } from "bun:sqlite"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260805000000_session_entry",
  up(database: BunDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS session_entry (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        type TEXT NOT NULL,
        ref TEXT NOT NULL,
        info TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_session_entry_ref ON session_entry(session_id, ref);
      CREATE INDEX IF NOT EXISTS idx_session_entry_session ON session_entry(session_id, id);
      CREATE INDEX IF NOT EXISTS idx_session_entry_message ON session_entry(message_id);
    `)
  },
} satisfies DatabaseMigration.Migration
