import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Database } from "@/database/database"
import { withIsolatedDatabase } from "./sqlite"

describe("withIsolatedDatabase", () => {
  test("sets NIKCLI_TEST_HOME to a unique temp dir", async () => {
    await withIsolatedDatabase(async (ctx) => {
      expect(ctx.home).toBeTruthy()
      expect(ctx.home.startsWith(os.tmpdir())).toBe(true)
      expect(process.env.NIKCLI_TEST_HOME).toBe(ctx.home)
    })
  })

  test("provides a databasePath inside the home", async () => {
    await withIsolatedDatabase(async (ctx) => {
      expect(ctx.databasePath).toContain(ctx.home)
      expect(ctx.databasePath).toContain("nikcli.db")
    })
  })

  test("creates a fresh temp dir per call", async () => {
    const homes: string[] = []
    await withIsolatedDatabase(async (ctx) => {
      homes.push(ctx.home)
    })
    await withIsolatedDatabase(async (ctx) => {
      homes.push(ctx.home)
    })
    expect(homes[0]).not.toBe(homes[1])
  })

  test("closes the database before removing its temp directory", async () => {
    let databasePath = ""
    await withIsolatedDatabase(async (ctx) => {
      databasePath = ctx.databasePath
      Database.syncNative().exec("CREATE TABLE lifecycle_test (id INTEGER PRIMARY KEY)")
      expect(Database.isOpen(databasePath)).toBe(true)
    })
    expect(Database.isOpen(databasePath)).toBe(false)
    await expect(fs.access(databasePath)).rejects.toThrow()
  })

  test("isolates sequential database homes without reusing a closed handle", async () => {
    const paths: string[] = []
    for (let index = 0; index < 2; index++) {
      await withIsolatedDatabase(async (ctx) => {
        paths.push(ctx.databasePath)
        Database.syncNative().exec(`CREATE TABLE lifecycle_${index} (id INTEGER PRIMARY KEY)`)
      })
    }
    expect(paths[0]).not.toBe(paths[1])
    expect(paths.every((item) => !Database.isOpen(item))).toBe(true)
  })

  test("restores the previous environment after the fn returns", async () => {
    const previous = "/some/previous/path"
    process.env.NIKCLI_TEST_HOME = previous
    await withIsolatedDatabase(async () => {
      // Inside the closure, the env is the isolated home.
      expect(process.env.NIKCLI_TEST_HOME).not.toBe(previous)
    })
    expect(process.env.NIKCLI_TEST_HOME).toBe(previous)
    delete process.env.NIKCLI_TEST_HOME
  })

  test("cleans up the temp directory after the fn returns", async () => {
    let capturedHome: string | undefined
    await withIsolatedDatabase(async (ctx) => {
      capturedHome = ctx.home
      await fs.writeFile(path.join(ctx.home, "sentinel.txt"), "ok")
    })
    expect(capturedHome).toBeDefined()
    // The directory should be gone (or at least the sentinel removed).
    await expect(fs.readFile(path.join(capturedHome!, "sentinel.txt"))).rejects.toThrow()
  })

  test("skip: true uses the existing environment", async () => {
    delete process.env.NIKCLI_TEST_HOME
    await withIsolatedDatabase(
      async (ctx) => {
        expect(ctx.home).toBe("")
        expect(process.env.NIKCLI_TEST_HOME).toBeUndefined()
      },
      { skip: true },
    )
  })
})

import os from "os"
