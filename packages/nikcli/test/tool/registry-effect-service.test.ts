import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-tool-registry-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

const { InstanceScope } = await import("@/effect")
const { Instance } = await import("@/project/instance")
const { ToolRegistry } = await import("@/tool/registry")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-tool-registry-effect-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

describe("ToolRegistry.Service", () => {
  it("lists built-in tool ids through InstanceState context", async () => {
    const directory = await makeProjectDir()
    const ids = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          return yield* registry.ids()
        }).pipe(Effect.provide(ToolRegistry.defaultLayer)),
      ),
    )

    expect(ids).toContain("bash")
    expect(ids).toContain("read")
  })

  it("resolves slim tool definitions", async () => {
    const directory = await makeProjectDir()
    const tools = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          return yield* registry.tools({ providerID: "", modelID: "" }, undefined, { slim: true })
        }).pipe(Effect.provide(ToolRegistry.defaultLayer)),
      ),
    )

    expect(tools.some((tool) => tool.id === "bash")).toBe(true)
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0)
    }
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
