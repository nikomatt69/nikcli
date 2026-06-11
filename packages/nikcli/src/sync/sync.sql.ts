import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core"

// ============================================================================
// Sync Events — SQL backend for JSON-backed sync event storage
// ============================================================================

export const syncEvent = sqliteTable(
  "sync_event",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    aggregate: text("aggregate").notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    /** Full JSON-serialized event data */
    data: text("data").notNull(),
    timestamp: integer("timestamp").notNull(),
  },
  (table) => ({
    projectIdx: index("idx_sync_event_project").on(table.projectId),
    aggregateIdx: index("idx_sync_event_aggregate").on(table.projectId, table.aggregate),
    seqIdx: index("idx_sync_event_seq").on(table.projectId, table.aggregate, table.seq),
  }),
)

// ============================================================================
// Sync Sequences — SQL backend for JSON-backed sequence counter storage
// ============================================================================

export const syncSequence = sqliteTable(
  "sync_sequence",
  {
    projectId: text("project_id").notNull(),
    aggregate: text("aggregate").notNull(),
    seq: integer("seq").notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.aggregate] }),
  }),
)
