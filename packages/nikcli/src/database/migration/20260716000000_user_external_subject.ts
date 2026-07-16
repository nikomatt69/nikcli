import { Database as BunDatabase } from "bun:sqlite"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260716000000_user_external_subject",
  up(database: BunDatabase) {
    const columns = database.query<{ name: string }, []>("PRAGMA table_info(users)").all()
    if (!columns.some((column) => column.name === "external_subject")) {
      database.exec("ALTER TABLE users ADD COLUMN external_subject TEXT")
    }
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_external_subject ON users(external_subject)")
  },
} satisfies DatabaseMigration.Migration
