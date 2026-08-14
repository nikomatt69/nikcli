import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

// ============================================================================
// Session goals — SQL backend for the former ["goal", sessionID] JSON tree
// ============================================================================

/**
 * One live goal per session.
 *
 * `data` holds the whole `SessionGoal.State`. Lookups are always by
 * `session_id`, which is why there is no second extracted column: nothing
 * lists goals across sessions.
 */
export const sessionGoal = sqliteTable("session_goal", {
  sessionId: text("session_id").primaryKey(),
  data: text("data").notNull(),
  updatedAt: integer("updated_at").notNull(),
})
