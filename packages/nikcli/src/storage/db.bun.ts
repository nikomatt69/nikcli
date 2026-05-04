import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"

/**
 * Initialize a Drizzle database client from a Bun SQLite connection.
 * This is the Bun-specific initializer — a Node.js variant could be added later.
 */
export function init(path: string) {
  const sqlite = new Database(path, { create: true })
  const db = drizzle(sqlite)
  return db
}
