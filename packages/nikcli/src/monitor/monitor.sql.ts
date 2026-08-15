import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

// ============================================================================
// Monitors — SQL backend for the former ["monitor", sessionID, monitorID] tree
// ============================================================================

/**
 * One background-process monitor.
 *
 * `data` holds the whole `Monitor.Record`. `session_id` and `status` are
 * extracted because `reconcile` lists every `running` row across sessions,
 * and `cancelAll` / load are scoped by session.
 */
export const monitor = sqliteTable(
  "monitor",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    status: text("status").notNull(),
    data: text("data").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    sessionIdx: index("idx_monitor_session").on(table.sessionId, table.createdAt),
    statusIdx: index("idx_monitor_status").on(table.status),
  }),
)
