import { preserveTestEnv } from "../helpers/env"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-config-effect-home-"))
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
const { Config } = await import("@/config/config")
const { Global } = await import("@nikcli-ai/util/global")
const { Instance } = await import("@/project/instance")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-config-effect-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

describe("Config.Service", () => {
  it("loads instance config and directories through the Effect boundary", async () => {
    const directory = await makeProjectDir()
    const result = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const config = yield* Config.Service
          return {
            config: yield* config.get(),
            directories: yield* config.directories(),
          }
        }).pipe(Effect.provide(Config.defaultLayer)),
      ),
    )

    expect(result.config.plugin).toEqual([])
    expect(result.config.username).toBeTruthy()
    expect(result.directories).toContain(Global.Path.config)
  })

  it("updates and reloads global config through the Effect boundary", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* Config.Service
        yield* config.updateGlobal({ theme: "effect-config-test" })
        return yield* config.getGlobal()
      }).pipe(Effect.provide(Config.defaultLayer)),
    )

    expect(result.theme).toBe("effect-config-test")
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

// Windows keeps a handle on files under the test home for a moment after the
// instances are disposed, and `force` only swallows ENOENT — an EBUSY still
// rejects and fails the suite. Retry, then give up quietly: this is teardown of
// a temp directory, not an assertion.
const rmTemp = (dir: string) =>
  fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined)

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map(rmTemp))
  await rmTemp(testHome)
})
