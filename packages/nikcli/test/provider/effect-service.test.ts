import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-provider-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "0"
process.env.NIKCLI_DISABLE_MODELS_FETCH = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

const { InstanceScope } = await import("@/effect")
const { Instance } = await import("@/project/instance")
const { Provider } = await import("@/provider/provider")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-provider-effect-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

async function writeProjectConfig(directory: string) {
  await Bun.write(
    path.join(directory, "nikcli.json"),
    JSON.stringify(
      {
        provider: {
          "effect-test": {
            name: "Effect Test",
            api: "https://example.invalid/v1",
            npm: "@ai-sdk/openai-compatible",
            models: {
              "effect-model": {
                id: "effect-model-api",
                name: "Effect Model",
                release_date: "2026-01-01",
                limit: { context: 1024, output: 128 },
                cost: { input: 0, output: 0 },
              },
            },
          },
        },
        model: "effect-test/effect-model",
      },
      null,
      2,
    ),
  )
}

describe("Provider.Service", () => {
  it("loads configured providers and resolves models through the Effect boundary", async () => {
    const directory = await makeProjectDir()
    await writeProjectConfig(directory)

    const result = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const providers = yield* provider.list()
          const model = yield* provider.getModel("effect-test", "effect-model")
          const defaultModel = yield* provider.defaultModel()
          return { providers, model, defaultModel }
        }).pipe(Effect.provide(Provider.defaultLayer)),
      ),
    )

    expect(result.providers["effect-test"]?.name).toBe("Effect Test")
    expect(result.model.api.id).toBe("effect-model-api")
    expect(result.defaultModel).toEqual({ providerID: "effect-test", modelID: "effect-model" })
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
