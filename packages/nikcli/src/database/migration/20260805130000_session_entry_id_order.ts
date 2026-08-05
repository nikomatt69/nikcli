import { Database as BunDatabase } from "bun:sqlite"
import type { DatabaseMigration } from "../migration"

/**
 * `session_entry` dropped its `sort_key` column: entry ids are now derived so
 * that lexicographic id order *is* conversation order
 * (`SessionEntry.idForPart`), which removes the need for the server and its
 * clients to agree on a separate ordering convention.
 *
 * The table is a projection, so it is rebuilt rather than migrated — the next
 * read backfills it from the v1 messages
 * (`SessionEntryProjection.backfill`). Dropping it is the cheap, honest move;
 * an ALTER dance would be preserving data that is derived by definition.
 */
export default {
  id: "20260805130000_session_entry_id_order",
  up(database: BunDatabase) {
    database.exec(`
      DROP TABLE IF EXISTS session_entry;

      CREATE TABLE session_entry (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        type TEXT NOT NULL,
        ref TEXT NOT NULL,
        info TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX idx_session_entry_ref ON session_entry(session_id, ref);
      CREATE INDEX idx_session_entry_session ON session_entry(session_id, id);
      CREATE INDEX idx_session_entry_message ON session_entry(message_id);
    `)
  },
} satisfies DatabaseMigration.Migration
