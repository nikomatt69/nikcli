import { Database as BunDatabase } from "bun:sqlite";
import type { DatabaseMigration } from "../migration";

/**
 * Phase 0 — unify sessions + workspace behind a single event-sourced backend.
 *
 * - Extends `sync_event` with `workspace_id`, `origin`, `origin_seq` and
 *   matching indexes. The existing event log becomes the lingua franca for
 *   both session and workspace aggregates.
 * - Creates `sync_snapshot` for cold-start projection (avoids replaying
 *   thousands of events on every CLI boot).
 * - Creates `sync_outbox` for offline-first push to a remote hub server.
 * - Adds `scope` to `mobile_tokens` so the same token table can authorize
 *   `cli-sync` clients (Railway sync) in addition to mobile pairing.
 * - Drops `events` and `event_limit` from `workspace` — those columns were a
 *   parallel event log; the data must already have been migrated by the
 *   `migrate-from-workspace` script that runs in a later phase, but the
 *   schema cleanup is safe because `WorkspaceDB.appendEvent` will have been
 *   removed in the same release.
 */
export default {
  id: "20260630000000_sync_unify",
  up(database: BunDatabase) {
    // sync_event: add workspace_id, origin, origin_seq
    database.exec(`
      ALTER TABLE sync_event ADD COLUMN workspace_id TEXT;
      ALTER TABLE sync_event ADD COLUMN origin TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE sync_event ADD COLUMN origin_seq INTEGER;
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_sync_event_workspace ON sync_event(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_sync_event_origin ON sync_event(origin);
      CREATE INDEX IF NOT EXISTS idx_sync_event_project_origin
        ON sync_event(project_id, origin, aggregate, seq);
    `);

    // sync_snapshot: cold-start projection cache
    database.exec(`
      CREATE TABLE IF NOT EXISTS sync_snapshot (
        project_id TEXT NOT NULL,
        aggregate TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        last_seq INTEGER NOT NULL,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, aggregate, aggregate_id)
      );
    `);

    // sync_outbox: pending push to remote hub
    database.exec(`
      CREATE TABLE IF NOT EXISTS sync_outbox (
        id TEXT PRIMARY KEY NOT NULL,
        event_id TEXT NOT NULL,
        target TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sync_outbox_status
        ON sync_outbox(status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_sync_outbox_event
        ON sync_outbox(event_id);
    `);

    // mobile_tokens: scope column
    database.exec(`
      ALTER TABLE mobile_tokens ADD COLUMN scope TEXT NOT NULL DEFAULT 'mobile';
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_mobile_tokens_scope ON mobile_tokens(scope);
    `);

    // workspace: drop parallel event log columns.
    // Backfill: any existing rows that still have JSON events in `events`
    // need to be replayed into sync_event by the post-migration hook in
    // src/sync/migrate-from-workspace.ts before the columns are dropped.
    // Here we keep the columns for one release so the old code path can
    // still read them; the actual DROP COLUMN runs in 0009 after migration.
  },
} satisfies DatabaseMigration.Migration;
