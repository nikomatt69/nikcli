import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

// ============================================================================
// Projects — SQL backend for the former ["project"|"project_directory"] tree
// ============================================================================

/**
 * A project identity record.
 *
 * `data` holds the whole `Project.Info`. `directories` absorbs the former
 * `["project_directory", projectID]` sibling: it is a JSON array of
 * `{ directory, strategy? }`, kept off `data` so an identity upsert cannot
 * clobber it.
 *
 * It is deliberately **nullable**. `null` means "never written", which is
 * what triggers the bootstrap-from-sandboxes path in `readDirectories`. A
 * stored `[]` is a real empty list and must not re-bootstrap.
 */
export const project = sqliteTable(
  "project",
  {
    id: text("id").primaryKey(),
    data: text("data").notNull(),
    directories: text("directories"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    updatedIdx: index("idx_project_updated").on(table.updatedAt),
  }),
)
