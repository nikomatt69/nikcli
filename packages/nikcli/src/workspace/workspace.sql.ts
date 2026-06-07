import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

// ============================================================================
// Workspace
// ============================================================================

export const workspace = sqliteTable(
  "workspace",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull().default(""),
    branch: text("branch"),
    config: text("config").notNull(),
    status: text("status"),
    events: text("events"),
    eventLimit: integer("event_limit"),
    timeUsed: integer("time_used").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    projectIdx: index("idx_workspace_project").on(table.projectId),
  }),
)
