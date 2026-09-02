import type { Database as BunDatabase } from "bun:sqlite"
import { Filesystem } from "@nikcli-ai/util/filesystem"
import type { DatabaseMigration } from "../migration"

/**
 * Two derived columns so `GET /session` can filter, order, and limit in SQL
 * instead of materializing every session of the project and doing it in JS
 * (P2.1).
 *
 * Both columns exist because the JS predicates they replace are *not*
 * expressible in SQLite without changing their meaning:
 *
 * - `directory_key` is `Filesystem.comparisonKey(directory)`. On Windows that
 *   resolves the path, forward-slashes it, and lowercases it with JS
 *   semantics. `WHERE directory = ?` would be a different predicate, and
 *   `WHERE lower(directory) = ?` would be an ASCII-only approximation of it.
 * - `title_lower` is `title.toLowerCase()`. SQLite's `lower()` is ASCII-only,
 *   so it would drop non-ASCII search matches the JS filter accepts.
 *
 * Both are computed here by the same functions the write path uses, so the
 * backfill and the runtime agree by construction. They are derived state:
 * `Session.Info` still carries only `directory` and `title`, and neither
 * column is ever read back into it or put on the wire.
 *
 * The backfill resolves relative directories against the migrating process's
 * cwd — exactly what the read-time `comparisonKey` call it replaces did.
 * Session directories are absolute in practice, where the call is a pure
 * normalization.
 */
export default {
  id: "20260824000000_session_directory_key",
  up(database: BunDatabase) {
    database.exec(`
      ALTER TABLE session_info ADD COLUMN directory_key TEXT;
      ALTER TABLE session_info ADD COLUMN title_lower TEXT;
    `)

    const rows = database
      .query<{ id: string; directory: string; title: string }, []>("SELECT id, directory, title FROM session_info")
      .all()
    const update = database.prepare("UPDATE session_info SET directory_key = ?, title_lower = ? WHERE id = ?")
    for (const row of rows) {
      update.run(Filesystem.comparisonKey(row.directory), row.title.toLowerCase(), row.id)
    }

    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_session_info_project_updated ON session_info (project_id, updated_at DESC, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_session_info_directory_key ON session_info (directory_key);
    `)
  },
} satisfies DatabaseMigration.Migration
