import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core"

// ============================================================================
// Routines — SQL backend for the former ["routine", projectID, id] JSON tree
// ============================================================================

/**
 * One cron/API routine.
 *
 * `data` holds the whole `Routine.Record`. Composite primary key because
 * generated names are only unique within a project. Lookups are by
 * `(project_id, id)` or a project-scoped list ordered by `created_at`.
 * Trigger tokens stay inside `data`; `getByToken` still scans the project.
 */
export const routine = sqliteTable(
  "routine",
  {
    id: text("id").notNull(),
    projectId: text("project_id").notNull(),
    paused: integer("paused").notNull(),
    data: text("data").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.id] }),
    projectIdx: index("idx_routine_project").on(table.projectId, table.createdAt),
  }),
)
