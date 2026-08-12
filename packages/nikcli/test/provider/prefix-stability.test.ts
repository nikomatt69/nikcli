import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

// `cache-diagnostics.test.ts` covers the comparator against synthetic snapshots.
// This covers the property the comparator exists to watch: that the request
// prefix nikcli actually builds is byte-identical between two calls.
//
// A prompt cache matches on the longest identical prefix, and the prefix renders
// tools -> system -> messages, so anything volatile above the last breakpoint
// invalidates everything after it. The failure is silent — the token counts shift
// and the response says nothing — which is exactly the kind of regression that
// survives review. Interpolating a clock, a UUID, a `git status`, or a
// nondeterministically ordered map anywhere in this path fails here instead.

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-prefix-stability-home-"))
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
const { Agent } = await import("@/agent/agent")
const { CacheDiagnostics } = await import("@/provider/cache-diagnostics")
const { SystemPrompt } = await import("@/session/system")
const z = await import("zod")

const model = { providerID: "anthropic", modelID: "claude-sonnet-4-5" }
const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-prefix-stability-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

/** The tool array as the model sees it: name, description and rendered schema. */
async function buildTools(directory: string) {
  return await Effect.runPromise(
    InstanceScope.with(
      { directory },
      Effect.gen(function* () {
        const agentSvc = yield* Agent.Service
        const agents = yield* agentSvc.list()
        const agent = agents.find((candidate) => candidate.name === "build") ?? agents[0]
        const registry = yield* ToolRegistry.Service
        const tools = yield* registry.tools(model, agent)
        return tools.map((tool) => ({
          name: tool.id,
          description: tool.description,
          inputSchema: (z as unknown as { toJSONSchema(v: unknown): unknown }).toJSONSchema(tool.parameters),
        }))
      }).pipe(Effect.provide(ToolRegistry.defaultLayer), Effect.provide(Agent.defaultLayer)),
    ),
  )
}

/** The parts that make up the system block, which renders straight after the tools. */
async function buildSystem(directory: string) {
  return await Effect.runPromise(
    InstanceScope.with(
      { directory },
      Effect.gen(function* () {
        const prompt = yield* SystemPrompt.Service
        return {
          environment: yield* prompt.environment(),
          custom: yield* prompt.custom(),
          skills: yield* prompt.skills(),
        }
      }).pipe(Effect.provide(SystemPrompt.defaultLayer)),
    ),
  )
}

describe("request prefix stability", () => {
  it("builds a byte-identical tool array twice", async () => {
    const directory = await makeProjectDir()
    const first = await buildTools(directory)
    const second = await buildTools(directory)

    // Compared through the same comparator the runtime diagnostics use, so a
    // failure here reads the same way as a failure in a live session.
    const comparison = CacheDiagnostics.compare(
      CacheDiagnostics.snapshot({ prompt: [], tools: first, settings: model }),
      CacheDiagnostics.snapshot({ prompt: [], tools: second, settings: model }),
    )

    expect(comparison.status).toBe("stable")
  })

  it("orders tools deterministically", async () => {
    const directory = await makeProjectDir()
    const first = await buildTools(directory)
    const second = await buildTools(directory)

    // Ordering is checked separately from content: the tool array renders at
    // position 0, so a reshuffle invalidates the whole request even when every
    // individual definition is unchanged.
    expect(second.map((tool) => tool.name)).toEqual(first.map((tool) => tool.name))
  })

  it("names the tool whose bytes moved, rather than only failing", async () => {
    const directory = await makeProjectDir()
    const tools = await buildTools(directory)
    const drifted = tools.map((tool, index) =>
      index === 1 ? { ...tool, description: `${tool.description} (drifted)` } : tool,
    )

    const comparison = CacheDiagnostics.compare(
      CacheDiagnostics.snapshot({ prompt: [], tools, settings: model }),
      CacheDiagnostics.snapshot({ prompt: [], tools: drifted, settings: model }),
    )

    expect(comparison).toMatchObject({ status: "changed", component: "tools", label: tools[1]!.name })
  })

  it("builds byte-identical system parts twice", async () => {
    const directory = await makeProjectDir()
    const first = await buildSystem(directory)
    const second = await buildSystem(directory)

    // Named individually so a failure says which part drifted. `environment`
    // carries the <env> block, which is where a clock or a shell-out would land.
    expect(second.environment).toEqual(first.environment)
    expect(second.custom).toEqual(first.custom)
    expect(second.skills).toEqual(first.skills)
  })
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => removeTestDir(dir)))
  await removeTestDir(testHome)
})
