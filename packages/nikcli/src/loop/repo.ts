import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { Database } from "@/database/database"
import { loop, loopRun } from "./loop.sql"
import { sanitizeDefinition, sanitizeRun, type LoopDefinition, type LoopRun } from "./schema"

/**
 * SQL-backed repository for loops.
 *
 * Replaces the `["loop", projectID, loopID]` / `["loop_run", …]` /
 * `["loop_meta", …]` JSON key tree. The former layout implemented a
 * three-column table as a directory hierarchy: every list was a directory
 * scan followed by one read per record, and the run counter was a third
 * record kind that existed only because a full-replace write of the
 * definition would otherwise clobber it.
 *
 * Sanitization stays where it was — corrupt or partial records are dropped
 * rather than surfaced — but it now happens in one place, on the way out.
 */
export namespace LoopRepo {
  function db() {
    return Database.syncDb()
  }

  type Executor = Database.TxOrDb

  function toDefinitionRow(projectId: string, def: LoopDefinition) {
    return {
      id: def.id,
      projectId,
      name: def.name,
      enabled: def.enabled ? 1 : 0,
      paused: def.paused ? 1 : 0,
      triggerKind: def.trigger.kind,
      data: JSON.stringify(def),
      createdAt: def.createdAt,
    }
  }

  function toRunRow(projectId: string, run: LoopRun) {
    return {
      id: run.id,
      loopId: run.loopID,
      projectId,
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt ?? null,
      data: JSON.stringify(run),
    }
  }

  function readDefinition(data: string): LoopDefinition | undefined {
    try {
      return sanitizeDefinition(JSON.parse(data))
    } catch {
      return undefined
    }
  }

  function readRun(data: string): LoopRun | undefined {
    try {
      return sanitizeRun(JSON.parse(data))
    } catch {
      return undefined
    }
  }

  function defined<T>(values: (T | undefined)[]): T[] {
    return values.filter((value): value is T => value !== undefined)
  }

  // ── Definitions ───────────────────────────────────────────────────────────

  /** Newest first, matching the previous in-memory sort. */
  export function list(projectId: string): LoopDefinition[] {
    const rows = db()
      .select({ data: loop.data })
      .from(loop)
      .where(eq(loop.projectId, projectId))
      .orderBy(desc(loop.createdAt))
      .all()
    return defined(rows.map((row) => readDefinition(row.data)))
  }

  export function get(projectId: string, id: string): LoopDefinition | undefined {
    const row = db()
      .select({ data: loop.data })
      .from(loop)
      .where(and(eq(loop.projectId, projectId), eq(loop.id, id)))
      .get()
    return row ? readDefinition(row.data) : undefined
  }

  /**
   * Insert or replace a definition, leaving `started_runs` alone.
   *
   * That exclusion is the whole reason the counter used to be its own record:
   * clients round-trip the entire definition on edit, so a full-replace write
   * must not carry the counter with it.
   */
  export function upsert(projectId: string, def: LoopDefinition, executor: Executor = db()): void {
    const row = toDefinitionRow(projectId, def)
    executor
      .insert(loop)
      .values(row)
      .onConflictDoUpdate({
        target: loop.id,
        set: {
          projectId: row.projectId,
          name: row.name,
          enabled: row.enabled,
          paused: row.paused,
          triggerKind: row.triggerKind,
          data: row.data,
          createdAt: row.createdAt,
        },
      })
      .run()
  }

  /** Delete a definition and every run it owns. */
  export function remove(projectId: string, id: string): void {
    Database.transaction((tx) => {
      tx.delete(loopRun)
        .where(and(eq(loopRun.projectId, projectId), eq(loopRun.loopId, id)))
        .run()
      tx.delete(loop)
        .where(and(eq(loop.projectId, projectId), eq(loop.id, id)))
        .run()
    })
  }

  // ── Run counter ───────────────────────────────────────────────────────────

  /** `undefined` means the counter has never been written for this loop. */
  export function startedRuns(projectId: string, loopId: string): number | undefined {
    const row = db()
      .select({ startedRuns: loop.startedRuns })
      .from(loop)
      .where(and(eq(loop.projectId, projectId), eq(loop.id, loopId)))
      .get()
    return row?.startedRuns ?? undefined
  }

  export function setStartedRuns(projectId: string, loopId: string, value: number): void {
    db()
      .update(loop)
      .set({ startedRuns: value })
      .where(and(eq(loop.projectId, projectId), eq(loop.id, loopId)))
      .run()
  }

  /**
   * Increment the counter and return the new value, in one statement so two
   * concurrent runs cannot both read the same value and write the same
   * increment. Returns undefined when the loop row is gone or was never
   * counted — the caller then seeds it from history.
   */
  export function incrementStartedRuns(projectId: string, loopId: string): number | undefined {
    const row = db()
      .update(loop)
      .set({ startedRuns: sql`${loop.startedRuns} + 1` })
      .where(and(eq(loop.projectId, projectId), eq(loop.id, loopId), sql`${loop.startedRuns} IS NOT NULL`))
      .returning({ startedRuns: loop.startedRuns })
      .get()
    return row?.startedRuns ?? undefined
  }

  // ── Runs ──────────────────────────────────────────────────────────────────

  export function putRun(projectId: string, run: LoopRun): void {
    const row = toRunRow(projectId, run)
    db()
      .insert(loopRun)
      .values(row)
      .onConflictDoUpdate({
        target: loopRun.id,
        set: {
          loopId: row.loopId,
          projectId: row.projectId,
          status: row.status,
          startedAt: row.startedAt,
          endedAt: row.endedAt,
          data: row.data,
        },
      })
      .run()
  }

  /**
   * Read-modify-write one run inside a transaction. Returns the stored run
   * after the mutation, or undefined when the run does not exist.
   *
   * The mutation receives a mutable draft, matching the `Storage.update`
   * contract it replaces; returning without changing anything is a valid
   * no-op and still returns the current run.
   */
  export function updateRun(
    projectId: string,
    loopId: string,
    runId: string,
    mutate: (draft: LoopRun) => void,
  ): LoopRun | undefined {
    return Database.transaction((tx) => {
      const row = tx
        .select({ data: loopRun.data })
        .from(loopRun)
        .where(and(eq(loopRun.projectId, projectId), eq(loopRun.loopId, loopId), eq(loopRun.id, runId)))
        .get()
      if (!row) return undefined
      const current = readRun(row.data)
      if (!current) return undefined
      // The draft is written as-is, matching the `Storage.update` contract
      // this replaces: sanitization is a read-side guard, and re-running it
      // here would silently discard a caller's write instead of surfacing it.
      const draft = structuredClone(current)
      mutate(draft)
      const updated = toRunRow(projectId, draft)
      tx.update(loopRun)
        .set({ status: updated.status, startedAt: updated.startedAt, endedAt: updated.endedAt, data: updated.data })
        .where(eq(loopRun.id, runId))
        .run()
      return draft
    })
  }

  /** Newest first. */
  export function listRuns(projectId: string, loopId: string, limit?: number): LoopRun[] {
    const query = db()
      .select({ data: loopRun.data })
      .from(loopRun)
      .where(and(eq(loopRun.projectId, projectId), eq(loopRun.loopId, loopId)))
      .orderBy(desc(loopRun.startedAt))
    const rows = limit === undefined ? query.all() : query.limit(limit).all()
    return defined(rows.map((row) => readRun(row.data)))
  }

  export function countRunRecords(projectId: string, loopId: string): number {
    const row = db()
      .select({ count: sql<number>`count(*)` })
      .from(loopRun)
      .where(and(eq(loopRun.projectId, projectId), eq(loopRun.loopId, loopId)))
      .get()
    return row?.count ?? 0
  }

  /** Newest first, across every loop in the project. */
  export function listRunsByProject(projectId: string, limit: number): LoopRun[] {
    const rows = db()
      .select({ data: loopRun.data })
      .from(loopRun)
      .where(eq(loopRun.projectId, projectId))
      .orderBy(desc(loopRun.startedAt))
      .limit(limit)
      .all()
    return defined(rows.map((row) => readRun(row.data)))
  }

  export function listRunsByStatus(projectId: string, status: LoopRun["status"]): LoopRun[] {
    const rows = db()
      .select({ data: loopRun.data })
      .from(loopRun)
      .where(and(eq(loopRun.projectId, projectId), eq(loopRun.status, status)))
      .orderBy(desc(loopRun.startedAt))
      .all()
    return defined(rows.map((row) => readRun(row.data)))
  }

  /**
   * Keep the newest `limit` runs of a loop and delete the rest.
   *
   * The old implementation listed every key, read every record, sorted in
   * memory, and issued one delete per victim. This is the same policy as one
   * statement over an index.
   */
  export function trimRuns(projectId: string, loopId: string, limit: number): void {
    Database.transaction((tx) => {
      const ids = tx
        .select({ id: loopRun.id })
        .from(loopRun)
        .where(and(eq(loopRun.projectId, projectId), eq(loopRun.loopId, loopId)))
        .orderBy(desc(loopRun.startedAt), asc(loopRun.id))
        .all()
      const victims = ids.slice(limit).map((row) => row.id)
      if (victims.length === 0) return
      tx.delete(loopRun).where(inArray(loopRun.id, victims)).run()
    })
  }
}
