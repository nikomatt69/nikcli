import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Database } from "@/database/database";
import { mission, missionExec } from "./mission.sql";
import {
  sanitizeDefinition,
  sanitizeExec,
  type MissionDefinition,
  type MissionExec,
} from "./schema";

/**
 * SQL-backed repository for missions.
 *
 * Replaces the `["mission", projectID, missionID]` /
 * `["mission_exec", projectID, missionID, execID]` JSON key tree. Sanitization
 * stays where it was — corrupt or partial records are dropped rather than
 * surfaced — but it now happens in one place, on the way out.
 */
export namespace MissionRepo {
  function db() {
    return Database.syncDb();
  }

  type Executor = Database.TxOrDb;

  function toDefinitionRow(projectId: string, def: MissionDefinition) {
    return {
      id: def.id,
      projectId,
      name: def.name,
      status: def.status,
      data: JSON.stringify(def),
      createdAt: def.createdAt,
    };
  }

  function toExecRow(projectId: string, exec: MissionExec) {
    return {
      id: exec.id,
      missionId: exec.missionID,
      projectId,
      status: exec.status,
      startedAt: exec.startedAt,
      endedAt: exec.endedAt ?? null,
      data: JSON.stringify(exec),
    };
  }

  function readDefinition(data: string): MissionDefinition | undefined {
    try {
      return sanitizeDefinition(JSON.parse(data));
    } catch {
      return undefined;
    }
  }

  function readExec(data: string): MissionExec | undefined {
    try {
      return sanitizeExec(JSON.parse(data));
    } catch {
      return undefined;
    }
  }

  function defined<T>(values: (T | undefined)[]): T[] {
    return values.filter((value): value is T => value !== undefined);
  }

  // ── Definitions ───────────────────────────────────────────────────────────

  /** Newest first, matching the previous in-memory sort. */
  export function list(projectId: string): MissionDefinition[] {
    const rows = db()
      .select({ data: mission.data })
      .from(mission)
      .where(eq(mission.projectId, projectId))
      .orderBy(desc(mission.createdAt))
      .all();
    return defined(rows.map((row) => readDefinition(row.data)));
  }

  export function get(
    projectId: string,
    id: string,
  ): MissionDefinition | undefined {
    const row = db()
      .select({ data: mission.data })
      .from(mission)
      .where(and(eq(mission.projectId, projectId), eq(mission.id, id)))
      .get();
    return row ? readDefinition(row.data) : undefined;
  }

  export function upsert(
    projectId: string,
    def: MissionDefinition,
    executor: Executor = db(),
  ): void {
    const row = toDefinitionRow(projectId, def);
    executor
      .insert(mission)
      .values(row)
      .onConflictDoUpdate({
        target: mission.id,
        set: {
          projectId: row.projectId,
          name: row.name,
          status: row.status,
          data: row.data,
          createdAt: row.createdAt,
        },
      })
      .run();
  }

  /** Delete a definition and every exec it owns. */
  export function remove(projectId: string, id: string): void {
    Database.transaction((tx) => {
      tx.delete(missionExec)
        .where(
          and(
            eq(missionExec.projectId, projectId),
            eq(missionExec.missionId, id),
          ),
        )
        .run();
      tx.delete(mission)
        .where(and(eq(mission.projectId, projectId), eq(mission.id, id)))
        .run();
    });
  }

  // ── Execs ─────────────────────────────────────────────────────────────────

  export function putExec(projectId: string, exec: MissionExec): void {
    const row = toExecRow(projectId, exec);
    db()
      .insert(missionExec)
      .values(row)
      .onConflictDoUpdate({
        target: missionExec.id,
        set: {
          missionId: row.missionId,
          projectId: row.projectId,
          status: row.status,
          startedAt: row.startedAt,
          endedAt: row.endedAt,
          data: row.data,
        },
      })
      .run();
  }

  /**
   * Read-modify-write one exec inside a transaction. Returns the stored exec
   * after the mutation, or undefined when the exec does not exist.
   */
  export function updateExec(
    projectId: string,
    missionId: string,
    execId: string,
    mutate: (draft: MissionExec) => void,
  ): MissionExec | undefined {
    return Database.transaction((tx) => {
      const row = tx
        .select({ data: missionExec.data })
        .from(missionExec)
        .where(
          and(
            eq(missionExec.projectId, projectId),
            eq(missionExec.missionId, missionId),
            eq(missionExec.id, execId),
          ),
        )
        .get();
      if (!row) return undefined;
      const current = readExec(row.data);
      if (!current) return undefined;
      const draft = structuredClone(current);
      mutate(draft);
      const updated = toExecRow(projectId, draft);
      tx.update(missionExec)
        .set({
          status: updated.status,
          startedAt: updated.startedAt,
          endedAt: updated.endedAt,
          data: updated.data,
        })
        .where(eq(missionExec.id, execId))
        .run();
      return draft;
    });
  }

  /** Newest first. */
  export function listExecs(
    projectId: string,
    missionId: string,
    limit?: number,
  ): MissionExec[] {
    const query = db()
      .select({ data: missionExec.data })
      .from(missionExec)
      .where(
        and(
          eq(missionExec.projectId, projectId),
          eq(missionExec.missionId, missionId),
        ),
      )
      .orderBy(desc(missionExec.startedAt));
    const rows = limit === undefined ? query.all() : query.limit(limit).all();
    return defined(rows.map((row) => readExec(row.data)));
  }

  export function listExecsByStatus(
    projectId: string,
    status: MissionExec["status"],
  ): MissionExec[] {
    const rows = db()
      .select({ data: missionExec.data })
      .from(missionExec)
      .where(
        and(
          eq(missionExec.projectId, projectId),
          eq(missionExec.status, status),
        ),
      )
      .orderBy(desc(missionExec.startedAt))
      .all();
    return defined(rows.map((row) => readExec(row.data)));
  }

  /**
   * Keep the newest `limit` execs of a mission and delete the rest.
   */
  export function trimExecs(
    projectId: string,
    missionId: string,
    limit: number,
  ): void {
    Database.transaction((tx) => {
      const ids = tx
        .select({ id: missionExec.id })
        .from(missionExec)
        .where(
          and(
            eq(missionExec.projectId, projectId),
            eq(missionExec.missionId, missionId),
          ),
        )
        .orderBy(desc(missionExec.startedAt), asc(missionExec.id))
        .all();
      const victims = ids.slice(limit).map((row) => row.id);
      if (victims.length === 0) return;
      tx.delete(missionExec).where(inArray(missionExec.id, victims)).run();
    });
  }

  export function countExecRecords(
    projectId: string,
    missionId: string,
  ): number {
    const row = db()
      .select({ count: sql<number>`count(*)` })
      .from(missionExec)
      .where(
        and(
          eq(missionExec.projectId, projectId),
          eq(missionExec.missionId, missionId),
        ),
      )
      .get();
    return row?.count ?? 0;
  }
}
