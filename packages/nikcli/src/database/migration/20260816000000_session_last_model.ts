import type { Database as BunDatabase } from "bun:sqlite"
import type { DatabaseMigration } from "../migration"

/**
 * Persist the last provider+model used on a session, so worker prompts spawned
 * later (mission/loop/background/task/brain/plan) can inherit it without
 * falling back to the global provider default.
 *
 * Mirrors the existing `data` JSON column: Session.Info already carries the
 * full record, but `lastModel` is queried on every prompt resolution, so a
 * dedicated indexed column avoids parsing the whole blob. Stored as
 * "providerID/modelID" to match the rest of the codebase's `parseModel`/
 * `stringifyModel` convention.
 */
export default {
  id: "20260816000000_session_last_model",
  up(database: BunDatabase) {
    database.exec(`
      ALTER TABLE session_info ADD COLUMN last_model TEXT;
    `)
  },
} satisfies DatabaseMigration.Migration
