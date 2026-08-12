import { preserveTestEnv } from "../helpers/env"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-profile-prompt-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.NIKCLI_DISABLE_MODELS_FETCH = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "NIKCLI_DISABLE_MODELS_FETCH",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])

const { InstanceScope } = await import("@/effect")
const { Instance } = await import("@/project/instance")
const { Profile } = await import("@/profile")
const { SystemPrompt } = await import("@/session/system")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-profile-prompt-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

/** What a session would actually send, resolved the way `SessionPrompt` does. */
function promptProfile(directory: string) {
  return Effect.runPromise(
    InstanceScope.with(
      { directory },
      Effect.gen(function* () {
        const system = yield* SystemPrompt.Service
        return yield* system.profile()
      }).pipe(Effect.provide(SystemPrompt.defaultLayer)) as Effect.Effect<string[], unknown>,
    ),
  )
}

describe("SystemPrompt.profile", () => {
  it("is empty for a user who never personalized anything", async () => {
    const directory = await makeProjectDir()
    expect(await promptProfile(directory)).toEqual([])
  })

  it("carries the declared profile and the project's learned habits into the prompt", async () => {
    const directory = await makeProjectDir()
    await Effect.runPromise(
      Effect.gen(function* () {
        const profile = yield* Profile.Service
        yield* profile.save({ name: "Nik", conventions: ["always bun, never npm"] })
      }).pipe(Effect.provide(Profile.defaultLayer)) as Effect.Effect<void, unknown>,
    )
    const habits = Profile.habitsFile(directory)
    await fs.mkdir(path.dirname(habits), { recursive: true })
    await fs.writeFile(habits, "# User habits\n\n- runs typecheck through the monitor tool\n", "utf8")

    const parts = await promptProfile(directory)
    const text = parts.join("\n")

    expect(text).toContain("Name: Nik")
    expect(text).toContain("always bun, never npm")
    expect(text).toContain("runs typecheck through the monitor tool")
  })
})

afterEach(async () => {
  await fs.rm(Profile.directory(), { recursive: true, force: true })
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})
