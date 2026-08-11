import { preserveTestEnv } from "../helpers/env"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-file-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])

const { InstanceScope } = await import("@/effect")
const { File } = await import("@/file")
const { Instance } = await import("@/project/instance")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-file-effect-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

describe("File.Service", () => {
  it("reads, lists, searches, and reports status through the Effect service boundary", async () => {
    const directory = await makeProjectDir()
    await fs.mkdir(path.join(directory, "src"), { recursive: true })
    await fs.writeFile(path.join(directory, "src", "index.ts"), "export const value = 1\n", "utf8")

    const result = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const file = yield* File.Service
          yield* file.init()
          const content = yield* file.read("src/index.ts")
          const listing = yield* file.list("src")
          const search = yield* file.search({ query: "index", type: "file", limit: 5 })
          const status = yield* file.status()
          return { content, listing, search, status }
        }).pipe(Effect.provide(File.defaultLayer)),
      ),
    )

    expect(result.content.content).toBe("export const value = 1")
    // Listing entries carry native separators, so the literal has to be built
    // rather than written with a slash.
    expect(result.listing.map((item) => item.path)).toContain(path.join("src", "index.ts"))
    expect(Array.isArray(result.search)).toBe(true)
    expect(result.status).toEqual([])
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})
