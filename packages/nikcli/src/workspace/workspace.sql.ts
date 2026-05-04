import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

// ============================================================================
// Workspace
// ============================================================================

export const workspace = sqliteTable(
  "workspace",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    branch: text("branch"),
    config: text("config").notNull(),
    status: text("status"),
    events: text("events"),
    eventLimit: integer("event_limit"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    projectIdx: index("idx_workspace_project").on(table.projectId),
  }),
)
