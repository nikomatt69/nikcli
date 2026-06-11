import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

// ============================================================================
// Session Info — SQL backend for JSON-backed session storage
// ============================================================================

export const sessionInfo = sqliteTable(
  "session_info",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    title: text("title").notNull(),
    directory: text("directory").notNull(),
    parentId: text("parent_id"),
    workspaceId: text("workspace_id"),
    version: text("version").notNull(),
    /** Full JSON-serialized Session.Info for fields not extracted above */
    data: text("data").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    projectIdx: index("idx_session_info_project").on(table.projectId),
    parentIdx: index("idx_session_info_parent").on(table.parentId),
    workspaceIdx: index("idx_session_info_workspace").on(table.workspaceId),
  }),
)
