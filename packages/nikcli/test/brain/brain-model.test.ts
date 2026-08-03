import { preserveTestEnv } from "../helpers/env"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-brain-home-"))
process.env.NIKCLI_TEST_HOME = testHome
// Project config must be readable so the per-test `nikcli.json` is honoured.
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "0"
// Avoid hitting models.dev in unit tests; the test provider is local.
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

const { Instance } = await import("../../src/project/instance")
const { BRAIN_SESSION_TITLE, getBrainConfig, getBrainProviderModel } = await import("../../src/brain")

const projectDirs: string[] = []

async function withProject<T>(fn: (projectDir: string) => Promise<T>): Promise<T> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-brain-project-"))
  projectDirs.push(projectDir)
  return Instance.provide({
    directory: projectDir,
    fn: () => fn(projectDir),
  })
}

async function writeConfig(directory: string, value: Record<string, unknown>) {
  await Bun.write(path.join(directory, "nikcli.json"), JSON.stringify({ experimental: value }))
}

async function writeConfigWithProvider(directory: string, providerID: string, modelID: string, brainModel: string) {
  await Bun.write(
    path.join(directory, "nikcli.json"),
    JSON.stringify({
      experimental: { brainModel },
      provider: {
        [providerID]: {
          name: "Brain Test",
          api: "https://example.invalid/v1",
          npm: "@ai-sdk/openai-compatible",
          models: {
            [modelID]: {
              id: modelID,
              name: modelID,
              release_date: "2026-01-01",
              limit: { context: 1024, output: 128 },
              cost: { input: 0, output: 0 },
            },
          },
        },
      },
    }),
  )
}

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("Brain config brainModel", () => {
  it("returns undefined when no brainModel is configured", async () => {
    await withProject(async () => {
      const cfg = await getBrainConfig()
      expect(cfg.model).toBeUndefined()
    })
  })

  it("parses a valid provider/model string", async () => {
    await withProject(async (projectDir) => {
      await writeConfig(projectDir, {
        brainModel: "anthropic/claude-sonnet-4-5",
      })
      const cfg = await getBrainConfig()
      expect(cfg.model).toEqual({
        providerID: "anthropic",
        modelID: "claude-sonnet-4-5",
      })
    })
  })

  it("trims whitespace around the model string", async () => {
    await withProject(async (projectDir) => {
      await writeConfig(projectDir, { brainModel: "  openai/gpt-4o  " })
      const cfg = await getBrainConfig()
      expect(cfg.model).toEqual({ providerID: "openai", modelID: "gpt-4o" })
    })
  })

  it("ignores malformed values (no slash)", async () => {
    await withProject(async (projectDir) => {
      await writeConfig(projectDir, { brainModel: "no-slash-here" })
      const cfg = await getBrainConfig()
      expect(cfg.model).toBeUndefined()
    })
  })

  it("ignores empty values", async () => {
    await withProject(async (projectDir) => {
      await writeConfig(projectDir, { brainModel: "" })
      const cfg = await getBrainConfig()
      expect(cfg.model).toBeUndefined()
    })
  })

  it("ignores values with empty provider or model segments", async () => {
    await withProject(async (projectDir) => {
      await writeConfig(projectDir, { brainModel: "/missing-provider" })
      let cfg = await getBrainConfig()
      expect(cfg.model).toBeUndefined()

      await writeConfig(projectDir, { brainModel: "missing-model/" })
      cfg = await getBrainConfig()
      expect(cfg.model).toBeUndefined()
    })
  })

  it("rejects non-string brainModel values via the config schema", async () => {
    await withProject(async (projectDir) => {
      await writeConfig(projectDir, { brainModel: 42 })
      // The Zod schema (z.string().optional()) validates the type before
      // parseBrainModel ever runs, so a bad type surfaces as a config error.
      await expect(getBrainConfig()).rejects.toThrow()
    })
  })
})

describe("Brain module exports", () => {
  it("exposes the memory consolidation title used for sessions", () => {
    expect(BRAIN_SESSION_TITLE).toBe("Brain: Memory Consolidation")
  })
})

describe("getBrainProviderModel resolution", () => {
  it("uses the configured model when the provider/model pair is known", async () => {
    await withProject(async (projectDir) => {
      await writeConfigWithProvider(projectDir, "brain-test", "known-model", "brain-test/known-model")

      const model = await getBrainProviderModel()
      expect(model).toEqual({
        providerID: "brain-test",
        modelID: "known-model",
      })
    })
  })

  it("falls back to a default model when the configured model cannot be resolved", async () => {
    await withProject(async (projectDir) => {
      await writeConfig(projectDir, {
        brainModel: "no-such-provider/no-such-model",
      })

      const model = await getBrainProviderModel()
      // We expect fallback to a valid model, not the bogus one we asked for.
      expect(model).not.toEqual({
        providerID: "no-such-provider",
        modelID: "no-such-model",
      })
      expect(typeof model.providerID).toBe("string")
      expect(typeof model.modelID).toBe("string")
    })
  })

  it("returns a default-model-shaped object when no brainModel is configured", async () => {
    await withProject(async () => {
      const model = await getBrainProviderModel()
      expect(typeof model.providerID).toBe("string")
      expect(typeof model.modelID).toBe("string")
    })
  })
})
