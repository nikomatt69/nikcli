import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-command-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.NIKCLI_DISABLE_EXTERNAL_SKILLS = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

const { InstanceScope } = await import("@/effect")
const { Command } = await import("@/command")
const { Instance } = await import("@/project/instance")
import { z } from "zod"
type CommandInfo = z.infer<typeof Command.Info>

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-command-effect-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

describe("Command.Service", () => {
  it("loads default commands through InstanceState context", async () => {
    const directory = await makeProjectDir()
    const result = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const command = yield* Command.Service
          const list = yield* command.list()
          const init = yield* command.get(Command.Default.INIT)
          return { list, init }
        }).pipe(Effect.provide(Command.defaultLayer)),
      ),
    )

    expect(result.list.map((command) => command.name)).toContain(Command.Default.INIT)
    expect(result.init?.description).toBe("create/update AGENTS.md")
    expect(await result.init?.template).toContain("$ARGUMENTS")
  })

  it("exposes aliases on the Command.Info shape (opencode #38080)", () => {
    // Runtime config injection is not portable across the test env, so we
    // verify the schema directly. The full-override branch in command/index.ts
    // copies `command.aliases` into Info.aliases; this test guards the schema.
    const sample = {
      name: "custom",
      template: "echo hi",
      aliases: ["c", "cx"],
      hints: [],
    }
    const parsed = Command.Info.parse(sample) as unknown as CommandInfo
    expect(parsed.aliases).toEqual(["c", "cx"])
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
