import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

// ============================================================================
// Missions — SQL backend for the former ["mission"|"mission_exec"] JSON tree
// ============================================================================

/**
 * A mission definition.
 *
 * `data` holds the whole `MissionDefinition`; the columns beside it exist
 * only because something queries or orders by them. There is no separate
 * counter record — unlike loops, missions do not cap a lifetime count
 * independently of history.
 */
export const mission = sqliteTable(
  "mission",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    data: text("data").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    projectIdx: index("idx_mission_project").on(table.projectId, table.createdAt),
  }),
)

/**
 * One execution of one feature or validation checkpoint.
 *
 * No foreign key to `mission`: `listRunningExecs` recovers `running` rows
 * left behind by a process that died, and that recovery has to work even
 * when the mission was deleted in between. Deleting a mission cascades in
 * `MissionRepo.remove` instead.
 */
export const missionExec = sqliteTable(
  "mission_exec",
  {
    id: text("id").primaryKey(),
    missionId: text("mission_id").notNull(),
    projectId: text("project_id").notNull(),
    status: text("status").notNull(),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    data: text("data").notNull(),
  },
  (table) => ({
    missionIdx: index("idx_mission_exec_mission").on(table.missionId, table.startedAt),
    projectStatusIdx: index("idx_mission_exec_project_status").on(table.projectId, table.status),
  }),
)
