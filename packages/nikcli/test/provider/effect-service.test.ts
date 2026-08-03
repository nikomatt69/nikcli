import { preserveTestEnv } from "../helpers/env"
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

async function writeOpenAIProjectConfig(directory: string, options: Record<string, unknown> = {}) {
  await Bun.write(
    path.join(directory, "nikcli.json"),
    JSON.stringify(
      {
        provider: {
          openai: {
            name: "OpenAI",
            env: ["OPENAI_API_KEY"],
            api: "https://api.openai.com/v1",
            npm: "@ai-sdk/openai",
            options,
            models: {
              "gpt-test": {
                id: "gpt-test",
                name: "GPT Test",
                release_date: "2026-01-01",
                limit: { context: 1024, output: 128 },
                cost: { input: 0, output: 0 },
              },
            },
          },
        },
        model: "openai/gpt-test",
      },
      null,
      2,
    ),
  )
}

async function writeXAIProjectConfig(directory: string) {
  await Bun.write(
    path.join(directory, "nikcli.json"),
    JSON.stringify(
      {
        provider: {
          xai: {
            name: "xAI",
            api: "https://api.x.ai/v1",
            npm: "@ai-sdk/xai",
            models: {
              "grok-test": {
                id: "grok-test",
                name: "Grok Test",
                release_date: "2026-01-01",
                limit: { context: 1024, output: 128 },
                cost: { input: 0, output: 0 },
              },
            },
          },
        },
        model: "xai/grok-test",
      },
      null,
      2,
    ),
  )
}

async function writeAuthStore(auth: Record<string, unknown>) {
  const authPath = path.join(testHome, "data", "auth.json")
  await fs.mkdir(path.dirname(authPath), { recursive: true })
  await Bun.write(authPath, JSON.stringify(auth, null, 2))
}

async function withOpenAIKey<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = "sk-test"
  try {
    return await fn()
  } finally {
    if (previous === undefined) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = previous
    }
  }
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

  it("uses a generous OpenAI response header timeout by default", async () => {
    const directory = await makeProjectDir()
    await writeOpenAIProjectConfig(directory)

    await withOpenAIKey(async () => {
      const providerInfo = await Effect.runPromise(
        InstanceScope.with(
          { directory },
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            return yield* provider.getProvider("openai")
          }).pipe(Effect.provide(Provider.defaultLayer)),
        ),
      )

      expect(providerInfo?.options.headerTimeout).toBe(120_000)
    })
  })

  it("lets config override the OpenAI response header timeout", async () => {
    const directory = await makeProjectDir()
    await writeOpenAIProjectConfig(directory, { headerTimeout: 120_000 })

    await withOpenAIKey(async () => {
      const providerInfo = await Effect.runPromise(
        InstanceScope.with(
          { directory },
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            return yield* provider.getProvider("openai")
          }).pipe(Effect.provide(Provider.defaultLayer)),
        ),
      )

      expect(providerInfo?.options.headerTimeout).toBe(120_000)
    })
  })

  it("uses xAI Responses API for OAuth plugin auth", async () => {
    const directory = await makeProjectDir()
    await writeXAIProjectConfig(directory)
    await writeAuthStore({
      xai: {
        type: "oauth",
        refresh: "refresh-token",
        access: "access-token",
        expires: Date.now() + 60_000,
      },
    })

    const language = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const model = yield* provider.getModel("xai", "grok-test")
          return yield* provider.getLanguage(model)
        }).pipe(Effect.provide(Provider.defaultLayer)),
      ),
    )

    expect(language.provider).toBe("xai.responses")
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await fs.rm(path.join(testHome, "data", "auth.json"), { force: true })
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})
