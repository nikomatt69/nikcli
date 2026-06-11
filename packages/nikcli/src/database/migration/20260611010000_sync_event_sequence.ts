import { Database as BunDatabase } from "bun:sqlite";
import type { DatabaseMigration } from "../migration";

export default {
  id: "20260611010000_sync_event_sequence",
  up(database: BunDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS sync_event (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        aggregate TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sync_event_project ON sync_event(project_id);
      CREATE INDEX IF NOT EXISTS idx_sync_event_aggregate ON sync_event(project_id, aggregate);
      CREATE INDEX IF NOT EXISTS idx_sync_event_seq ON sync_event(project_id, aggregate, seq);

      CREATE TABLE IF NOT EXISTS sync_sequence (
        project_id TEXT NOT NULL,
        aggregate TEXT NOT NULL,
        seq INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (project_id, aggregate)
      );
    `);
  },
} satisfies DatabaseMigration.Migration;
