import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core"

// ============================================================================
// Background runs — SQL backend for the former ["background_run", projectID, id]
// ============================================================================

/**
 * One background/delegation run.
 *
 * `data` holds the whole `BackgroundRun.Record`. `project_id` is part of the
 * key because generated names (`happy-blue-fox`) are only unique within a
 * project. `status` and `parent_session_id` are extracted because
 * `listRunning` / `listForParent` query them; lease/heartbeat stay inside
 * `data` and are checked in process after the running set is loaded.
 */
export const backgroundRun = sqliteTable(
  "background_run",
  {
    id: text("id").notNull(),
    projectId: text("project_id").notNull(),
    status: text("status").notNull(),
    parentSessionId: text("parent_session_id").notNull(),
    data: text("data").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.id] }),
    projectIdx: index("idx_background_run_project").on(table.projectId, table.createdAt),
    statusIdx: index("idx_background_run_status").on(table.projectId, table.status),
    parentIdx: index("idx_background_run_parent").on(table.parentSessionId, table.createdAt),
  }),
)
