import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { asc, desc } from "drizzle-orm"

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
    /**
     * Last provider/model used in this session, persisted as "providerID/modelID".
     * Worker prompts (mission/loop/background/task/brain/plan) inherit from
     * this when their caller session supplies it, so the user does not have to
     * re-pick the model every time they spawn a child run.
     *
     * Set on every successful prompt resolution in `prepareUserMessage`.
     */
    lastModel: text("last_model"),
    /**
     * `Filesystem.comparisonKey(directory)`, written on every upsert.
     *
     * The list route compares directories by that key, not by the raw string:
     * on Windows it resolves, forward-slashes, and lowercases. Comparing in
     * SQL against the raw `directory` column would therefore be a different
     * predicate. Storing the key makes SQL equality *exactly* the JS
     * comparison instead of an approximation of it (P2.1), which is what lets
     * the directory filter run before ORDER BY / LIMIT.
     *
     * Derived, never on the wire: `Session.Info` keeps only `directory`.
     */
    directoryKey: text("directory_key"),
    /**
     * `title.toLowerCase()`, written on every upsert.
     *
     * The list route's search is a case-insensitive substring test done in
     * JS. SQLite's `lower()` is ASCII-only, so `LOWER(title) LIKE …` would
     * silently drop non-ASCII matches; a stored JS-lowered title keeps the
     * predicate exact. Queried with `instr()`, not `LIKE`, because `LIKE`
     * would read `%` and `_` in a user's search term as wildcards while
     * `String.includes` does not.
     *
     * Derived, never on the wire.
     */
    titleLower: text("title_lower"),
  },
  (table) => ({
    projectIdx: index("idx_session_info_project").on(table.projectId),
    parentIdx: index("idx_session_info_parent").on(table.parentId),
    workspaceIdx: index("idx_session_info_workspace").on(table.workspaceId),
    /**
     * Serves the list route: project scope, newest-updated first, then LIMIT.
     *
     * The column directions match the query's `ORDER BY updated_at DESC,
     * created_at ASC` on purpose. With a plain ascending index SQLite reads
     * the index for the project scope but still builds a temp B-tree for the
     * last ORDER BY term; with these, `EXPLAIN QUERY PLAN` is a bare SEARCH.
     */
    projectUpdatedIdx: index("idx_session_info_project_updated").on(
      table.projectId,
      desc(table.updatedAt),
      asc(table.createdAt),
    ),
    directoryKeyIdx: index("idx_session_info_directory_key").on(table.directoryKey),
  }),
)
