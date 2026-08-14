import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core"

// ============================================================================
// Session entries — the persisted v2 read model
// ============================================================================

/**
 * One row per flat `SessionEntry`. Slice 1 of the v2 write path persists
 * this row from the event payload before `message_info` / `message_part`.
 * See specs/v2/session-v2-write-path.md.
 *
 * `ref` is the entry's stable identity within a session: the originating v1
 * part id for streamed entries, or a synthesized `<messageID>#start` /
 * `#complete` / `#user` key for the message-level ones. Upserting on it is
 * what makes a streaming delta a single-row write.
 *
 * Ordering is the `id` itself — see `SessionEntry.idForPart`. Keeping a
 * separate sort column would mean the server ordered by one convention and
 * clients by another, and the two would drift; deriving the id so that
 * lexicographic order *is* conversation order removes the question.
 */
export const sessionEntry = sqliteTable(
  "session_entry",
  {
    /** Entry id (`evt_…`), stable across upserts of the same `ref` */
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    messageId: text("message_id").notNull(),
    type: text("type").notNull(),
    /** Stable identity within the session — the upsert key */
    ref: text("ref").notNull(),
    /** Full JSON-serialized SessionEntry */
    info: text("info").notNull(),
    timestamp: integer("timestamp").notNull(),
  },
  (table) => ({
    refIdx: uniqueIndex("idx_session_entry_ref").on(table.sessionId, table.ref),
    sessionIdx: index("idx_session_entry_session").on(table.sessionId, table.id),
    messageIdx: index("idx_session_entry_message").on(table.messageId),
  }),
)
