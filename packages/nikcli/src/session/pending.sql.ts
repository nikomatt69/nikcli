import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

export const sessionPending = sqliteTable(
  "session_pending",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    delivery: text("delivery", { enum: ["steer", "queue"] }).notNull(),
    messageId: text("message_id").notNull(),
    data: text("data").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    sessionCreatedIdx: index("session_pending_session_created").on(table.sessionId, table.createdAt, table.id),
    sessionMessageIdx: uniqueIndex("session_pending_session_message").on(table.sessionId, table.messageId),
  }),
)
