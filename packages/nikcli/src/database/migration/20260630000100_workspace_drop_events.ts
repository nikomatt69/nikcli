import { Database as BunDatabase } from "bun:sqlite"
import type { DatabaseMigration } from "../migration"

/**
 * Phase 0b — drop the now-orphaned `events` JSON column and `event_limit`
 * integer column from the `workspace` table. The single source of truth
 * for workspace events is `sync_event` (see @/sync/sync.sql).
 *
 * The previous migration (sync_unify) added the new columns to
 * `sync_event`, `mobile_tokens`, and the two new tables. This one cleans
 * up the now-dead workspace columns.
 *
 * Safe to run after `src/sync/migrate-from-workspace.ts` has backfilled
 * the event log for any pre-existing workspaces.
 */
export default {
  id: "20260630000100_workspace_drop_events",
  up(database: BunDatabase) {
    database.exec(`
      ALTER TABLE workspace DROP COLUMN events;
      ALTER TABLE workspace DROP COLUMN event_limit;
    `)
  },
} satisfies DatabaseMigration.Migration
