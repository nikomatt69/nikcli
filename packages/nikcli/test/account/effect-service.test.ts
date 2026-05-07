import { afterAll, beforeEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-account-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome

const { Account } = await import("@/account")

function runAccount<A, E>(effect: Effect.Effect<A, E, any>) {
  return Effect.runPromise(effect.pipe(Effect.provide(Account.defaultLayer)) as Effect.Effect<A, E, never>)
}

describe("Account.Service", () => {
  beforeEach(async () => {
    await fs.rm(path.join(testHome, "data", "accounts.db"), { force: true })
    await fs.rm(path.join(testHome, "data", "accounts.db-shm"), { force: true })
    await fs.rm(path.join(testHome, "data", "accounts.db-wal"), { force: true })
    await fs.mkdir(path.join(testHome, "data"), { recursive: true })
  })

  it("provides local account operations through the Effect service boundary", async () => {
    const result = await runAccount(
      Effect.gen(function* () {
        const account = yield* Account.Service
        return {
          config: yield* account.config(),
          list: yield* account.list(),
          active: yield* account.active(),
          removed: yield* account.remove("account_missing"),
        }
      }),
    )

    expect(result.config.serverUrl).toContain("https://")
    expect(result.list).toEqual([])
    expect(result.active).toBeUndefined()
    expect(result.removed).toBe(false)
  })
})

afterAll(async () => {
  await fs.rm(testHome, { recursive: true, force: true })
})
