import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect, Schema } from "effect"
import { OpenApi } from "effect/unstable/httpapi"
import baseline from "../../../sdk/openapi.json"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-openapi-components-home-"))
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-openapi-components-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

/**
 * SDK-flip gate: Effect PublicApi must emit the named domain components that
 * `@nikcli-ai/plugin` and the hey-api SDK re-export. Opaque Schema.Unknown
 * collapses these into empty/anonymous schemas and drops the public types.
 */
describe("Effect PublicApi OpenAPI components", () => {
  it(
    "preserves the SDK baseline paths and operation IDs",
    async () => {
      const { PublicApi } = await import("@/server/httpapi/public")
      const current = OpenApi.fromApi(PublicApi) as Record<string, any>
      const methods = ["get", "post", "put", "delete", "patch"] as const
      const contracts = (spec: Record<string, any>) =>
        new Map(
          Object.entries((spec.paths ?? {}) as Record<string, any>).flatMap(([path, item]) =>
            methods.flatMap((method) => {
              const operation = item?.[method]
              if (!operation) return []
              return [
                [
                  `${method.toUpperCase()} ${path}`,
                  {
                    operationId: operation.operationId,
                    statuses: Object.keys(operation.responses ?? {}).sort(),
                  },
                ] as const,
              ]
            }),
          ),
        )

      const expected = contracts(baseline as Record<string, any>)
      const actual = contracts(current)
      const missing = [...expected].flatMap(([key, contract]) => {
        const emitted = actual.get(key)
        if (!emitted) return [`missing contract: ${key}`]
        if (emitted.operationId !== contract.operationId)
          return [`operationId mismatch: ${key}: ${String(contract.operationId)} != ${String(emitted.operationId)}`]
        return []
      })

      expect(missing).toEqual([])
    },
    { timeout: 60_000 },
  )

  it(
    "emits the named domain components required by the SDK",
    async () => {
      const { PublicApi } = await import("@/server/httpapi/public")
      const spec = OpenApi.fromApi(PublicApi) as {
        components?: { schemas?: Record<string, unknown> }
      }
      const schemas = spec.components?.schemas ?? {}
      const required = [
        "Event",
        "Session",
        "Message",
        "UserMessage",
        "AssistantMessage",
        "Part",
        "Todo",
        "Model",
        "SessionStatus",
      ] as const

      for (const name of required) {
        expect(schemas[name], `missing OpenAPI component: ${name}`).toBeDefined()
        const schema = schemas[name] as Record<string, unknown> | undefined
        // Must not be a bare empty/unknown placeholder.
        expect(schema && Object.keys(schema).length > 0, `${name} is empty`).toBe(true)
      }
    },
    { timeout: 60_000 },
  )

  it(
    "encodes every model from Provider.list with Provider.ModelSchema",
    async () => {
      const directory = await makeProjectDir()
      // Seed a custom provider without api.url — the historical failure mode
      // that forced ConfigHttpApi to keep a looser Model schema.
      await Bun.write(
        path.join(directory, "nikcli.json"),
        JSON.stringify(
          {
            provider: {
              "custom-no-url": {
                name: "Custom No URL",
                npm: "@ai-sdk/openai-compatible",
                models: {
                  "probe-model": {
                    name: "Probe Model",
                    release_date: "2026-01-01",
                    limit: { context: 1024, output: 128 },
                    cost: { input: 0, output: 0 },
                  },
                },
              },
            },
          },
          null,
          2,
        ),
      )

      const providers = await Effect.runPromise(
        InstanceScope.with(
          { directory },
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            return yield* provider.list()
          }).pipe(Effect.provide(Provider.defaultLayer)),
        ),
      )

      const models = Object.values(providers).flatMap((provider) => Object.values(provider.models))
      expect(models.length).toBeGreaterThan(0)
      expect(providers["custom-no-url"]?.models["probe-model"]).toBeDefined()
      // api.url may be missing/undefined for config-only custom providers.
      const probe = providers["custom-no-url"]!.models["probe-model"]!
      expect(probe.api.url === undefined || typeof probe.api.url === "string").toBe(true)

      const failures: string[] = []
      for (const model of models) {
        try {
          const encoded = Schema.encodeUnknownSync(Provider.ModelSchema)(model)
          Schema.decodeUnknownSync(Provider.ModelSchema)(encoded)
        } catch (error) {
          failures.push(`${model.providerID}/${model.id}: ${String(error)}`)
        }
      }
      expect(failures, failures.join("\n")).toEqual([])
    },
    { timeout: 30_000 },
  )
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => removeTestDir(dir)))
  await removeTestDir(testHome)
})
