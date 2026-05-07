import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { runPromiseWithLayer, withCurrentInstance } from "../../src/effect"
import { Instance } from "../../src/project/instance"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-system-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_EXTERNAL_SKILLS = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

const { SystemPrompt } = await import("../../src/session/system")

const projectDirs: string[] = []

async function withProject<T>(fn: (projectDir: string) => Promise<T>): Promise<T> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-system-project-"))
  const resolved = await fs.realpath(projectDir)
  projectDirs.push(resolved)
  await fs.writeFile(path.join(projectDir, "AGENTS.md"), "Project instructions")
  return Instance.provide({
    directory: resolved,
    fn: () => fn(resolved),
  })
}

function runSystemPrompt<A, E>(effect: Effect.Effect<A, E, any>) {
  return runPromiseWithLayer(SystemPrompt.defaultLayer, withCurrentInstance(effect))
}

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("SystemPrompt.Service", () => {
  it("loads environment, custom instructions, and active skills through Effect context", async () => {
    await withProject(async (projectDir) => {
      const result = await runSystemPrompt(
        Effect.gen(function* () {
          const systemPrompt = yield* SystemPrompt.Service
          const environment = yield* systemPrompt.environment()
          const custom = yield* systemPrompt.custom()
          const skills = yield* systemPrompt.skills([])
          return { environment, custom, skills }
        }),
      )

      expect(result.environment[0]).toContain(`Working directory: ${projectDir}`)
      if (!process.env.NIKCLI_DISABLE_PROJECT_CONFIG) {
        expect(result.custom[0]).toContain("Instructions from:")
        expect(result.custom[0]).toContain("Project instructions")
      }
      expect(result.skills).toEqual([])
    })
  })
})
