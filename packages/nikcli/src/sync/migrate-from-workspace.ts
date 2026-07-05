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
import { Database } from "@/database/database"
import { Sync } from "@/sync"
import { eq } from "drizzle-orm"
import * as schema from "@/database/schema"
import { WorkspaceProjection } from "@/workspace/projection"

const MIGRATION_FLAG_AGGREGATE = "__sync_unify_workspace_migrated__"

export namespace SyncUnifyMigration {
  /**
   * Run the workspace → sync_event backfill. Returns the number of
   * workspaces seeded with a `workspace.created` event.
   */
  export async function run(projectID?: string): Promise<number> {
    // Check the sentinel aggregate — if we have already run once and
    // emitted at least one event under it, treat the migration as done.
    const migrationScope = projectID ?? "all"
    const sentinelAggregate = `${MIGRATION_FLAG_AGGREGATE}:${migrationScope}`
    const sentinel = await Sync.readAggregate(sentinelAggregate)
    if (sentinel.length > 0) return 0

    const db = Database.syncDb()
    const rows = projectID
      ? db.select().from(schema.workspace).where(eq(schema.workspace.projectId, projectID)).all()
      : db.select().from(schema.workspace).all()

    let seeded = 0
    for (const row of rows) {
      // Avoid duplicate seeding: if any event for this workspace id
      // already exists, the projector is already aware of it.
      const existing = await Sync.readAggregate(row.id)
      if (existing.length > 0) continue

      await WorkspaceProjection.emitLifecycle(row.projectId, row.id, "workspace.created", {
        config: safeJson(row.config),
        branch: row.branch,
        name: row.name,
      })
      seeded++
    }

    // Mark the migration as done so we never re-run.
    await Sync.emitRaw("global", sentinelAggregate, {
      type: "sync_unify.workspace_migrated",
      projectID: projectID ?? null,
      seeded,
      at: Date.now(),
    })

    return seeded
  }

  function safeJson(value: string): unknown {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }
}
