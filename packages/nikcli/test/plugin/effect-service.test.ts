import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { Plugin } from "@/plugin"
import { Instance } from "@/project/instance"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-plugin-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

const projectDirs: string[] = []

async function withProject<T>(fn: () => Promise<T>): Promise<T> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-plugin-effect-project-"))
  projectDirs.push(projectDir)
  return Instance.provide({
    directory: projectDir,
    fn,
  })
}

function runPlugin<A, E>(effect: Effect.Effect<A, E, Plugin.Service>) {
  return runPromiseWithLayer(Plugin.defaultLayer, withCurrentInstance(effect))
}

afterAll(async () => {
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("Plugin.Service", () => {
  it("loads built-in plugins and runs hooks through the Effect service boundary", async () => {
    await withProject(async () => {
      const result = await runPlugin(
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const hooks = yield* plugin.list()
          const output = { system: ["base"] }
          const transformed = yield* plugin.trigger(
            "experimental.chat.system.transform",
            { sessionID: "ses_plugin_effect" },
            output,
          )
          yield* plugin.init()
          yield* plugin.init()
          return { hooks, transformed }
        }),
      )

      expect(result.hooks.length).toBeGreaterThan(0)
      expect(result.transformed.system).toEqual(["base"])
    })
  })
})
