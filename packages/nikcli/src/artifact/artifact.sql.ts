import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core"

// ============================================================================
// Artifacts — SQL backend for the former ["artifact", sessionID, id] tree
// ============================================================================

/**
 * A published artifact (the local copy of the store record, including secret).
 *
 * Composite primary key because the same store id is never reused across
 * sessions, but every lookup is `(sessionID, artifactID)`.
 */
export const artifact = sqliteTable(
  "artifact",
  {
    id: text("id").notNull(),
    sessionId: text("session_id").notNull(),
    data: text("data").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sessionId, table.id] }),
    sessionUpdatedIdx: index("idx_artifact_session_updated").on(table.sessionId, table.updatedAt),
  }),
)
