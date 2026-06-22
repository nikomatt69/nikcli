import { eq } from "drizzle-orm";
import { Database } from "@/database/database";

import { Log } from "@/util/log";
import { workspace } from "./workspace.sql";
import type { Config } from "./config";
import { storageList, storageRead } from "@/storage/effect";

/** Drizzle's .run() returns void in types but actually returns {changes, lastInsertRowid} at runtime */
type RunResult = { changes: number; lastInsertRowid: number | bigint };
function getChanges(result: void | RunResult): number {
  return (result as RunResult).changes;
}

export namespace WorkspaceDB {
  const log = Log.create({ service: "workspace-db" });
  export const DEFAULT_EVENT_LIMIT = 200;
  const migrationByDatabase = new Map<string, Promise<number>>();

  export type Row = {
    id: string;
    project_id: string;
    name: string;
    branch: string | null;
    config: Config;
    status?: string;
    events?: unknown[];
    eventLimit?: number;
    time_used: number;
    created_at: number;
    updated_at: number;
  };

  export type Info = {
    id: string;
    projectID: string;
    name: string;
    timeUsed: number;
    branch: string | null;
    config: Config;
  };

  export type State = {
    status?: string;
    events: unknown[];
    eventLimit?: number;
  };

  type StateRow = Pick<
    typeof workspace.$inferSelect,
    "status" | "events" | "eventLimit"
  >;

  /**
   * Get the shared Drizzle database instance from the central Database.Service.
   */
  function db() {
    return Database.syncDb();
  }

  // ============================================================================
  // Internal helpers
  // ============================================================================

  /** Convert a Drizzle row to the legacy Info type */
  function toInfo(row: typeof workspace.$inferSelect): Info {
    return {
      id: row.id,
      projectID: row.projectId,
      name: row.name ?? "",
      timeUsed: row.timeUsed,
      branch: row.branch,
      config: JSON.parse(row.config) as Config,
    };
  }

  /** Convert a Drizzle row to the legacy State type */
  function toState(
    row:
      | Pick<typeof workspace.$inferSelect, "status" | "events" | "eventLimit">
      | null
      | undefined,
  ): State {
    return {
      status: row?.status ?? undefined,
      events: row?.events ? ((JSON.parse(row.events) as unknown[]) ?? []) : [],
      eventLimit: row?.eventLimit ?? undefined,
    };
  }

  // ============================================================================
  // CRUD operations
  // ============================================================================

  export function get(id: string): Info | undefined {
    const row = db().select().from(workspace).where(eq(workspace.id, id)).get();
    return row ? toInfo(row) : undefined;
  }

  export function list(projectID?: string): Info[] {
    const query = db().select().from(workspace).orderBy(workspace.id);
    const rows = projectID
      ? query.where(eq(workspace.projectId, projectID)).all()
      : query.all();
    return rows.map(toInfo);
  }

  export function getState(id: string): State {
    const row = db()
      .select({
        status: workspace.status,
        events: workspace.events,
        eventLimit: workspace.eventLimit,
      })
      .from(workspace)
      .where(eq(workspace.id, id))
      .get();
    return toState(row);
  }

  export function getStatus(id: string): string | undefined {
    const row = db()
      .select({ status: workspace.status })
      .from(workspace)
      .where(eq(workspace.id, id))
      .get();
    return row?.status ?? undefined;
  }

  /**
   * Insert or update a workspace using UPSERT.
   * Replaces the old read-then-write pattern with a single atomic operation.
   */
  export function upsert(info: Info): Info {
    const now = Date.now();
    db()
      .insert(workspace)
      .values({
        id: info.id,
        projectId: info.projectID,
        name: info.name ?? "",
        branch: info.branch,
        config: JSON.stringify(info.config),
        timeUsed: info.timeUsed ?? now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: workspace.id,
        set: {
          projectId: info.projectID,
          name: info.name ?? "",
          branch: info.branch,
          config: JSON.stringify(info.config),
          timeUsed: info.timeUsed ?? now,
          updatedAt: now,
        },
      })
      .run();
    return info;
  }

  export function updateState(
    id: string,
    state: Partial<State>,
  ): State | undefined {
    const updates: Partial<typeof workspace.$inferInsert> = {
      updatedAt: Date.now(),
    };
    if (state.status !== undefined) updates.status = state.status;
    if (state.events !== undefined)
      updates.events = JSON.stringify(state.events ?? []);
    if (state.eventLimit !== undefined) updates.eventLimit = state.eventLimit;

    const [row] = db()
      .update(workspace)
      .set(updates)
      .where(eq(workspace.id, id))
      .returning({
        status: workspace.status,
        events: workspace.events,
        eventLimit: workspace.eventLimit,
      })
      .all();

    return row ? toState(row) : undefined;
  }

  export function touch(id: string, timeUsed = Date.now()): boolean {
    const result = db()
      .update(workspace)
      .set({ timeUsed })
      .where(eq(workspace.id, id))
      .run();
    return getChanges(result) > 0;
  }

  export function applyEventLimit(
    events: unknown[],
    event: unknown,
    eventLimit?: number,
  ): unknown[] {
    const limit = eventLimit ?? DEFAULT_EVENT_LIMIT;
    return [...events, event].slice(-limit);
  }

  export function appendEvent(id: string, event: unknown): State | undefined {
    const encodedEvent = JSON.stringify(event) ?? "null";
    const row = Database.syncNative()
      .prepare(
        `UPDATE workspace
         SET events = (
           SELECT COALESCE(json_group_array(
             CASE
               WHEN type IN ('object', 'array') THEN json(value)
               WHEN type = 'true' THEN json('true')
               WHEN type = 'false' THEN json('false')
               WHEN type = 'null' THEN json('null')
               ELSE value
             END
           ), '[]')
           FROM (
             SELECT type, value
             FROM (
               SELECT key, type, value
               FROM json_each(json_insert(COALESCE(events, '[]'), '$[#]', json(?)))
               ORDER BY key DESC
               LIMIT COALESCE((SELECT event_limit FROM workspace WHERE id = ?), ?)
             )
             ORDER BY key ASC
           )
         ),
         updated_at = ?
         WHERE id = ?
         RETURNING status, events, event_limit AS eventLimit`,
      )
      .get(encodedEvent, id, DEFAULT_EVENT_LIMIT, Date.now(), id) as
      | StateRow
      | undefined;
    return row ? toState(row) : undefined;
  }

  export function remove(id: string): boolean {
    const result = db().delete(workspace).where(eq(workspace.id, id)).run();
    return getChanges(result) > 0;
  }

  /**
   * Migrate any pre-existing JSON workspace records (storage key ["workspace", ...])
   * into SQLite. Idempotent: existing rows are preserved (INSERT OR IGNORE).
   * Safe to call on every bootstrap; no-op once all JSON rows have landed in the table.
   */
  export async function migrateFromStorage(): Promise<number> {
    const migrationKey = Database.path();
    const existingMigration = migrationByDatabase.get(migrationKey);
    if (existingMigration) return existingMigration;

    const migration = (async () => {
      let imported = 0;
      try {
        const keys = await storageList(["workspace"]);
        for (const key of keys) {
          const row = await storageRead<Info>(key).catch(() => undefined);
          if (!row || !row.id || !row.projectID || !row.config) continue;
          // Check if already migrated using Drizzle
          const existing = db()
            .select({ id: workspace.id })
            .from(workspace)
            .where(eq(workspace.id, row.id))
            .get();
          if (existing) continue;
          const now = Date.now();
          db()
            .insert(workspace)
            .values({
              id: row.id,
              projectId: row.projectID,
              name: row.name ?? "",
              branch: row.branch ?? null,
              config: JSON.stringify(row.config),
              eventLimit: row.config.eventLimit ?? null,
              timeUsed: row.timeUsed ?? now,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing()
            .run();
          imported++;
        }
        if (imported > 0) {
          log.info("migrated workspaces from JSON to SQLite", { imported });
        }
      } catch (err) {
        log.warn("workspace migration skipped", { error: err });
        migrationByDatabase.delete(migrationKey);
      }
      return imported;
    })();

    migrationByDatabase.set(migrationKey, migration);
    return migration;
  }
}
