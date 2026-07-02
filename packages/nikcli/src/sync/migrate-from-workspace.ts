/**
 * One-shot migration: read every existing `workspace` row and seed the
 * unified `sync_event` log with a `workspace.created` event so the
 * projector can reconstruct the workspace's event timeline from cold
 * start. Idempotent: re-running on an already-migrated database is a
 * no-op because we check for the presence of the seed event per
 * workspace id.
 *
 * This script is safe to call at every CLI boot; the cost is one
 * SELECT per workspace and one INSERT per workspace that has not yet
 * been migrated. After the 20260630 workspace drop events migration,
 * the `events` column is gone, so this script gracefully handles the
 * "column does not exist" case.
 */
import { Database } from "@/database/database";
import { Sync } from "@/sync";
import { eq } from "drizzle-orm";
import * as schema from "@/database/schema";

const MIGRATION_FLAG_AGGREGATE = "__sync_unify_workspace_migrated__";

export namespace SyncUnifyMigration {
  /**
   * Run the workspace → sync_event backfill. Returns the number of
   * workspaces seeded with a `workspace.created` event.
   */
  export async function run(projectID?: string): Promise<number> {
    // Check the sentinel aggregate — if we have already run once and
    // emitted at least one event under it, treat the migration as done.
    const sentinel = await Sync.readAggregate(MIGRATION_FLAG_AGGREGATE);
    if (sentinel.length > 0) return 0;

    const db = Database.syncDb();
    const rows = projectID
      ? db
          .select()
          .from(schema.workspace)
          .where(eq(schema.workspace.projectId, projectID))
          .all()
      : db.select().from(schema.workspace).all();

    let seeded = 0;
    for (const row of rows) {
      // Avoid duplicate seeding: if any event for this workspace id
      // already exists, the projector is already aware of it.
      const existing = await Sync.readAggregate(row.id);
      if (existing.length > 0) continue;

      await Sync.emitRaw(
        row.projectId,
        row.id,
        {
          type: "workspace.created",
          config: safeJson(row.config),
          branch: row.branch,
          name: row.name,
        },
        { workspaceID: row.id },
      );
      seeded++;
    }

    // Mark the migration as done so we never re-run.
    await Sync.emitRaw("global", MIGRATION_FLAG_AGGREGATE, {
      type: "sync_unify.workspace_migrated",
      seeded,
      at: Date.now(),
    });

    return seeded;
  }

  function safeJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
}
