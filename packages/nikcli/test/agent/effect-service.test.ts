import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { runPromiseWithLayer, withCurrentInstance } from "../../src/effect"
import { Instance } from "../../src/project/instance"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-agent-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

const { Agent } = await import("../../src/agent/agent")

const projectDirs: string[] = []

async function withProject<T>(fn: (projectDir: string) => Promise<T>): Promise<T> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-agent-project-"))
  projectDirs.push(projectDir)
  return Instance.provide({
    directory: projectDir,
    fn: () => fn(projectDir),
  })
}

function runAgent<A, E>(effect: Effect.Effect<A, E, any>) {
  return runPromiseWithLayer(Agent.defaultLayer, withCurrentInstance(effect))
}

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("Agent.Service", () => {
  it("loads built-in agents through the Effect instance context", async () => {
    await withProject(async () => {
      const result = await runAgent(
        Effect.gen(function* () {
          const agent = yield* Agent.Service
          const list = yield* agent.list()
          const build = yield* agent.get("build")
          const defaultAgent = yield* agent.defaultAgent()
          return { list, build, defaultAgent }
        }),
      )

      expect(result.list.map((agent) => agent.name)).toContain("build")
      expect(result.list.map((agent) => agent.name)).toContain("general")
      expect(result.build?.mode).toBe("primary")
      expect(result.defaultAgent).toBe("build")
    })
  })
})
