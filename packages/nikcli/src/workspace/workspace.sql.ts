import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// ============================================================================
// Workspace
// ============================================================================
//
// NOTE: the `events` JSON column and `event_limit` integer column were
// removed in the 20260630_sync_unify migration series. The single source
// of truth for workspace events is now `sync_event` (see @/sync/sync.sql).
// Snapshots for cold-start are stored in `sync_snapshot`.

export const workspace = sqliteTable(
  "workspace",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull().default(""),
    branch: text("branch"),
    config: text("config").notNull(),
    /** Connection status: "connecting" | "connected" | "disconnected" | "error". */
    status: text("status"),
    timeUsed: integer("time_used").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    projectIdx: index("idx_workspace_project").on(table.projectId),
  }),
);
