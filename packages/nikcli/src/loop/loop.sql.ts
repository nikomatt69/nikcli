import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

// ============================================================================
// Loops — SQL backend for the former ["loop"|"loop_run"|"loop_meta"] JSON tree
// ============================================================================

/**
 * A loop definition.
 *
 * `data` holds the whole `LoopDefinition`; the columns beside it exist only
 * because something queries or orders by them. `startedRuns` absorbs the
 * former `loop_meta` record: it is the lifetime count of started runs, kept
 * separate from the run history because `trimRuns` caps that history at
 * `HISTORY_LIMIT` while `maxRuns` must keep working past it.
 *
 * It is deliberately **nullable**. `null` means "never counted", which is what
 * triggers the one-time derive-from-history path for loops created before the
 * counter existed. A `NOT NULL DEFAULT 0` column could not tell that apart
 * from a loop that has genuinely started zero runs.
 */
export const loop = sqliteTable(
  "loop",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    enabled: integer("enabled").notNull(),
    paused: integer("paused").notNull(),
    triggerKind: text("trigger_kind").notNull(),
    startedRuns: integer("started_runs"),
    data: text("data").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    projectIdx: index("idx_loop_project").on(table.projectId, table.createdAt),
  }),
)

/**
 * One run of one loop.
 *
 * There is intentionally **no foreign key** to `loop`. Runs must be able to
 * outlive their definition: `listRunningRuns` recovers `running` rows left
 * behind by a process that died, and that recovery has to work even when the
 * loop was deleted in between. Deleting a loop cascades in `LoopRepo.remove`
 * instead, where the sandbox teardown already lives.
 */
export const loopRun = sqliteTable(
  "loop_run",
  {
    id: text("id").primaryKey(),
    loopId: text("loop_id").notNull(),
    projectId: text("project_id").notNull(),
    status: text("status").notNull(),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    data: text("data").notNull(),
  },
  (table) => ({
    loopIdx: index("idx_loop_run_loop").on(table.loopId, table.startedAt),
    projectStatusIdx: index("idx_loop_run_project_status").on(table.projectId, table.status),
  }),
)
