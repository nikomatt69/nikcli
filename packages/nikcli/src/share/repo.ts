import { eq } from "drizzle-orm"
import { Database } from "@/database/database"
import type { Session } from "@/session"
import { localShare, sessionShare } from "./share.sql"

/**
 * SQL-backed repository for share handles.
 *
 * Replaces `["session_share", sessionID]` and `["local_share", shareID]`.
 */
export namespace ShareRepo {
  function db() {
    return Database.syncDb()
  }

  type Executor = Database.TxOrDb

  export type LocalShare = {
    id: string
    sessionID: string
    url: string
    time: {
      created: number
      updated: number
    }
    items: Record<string, unknown>
  }

  function readShare(data: string): Session.ShareInfo | undefined {
    try {
      return JSON.parse(data) as Session.ShareInfo
    } catch {
      return undefined
    }
  }

  function readLocal(data: string): LocalShare | undefined {
    try {
      return JSON.parse(data) as LocalShare
    } catch {
      return undefined
    }
  }

  export function get(sessionId: string): Session.ShareInfo | undefined {
    const row = db()
      .select({ data: sessionShare.data })
      .from(sessionShare)
      .where(eq(sessionShare.sessionId, sessionId))
      .get()
    return row ? readShare(row.data) : undefined
  }

  export function put(sessionId: string, share: Session.ShareInfo, executor: Executor = db()): void {
    executor
      .insert(sessionShare)
      .values({
        sessionId,
        mode: share.mode ?? null,
        data: JSON.stringify(share),
      })
      .onConflictDoUpdate({
        target: sessionShare.sessionId,
        set: {
          mode: share.mode ?? null,
          data: JSON.stringify(share),
        },
      })
      .run()
  }

  export function remove(sessionId: string, executor: Executor = db()): void {
    executor.delete(sessionShare).where(eq(sessionShare.sessionId, sessionId)).run()
  }

  export function getLocal(shareId: string): LocalShare | undefined {
    const row = db().select({ data: localShare.data }).from(localShare).where(eq(localShare.id, shareId)).get()
    return row ? readLocal(row.data) : undefined
  }

  export function putLocal(share: LocalShare, executor: Executor = db()): void {
    executor
      .insert(localShare)
      .values({
        id: share.id,
        sessionId: share.sessionID,
        data: JSON.stringify(share),
        createdAt: share.time.created,
        updatedAt: share.time.updated,
      })
      .onConflictDoUpdate({
        target: localShare.id,
        set: {
          sessionId: share.sessionID,
          data: JSON.stringify(share),
          updatedAt: share.time.updated,
        },
      })
      .run()
  }

  export function removeLocal(shareId: string, executor: Executor = db()): void {
    executor.delete(localShare).where(eq(localShare.id, shareId)).run()
  }
}
