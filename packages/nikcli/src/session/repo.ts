import { eq, and, desc, asc, inArray, isNotNull } from "drizzle-orm"
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
    return JSON.parse(row.data) as Session.Info
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
      })
      .where(eq(sessionInfo.id, id))
      .run()
    return updated
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
