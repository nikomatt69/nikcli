import { eq } from "drizzle-orm";
import { Database } from "@/database/database";
import { todoInfo } from "./todo.sql";
import type { Todo } from "./todo";

/**
 * SQL-backed repository for Todo data.
 * Provides synchronous CRUD operations against the central nikcli.db.
 */
export namespace TodoRepo {
  function db() {
    return Database.syncDb();
  }

  export function get(sessionId: string): Todo.Info[] {
    const row = db()
      .select()
      .from(todoInfo)
      .where(eq(todoInfo.sessionId, sessionId))
      .get();
    if (!row) return [];
    try {
      return JSON.parse(row.todos) as Todo.Info[];
    } catch {
      return [];
    }
  }

  export function upsert(sessionId: string, todos: Todo.Info[]): void {
    db()
      .insert(todoInfo)
      .values({
        sessionId,
        todos: JSON.stringify(todos),
      })
      .onConflictDoUpdate({
        target: todoInfo.sessionId,
        set: {
          todos: JSON.stringify(todos),
        },
      })
      .run();
  }

  export function remove(sessionId: string): boolean {
    const result = db()
      .delete(todoInfo)
      .where(eq(todoInfo.sessionId, sessionId))
      .run();
    return (result as any).changes > 0;
  }
}
