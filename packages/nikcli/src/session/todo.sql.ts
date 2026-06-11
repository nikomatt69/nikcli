import { sqliteTable, text } from "drizzle-orm/sqlite-core";

// ============================================================================
// Todo Info — SQL backend for JSON-backed todo storage
// ============================================================================

export const todoInfo = sqliteTable("todo_info", {
  /** Session ID — one todo list per session */
  sessionId: text("session_id").primaryKey(),
  /** JSON array of Todo.Info items */
  todos: text("todos").notNull().default("[]"),
});
