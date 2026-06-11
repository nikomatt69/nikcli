import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sessionInfo } from "./session.sql";

// ============================================================================
// Message Info — SQL backend for JSON-backed message storage
// ============================================================================

export const messageInfo = sqliteTable(
  "message_info",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessionInfo.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    /** Full JSON-serialized MessageV2.Info (user or assistant) */
    info: text("info").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    sessionIdx: index("idx_message_info_session").on(table.sessionId),
    roleIdx: index("idx_message_info_role").on(table.role),
  }),
);

// ============================================================================
// Message Parts — SQL backend for JSON-backed part storage
// ============================================================================

export const messagePart = sqliteTable(
  "message_part",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").notNull(),
    sessionId: text("session_id").notNull(),
    type: text("type").notNull(),
    /** Full JSON-serialized Part */
    info: text("info").notNull(),
    /** Sort key for ordering parts within a message (same as id for ascending order) */
    sortKey: text("sort_key").notNull(),
  },
  (table) => ({
    messageIdx: index("idx_message_part_message").on(table.messageId),
    sessionIdx: index("idx_message_part_session").on(table.sessionId),
    sortIdx: index("idx_message_part_sort").on(table.messageId, table.sortKey),
  }),
);
