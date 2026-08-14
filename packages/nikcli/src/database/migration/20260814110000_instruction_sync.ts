import type { Database as BunDatabase } from "bun:sqlite"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260814110000_instruction_sync",
  up(database: BunDatabase) {
    database.exec(`
      CREATE TABLE instruction_blob (
        hash TEXT NOT NULL PRIMARY KEY,
        body TEXT NOT NULL
      );

      CREATE TABLE instruction_state (
        session_id TEXT NOT NULL PRIMARY KEY,
        epoch_seq INTEGER NOT NULL,
        updated_seq INTEGER NOT NULL,
        parent_session_id TEXT,
        parent_seq INTEGER,
        data TEXT NOT NULL
      );
    `)
  },
} satisfies DatabaseMigration.Migration
