import type { Database as BunDatabase } from "bun:sqlite"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260814100000_session_pending",
  up(database: BunDatabase) {
    database.exec(`
      CREATE TABLE session_pending (
        id TEXT NOT NULL PRIMARY KEY,
        session_id TEXT NOT NULL,
        delivery TEXT NOT NULL CHECK (delivery IN ('steer', 'queue')),
        message_id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX session_pending_session_created
        ON session_pending(session_id, created_at, id);

      CREATE UNIQUE INDEX session_pending_session_message
        ON session_pending(session_id, message_id);

      ALTER TABLE message_info ADD COLUMN prompt_data TEXT;
    `)
  },
} satisfies DatabaseMigration.Migration
