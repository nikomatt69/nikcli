import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"

/**
 * A real SQLite database behind the slice of the D1 API this worker uses.
 *
 * The sign-in flows that hurt users most — approving a device, verifying an
 * emailed code, replaying a duplicate submit — are exactly the ones that span
 * several statements and depend on what an UPDATE actually matched. A stub
 * that asserts on SQL strings cannot catch a regression there; running the
 * shipped migration against bun:sqlite can.
 */
const schema = readFileSync(new URL("../../migrations/0001_identity.sql", import.meta.url), "utf8")

type Bindable = string | number | bigint | boolean | null

export type MemoryD1 = D1Database & { close(): void }

export function memoryD1(): MemoryD1 {
  const db = new Database(":memory:")
  db.run(schema)

  function statement(sql: string, params: Bindable[] = []) {
    return {
      bind(...values: unknown[]) {
        return statement(sql, values as Bindable[])
      },
      async first<T>(): Promise<T | null> {
        return (db.prepare(sql).get(...params) as T | undefined) ?? null
      },
      async all<T>() {
        return {
          success: true,
          results: db.prepare(sql).all(...params) as T[],
          meta: { changes: 0 },
        }
      },
      async run() {
        const result = db.prepare(sql).run(...params)
        return { success: true, results: [], meta: { changes: Number(result.changes ?? 0) } }
      },
    }
  }

  return {
    prepare: (sql: string) => statement(sql),
    async batch(statements: { run(): Promise<unknown> }[]) {
      const out = []
      for (const item of statements) out.push(await item.run())
      return out
    },
    close() {
      db.close()
    },
  } as unknown as MemoryD1
}
