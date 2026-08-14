import { eq } from "drizzle-orm"
import { Database } from "@/database/database"
import { sessionGoal } from "./goal.sql"
import type { SessionGoal } from "./goal"

/**
 * SQL-backed repository for session goals.
 *
 * Replaces the `["goal", sessionID]` JSON key. Sanitization happens on the
 * way out: a corrupt row is dropped rather than surfaced.
 */
export namespace GoalRepo {
  function db() {
    return Database.syncDb()
  }

  function readState(data: string): SessionGoal.State | undefined {
    try {
      const parsed = JSON.parse(data) as SessionGoal.State
      if (!parsed || typeof parsed.sessionID !== "string" || typeof parsed.goalID !== "string") return undefined
      if (typeof parsed.objective !== "string" || typeof parsed.status !== "string") return undefined
      return parsed
    } catch {
      return undefined
    }
  }

  export function get(sessionId: string): SessionGoal.State | undefined {
    const row = db()
      .select({ data: sessionGoal.data })
      .from(sessionGoal)
      .where(eq(sessionGoal.sessionId, sessionId))
      .get()
    return row ? readState(row.data) : undefined
  }

  export function upsert(state: SessionGoal.State): void {
    db()
      .insert(sessionGoal)
      .values({
        sessionId: state.sessionID,
        data: JSON.stringify(state),
        updatedAt: state.timeUpdated,
      })
      .onConflictDoUpdate({
        target: sessionGoal.sessionId,
        set: {
          data: JSON.stringify(state),
          updatedAt: state.timeUpdated,
        },
      })
      .run()
  }

  /** Mutate-in-place, matching `Storage.update`. Returns undefined when missing. */
  export function update(sessionId: string, fn: (draft: SessionGoal.State) => void): SessionGoal.State | undefined {
    const current = get(sessionId)
    if (!current) return undefined
    const draft = structuredClone(current)
    fn(draft)
    upsert(draft)
    return draft
  }

  export function remove(sessionId: string): boolean {
    const result = db().delete(sessionGoal).where(eq(sessionGoal.sessionId, sessionId)).run()
    return (result as any).changes > 0
  }
}
