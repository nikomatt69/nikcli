import { preserveTestEnv } from "../helpers/env"
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

preserveTestEnv([
  "NIKCLI_TEST_HOME",
  "NIKCLI_DISABLE_PROJECT_CONFIG",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
])

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
    expect(ids).toContain("create_goal")
    expect(ids).toContain("get_goal")
    expect(ids).toContain("update_goal")
    expect(ids).toContain("browser_control")
    expect(ids).toContain("computer")
    expect(ids).toContain("multiedit")
    expect(ids).toContain("voice")
  })

  it("offers the string-replace edit family and apply_patch as alternatives, never both", async () => {
    const directory = await makeProjectDir()
    const resolve = (modelID: string) =>
      Effect.runPromise(
        InstanceScope.with(
          { directory },
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            return yield* registry.tools({ providerID: "openai", modelID })
          }).pipe(Effect.provide(ToolRegistry.defaultLayer)),
        ),
      ).then((tools) => new Set(tools.map((tool) => tool.id)))

    const gpt = await resolve("gpt-5")
    expect(gpt.has("apply_patch")).toBe(true)
    for (const id of ["edit", "write", "multiedit"]) expect(gpt.has(id)).toBe(false)

    const claude = await resolve("claude-opus-5")
    expect(claude.has("apply_patch")).toBe(false)
    for (const id of ["edit", "write", "multiedit"]) expect(claude.has(id)).toBe(true)
  })

  it("resolves tool definitions and honours exclude", async () => {
    const directory = await makeProjectDir()
    const resolve = (options?: { exclude?: ReadonlySet<string> }) =>
      Effect.runPromise(
        InstanceScope.with(
          { directory },
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            return yield* registry.tools({ providerID: "", modelID: "" }, undefined, options)
          }).pipe(Effect.provide(ToolRegistry.defaultLayer)),
        ),
      )

    const tools = await resolve()
    expect(tools.some((tool) => tool.id === "bash")).toBe(true)
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0)
    }

    // `exclude` is what keeps code_mode from bridging recursive/UI-only tools
    // into its own catalog.
    const trimmed = await resolve({ exclude: new Set(["bash"]) })
    expect(trimmed.some((tool) => tool.id === "bash")).toBe(false)
    expect(trimmed.length).toBe(tools.length - 1)
  })

  // The tool array is the first and largest component of the provider prompt-cache
  // prefix. Registration order varies with plugin load order and `register()` calls,
  // so an equivalent tool set has to serialize to identical bytes regardless.
  it("returns tools in canonical id order", async () => {
    const directory = await makeProjectDir()
    const tools = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          return yield* registry.tools({ providerID: "", modelID: "" })
        }).pipe(Effect.provide(ToolRegistry.defaultLayer)),
      ),
    )

    const ids = tools.map((tool) => tool.id)
    expect(ids).toEqual([...ids].sort(ToolRegistry.compareIds))
    expect(ids.length).toBeGreaterThan(1)
  })

  it("keeps opt-in tools out of a session that never asked for them", () => {
    // `opentui` stays registered — that is what lets `/usage` list it — but it
    // only reaches the model once the toggle has written an explicit `false`.
    // An absent entry is "never asked for", not "enabled".
    expect(ToolRegistry.OPT_IN.has("opentui")).toBe(true)
    expect(ToolRegistry.enabled("opentui", undefined)).toBe(false)
    expect(ToolRegistry.enabled("opentui", {})).toBe(false)
    expect(ToolRegistry.enabled("opentui", { opentui: true })).toBe(false)
    expect(ToolRegistry.enabled("opentui", { opentui: false })).toBe(true)

    // Every other tool keeps the plain meaning: on unless disabled.
    expect(ToolRegistry.enabled("bash", undefined)).toBe(true)
    expect(ToolRegistry.enabled("bash", { bash: false })).toBe(true)
    expect(ToolRegistry.enabled("bash", { bash: true })).toBe(false)
  })

  it("orders ids by code unit rather than host locale", () => {
    // `localeCompare` would sort "Zebra" after "apple" under most locales, making the
    // same tool set serialize differently on different machines.
    expect(["apple", "Zebra"].sort(ToolRegistry.compareIds)).toEqual(["Zebra", "apple"])
    expect(ToolRegistry.compareIds("bash", "bash")).toBe(0)
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
