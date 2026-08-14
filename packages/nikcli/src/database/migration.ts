import { Database as BunDatabase } from "bun:sqlite"
import { Log } from "@nikcli-ai/util/log"
import { migrations } from "./migration.gen"

export namespace DatabaseMigration {
  const log = Log.create({ service: "database-migration" })

  export type Migration = {
    id: string
    up(database: BunDatabase): void
  }

  function completed(database: BunDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS migration (
        id TEXT PRIMARY KEY,
        time_completed INTEGER NOT NULL
      );
    `)

    const rows = database.query<{ id: string }, []>("SELECT id FROM migration").all()
    return new Set(rows.map((row) => row.id))
  }

  export function apply(database: BunDatabase, input: readonly Migration[] = migrations): void {
    const applied = completed(database)

    for (const migration of input) {
      if (applied.has(migration.id)) continue

      log.info("applying migration", { id: migration.id })
      database.exec("BEGIN IMMEDIATE")
      try {
        migration.up(database)
        database.query("INSERT INTO migration (id, time_completed) VALUES (?, ?)").run(migration.id, Date.now())
        database.exec("COMMIT")
        applied.add(migration.id)
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      }
    }
  }
}
