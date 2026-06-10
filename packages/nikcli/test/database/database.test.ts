import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, describe, expect, it } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { account } from "@/database/schema"
import { Database } from "@/database/database"
import { runPromiseWithLayer } from "@/effect"

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-database-home-"))
const dbPath = path.join(testDir, "nikcli.db")

function runDatabase<A, E>(effect: Effect.Effect<A, E, Database.Service>) {
  return runPromiseWithLayer(Database.layerFromPath(dbPath), effect)
}

afterAll(async () => {
  await fs.rm(testDir, { recursive: true, force: true })
})

describe("Database.Service", () => {
  it("opens SQLite with PRAGMAs and applies the migration journal", async () => {
    const result = await runDatabase(
      Effect.gen(function* () {
        const database = yield* Database.Service
        const foreignKeys = database.native.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()
        const journal = database.native.query<{ id: string }, []>("SELECT id FROM migration ORDER BY id").all()
        const tables = database.native
          .query<
            { name: string },
            []
          >("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('account', 'users', 'mobile_tokens', 'workspace') ORDER BY name")
          .all()
        return { foreignKeys, journal, tables }
      }),
    )

    expect(result.foreignKeys?.foreign_keys).toBe(1)
    expect(result.journal).toEqual([{ id: "20260610211500_initial" }])
    expect(result.tables.map((table) => table.name)).toEqual(["account", "mobile_tokens", "users", "workspace"])
  })

  it("runs Drizzle queries through the central database service", async () => {
    const row = await runDatabase(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        const now = Date.now()
        db.insert(account)
          .values({
            id: "acct_database_test",
            email: "database@example.com",
            url: "https://example.com",
            accessToken: "access-token",
            refreshToken: "refresh-token",
            tokenExpiry: now + 60_000,
            createdAt: now,
            updatedAt: now,
          })
          .run()
        return db.select().from(account).where(eq(account.id, "acct_database_test")).get()
      }),
    )

    expect(row?.email).toBe("database@example.com")
  })
})
