import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

// ============================================================================
// Session diffs — SQL backend for the former ["session_diff", sessionID] tree
// ============================================================================

/**
 * The session-level `FileDiff[]` shown in the TUI / share payload.
 *
 * This is not a rebuildable cache. `SessionSummary.computeDiff` can recreate
 * it from `Snapshot.diffFull` only while the snapshot gitdir still has the
 * `write-tree` hashes stored on step-start / step-finish parts. Those trees
 * are unreachable (no ref) and `gc --prune=7.days` drops them. Share import
 * also writes a ready-made list that may never have had snapshot hashes.
 * `data` holds the whole array; lookups are always by session.
 */
export const sessionDiff = sqliteTable("session_diff", {
  sessionId: text("session_id").primaryKey(),
  data: text("data").notNull(),
  updatedAt: integer("updated_at").notNull(),
})
