import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

// ============================================================================
// Session Info — SQL backend for session rows (`Session.Info` in `data`)
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
    /**
     * Private. Set by a server suspending an actively running session during
     * graceful shutdown; consumed exactly once by the next server that starts
     * on this data directory. Never projected into `Session.Info`, never on
     * the wire. See `specs/v2/session-restart-continuation.md`.
     *
     * Its index is partial (`WHERE time_suspended IS NOT NULL`) and lives in
     * `20260814010000_session_time_suspended`; drizzle's table definition does
     * not carry the predicate.
     */
    timeSuspended: integer("time_suspended"),
  },
  (table) => ({
    projectIdx: index("idx_session_info_project").on(table.projectId),
    parentIdx: index("idx_session_info_parent").on(table.parentId),
    workspaceIdx: index("idx_session_info_workspace").on(table.workspaceId),
  }),
)
