import { and, eq, desc, asc, inArray, isNotNull, isNull, gte, sql } from "drizzle-orm"
import { parseModel, stringifyModel } from "@nikcli-ai/util/model"
import { Filesystem } from "@nikcli-ai/util/filesystem"
import { Database } from "@/database/database"
import { sessionInfo } from "./session.sql"
import type { Session } from "./index"

/**
 * SQL-backed repository for Session data.
 * Provides synchronous CRUD operations against the central nikcli.db.
 *
 * The `data` column stores the full JSON-serialized Session.Info for fields
 * not extracted into dedicated columns (github, mobile, summary, share, etc.).
 */
export namespace SessionRepo {
  function db() {
    return Database.syncDb()
  }

  /**
   * Writes accept an executor so a projector can run inside the same
   * transaction that appends its event (see sync/sync-event.ts). Reads stay
   * on the shared client — they are never part of a projection.
   */
  type Executor = Database.TxOrDb

  type SessionRow = typeof sessionInfo.$inferSelect

  /** Extract key fields for indexed columns; store the rest as JSON in `data` */
  function rowToInfo(row: SessionRow): Session.Info {
    // The `data` column holds the full session, parse it
    const info = JSON.parse(row.data) as Session.Info
    // `last_model` is the source of truth for the cached "last used model";
    // the JSON blob may be stale on rows written before this column existed.
    if (row.lastModel) {
      info.lastModel = parseModel(row.lastModel)
    } else if (info.lastModel === undefined) {
      delete info.lastModel
    }
    return info
  }

  /** Build a row from Session.Info for insertion */
  function infoToRow(info: Session.Info) {
    return {
      id: info.id,
      projectId: info.projectID,
      title: info.title,
      directory: info.directory,
      parentId: info.parentID ?? null,
      workspaceId: info.workspaceID ?? null,
      version: info.version,
      data: JSON.stringify(info),
      createdAt: info.time.created,
      updatedAt: info.time.updated,
      lastModel: info.lastModel ? stringifyModel(info.lastModel) : null,
      // Derived, so `query()` can filter on the same values the JS predicates
      // used to compute at read time. Never read back into `Session.Info`.
      directoryKey: Filesystem.comparisonKey(info.directory),
      titleLower: info.title.toLowerCase(),
    }
  }

  export function get(id: string): Session.Info | undefined {
    const row = db().select().from(sessionInfo).where(eq(sessionInfo.id, id)).get()
    return row ? rowToInfo(row) : undefined
  }

  export function getByProject(projectId: string): Session.Info[] {
    const rows = db()
      .select()
      .from(sessionInfo)
      .where(eq(sessionInfo.projectId, projectId))
      .orderBy(asc(sessionInfo.createdAt))
      .all()
    return rows.map(rowToInfo)
  }

  export function list(projectId: string): Session.Info[] {
    return getByProject(projectId)
  }

  /**
   * Filters, orders, and limits the session list in SQL.
   *
   * `GET /session` used to read every session of the project through
   * `Array.fromAsync` and then filter, sort, and slice in JS; on a large
   * project that parsed one `data` blob per row to keep a handful (P2.1).
   * Every predicate here is the SQL form of the JS one it replaces, exactly:
   *
   * - `directoryKey` is compared against the stored
   *   `Filesystem.comparisonKey(directory)`, so Windows case folding is the
   *   JS one and not SQLite's ASCII `lower()`. Callers pass a key, not a path.
   * - `search` is `instr(title_lower, ?) > 0` against the stored JS-lowered
   *   title: a substring test, so a `%` or `_` in the term stays a literal
   *   the way `String.includes` treats it.
   * - `start` keeps the route's `time.updated >= start` boundary.
   * - `roots` keeps only sessions with no parent.
   *
   * Rows are mapped after the limit, so `rowToInfo`'s `JSON.parse` runs once
   * per returned session rather than once per stored session.
   */
  export type Query = {
    projectId: string
    workspaceId?: string | undefined
    directoryKey?: string | undefined
    roots?: boolean | undefined
    start?: number | undefined
    search?: string | undefined
    limit?: number | undefined
  }

  export function query(input: Query): Session.Info[] {
    const conditions = [eq(sessionInfo.projectId, input.projectId)]
    if (input.workspaceId !== undefined) conditions.push(eq(sessionInfo.workspaceId, input.workspaceId))
    if (input.directoryKey !== undefined) conditions.push(eq(sessionInfo.directoryKey, input.directoryKey))
    if (input.roots) conditions.push(isNull(sessionInfo.parentId))
    if (input.start !== undefined) conditions.push(gte(sessionInfo.updatedAt, input.start))
    if (input.search !== undefined && input.search !== "") {
      conditions.push(sql`instr(${sessionInfo.titleLower}, ${input.search.toLowerCase()}) > 0`)
    }
    const base = db()
      .select()
      .from(sessionInfo)
      .where(and(...conditions))
      // `createdAt` breaks ties the way the old JS path did: its input came
      // from `getByProject` (created-ascending) and `Array.prototype.sort` is
      // stable, so equal `updatedAt` kept created order.
      .orderBy(desc(sessionInfo.updatedAt), asc(sessionInfo.createdAt))
    const rows = input.limit !== undefined ? base.limit(input.limit).all() : base.all()
    return rows.map(rowToInfo)
  }

  /**
   * List every session across all projects, newest-updated first.
   *
   * Used by server-wide routes (e.g. the mobile `/mobile/session` list) that
   * intentionally do not scope to a single project. The SQL migration in
   * commit 50b55f9a4 moved sessions out of the JSON file store, so the old
   * `Storage.list(["session"])` traversal in those routes now returns
   * nothing — the list screen therefore showed "0 sessions" until this
   * method was wired in.
   */
  export function listAll(): Session.Info[] {
    const rows = db().select().from(sessionInfo).orderBy(desc(sessionInfo.updatedAt)).all()
    return rows.map(rowToInfo)
  }

  export function upsert(info: Session.Info, tx: Executor = db()): void {
    const row = infoToRow(info)
    tx.insert(sessionInfo)
      .values(row)
      .onConflictDoUpdate({
        target: sessionInfo.id,
        set: {
          projectId: row.projectId,
          title: row.title,
          directory: row.directory,
          parentId: row.parentId,
          workspaceId: row.workspaceId,
          version: row.version,
          data: row.data,
          updatedAt: row.updatedAt,
          lastModel: row.lastModel,
          // Derived from `title` / `directory` above; both column lists here
          // are enumerated by hand, so these have to move with their source
          // or a rename would leave `query()` filtering on the old value.
          directoryKey: row.directoryKey,
          titleLower: row.titleLower,
        },
      })
      .run()
  }

  export function update(
    id: string,
    editor: (session: Session.Info) => Session.Info,
    tx: Executor = db(),
  ): Session.Info | undefined {
    const existing = get(id)
    if (!existing) return undefined
    const updated = editor(existing)
    const row = infoToRow(updated)
    tx.update(sessionInfo)
      .set({
        title: row.title,
        directory: row.directory,
        parentId: row.parentId,
        workspaceId: row.workspaceId,
        version: row.version,
        data: row.data,
        updatedAt: row.updatedAt,
        lastModel: row.lastModel,
        directoryKey: row.directoryKey,
        titleLower: row.titleLower,
      })
      .where(eq(sessionInfo.id, id))
      .run()
    return updated
  }

  /**
   * Persist the last provider/model used in this session. Cheap path that
   * touches one indexed column instead of re-writing the full JSON blob;
   * called on every prompt resolution in `SessionPrompt.prepareUserMessage`.
   *
   * No-ops if the session is unknown or the value did not change, to avoid
   * a needless write per turn. Also patches the in-memory `data` blob so the
   * next read through `get()` reflects the update immediately.
   */
  export function setLastModel(id: string, model: { providerID: string; modelID: string }, tx: Executor = db()): void {
    const existing = get(id)
    if (!existing) return
    const value = stringifyModel(model)
    if (existing.lastModel && stringifyModel(existing.lastModel) === value) return
    tx.update(sessionInfo).set({ lastModel: value, updatedAt: Date.now() }).where(eq(sessionInfo.id, id)).run()
    existing.lastModel = model
  }

  export function remove(id: string, tx: Executor = db()): boolean {
    const result = tx.delete(sessionInfo).where(eq(sessionInfo.id, id)).run()
    return (result as any).changes > 0
  }

  /**
   * Mark sessions as suspended by a graceful shutdown.
   *
   * Called *before* the abort-and-drain, not after: a crash between the mark
   * and the interrupt leaves a session marked suspended that was never
   * interrupted, and a spurious resume re-enters a loop that is already idle —
   * cheap and correct. The reverse order loses the turn, which is the failure
   * this exists to fix.
   */
  export function suspend(ids: string[], at = Date.now(), tx: Executor = db()): void {
    if (ids.length === 0) return
    tx.update(sessionInfo).set({ timeSuspended: at }).where(inArray(sessionInfo.id, ids)).run()
  }

  /**
   * Claim every suspended session, clearing the mark in the same statement.
   *
   * The single `UPDATE ... RETURNING` is what makes this safe when two servers
   * start on one data directory: only one of them can observe a given row as
   * non-null, so a session is resumed at most once.
   */
  export function consumeSuspended(tx: Executor = db()): { id: string; directory: string }[] {
    return tx
      .update(sessionInfo)
      .set({ timeSuspended: null })
      .where(isNotNull(sessionInfo.timeSuspended))
      .returning({ id: sessionInfo.id, directory: sessionInfo.directory })
      .all()
  }

  export function getChildren(parentId: string): Session.Info[] {
    const rows = db()
      .select()
      .from(sessionInfo)
      .where(eq(sessionInfo.parentId, parentId))
      .orderBy(asc(sessionInfo.createdAt))
      .all()
    return rows.map(rowToInfo)
  }
}
