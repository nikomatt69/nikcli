import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

// ============================================================================
// Session v2 event log — durable form of the SessionEvent stream
// ============================================================================

/**
 * One row per persisted SessionEvent. Lifecycle events (step.started,
 * retry.error, step.ended) insert under their event id; part.updated events
 * insert under the originating v1 part id so live re-emissions of the same
 * part coalesce into one row (info/timestamp update, sortKey keeps the
 * first-seen position). Replaying rows ordered by sortKey through
 * Stepper.stepWith reproduces the final reduction.
 */
export const sessionV2Event = sqliteTable(
  "session_v2_event",
  {
    /** Event id, or the v1 part id for coalesced part.updated rows */
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    messageId: text("message_id").notNull(),
    type: text("type").notNull(),
    /** Full JSON-serialized SessionEvent */
    info: text("info").notNull(),
    /** First event id written for this row — stable replay ordering */
    sortKey: text("sort_key").notNull(),
    timestamp: integer("timestamp").notNull(),
  },
  (table) => ({
    sessionIdx: index("idx_session_v2_event_session").on(table.sessionId),
    messageIdx: index("idx_session_v2_event_message").on(table.messageId),
    sortIdx: index("idx_session_v2_event_sort").on(table.sessionId, table.sortKey),
  }),
)
