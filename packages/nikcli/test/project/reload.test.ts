import { preserveTestEnv } from "../helpers/env"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-reload-home-"))
process.env.NIKCLI_TEST_HOME = testHome

preserveTestEnv(["NIKCLI_TEST_HOME"])

const { InstanceScope, InstanceState, locallyInstance } = await import("@/effect")
const { Instance } = await import("@/project/instance")
const { InstanceReload } = await import("@/project/reload")
const { Bus } = await import("@/bus")
const { Agent } = await import("@/agent/agent")
const { Command } = await import("@/command")
const { ToolRegistry } = await import("@/tool/registry")
const { Tool } = await import("@/tool/tool")
const z = (await import("zod")).default

afterAll(async () => {
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("InstanceState hot reload", () => {
  it("rebuilds reloadable caches on invalidate and leaves others untouched", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-reload-state-"))

    try {
      const result = await Effect.runPromise(
        locallyInstance(
          // SAFETY: the reload path reads only `project.id` off the instance
          // context.
          { directory, worktree: directory, project: { id: "test" } as any },
          Effect.scoped(
            Effect.gen(function* () {
              let reloadableBuilds = 0
              let stableBuilds = 0
              const reloadableCache = yield* InstanceState.make(
                () => Effect.sync(() => ({ build: ++reloadableBuilds })),
                { reloadable: true },
              )
              const stableCache = yield* InstanceState.make(() => Effect.sync(() => ({ build: ++stableBuilds })))

              const first = yield* InstanceState.get(reloadableCache)
              const cached = yield* InstanceState.get(reloadableCache)
              yield* InstanceState.get(stableCache)

              yield* InstanceState.invalidateReloadable(directory)

              const rebuilt = yield* InstanceState.get(reloadableCache)
              const stable = yield* InstanceState.get(stableCache)

              return {
                first: first.build,
                cached: cached.build,
                rebuilt: rebuilt.build,
                stable: stable.build,
              }
            }),
          ),
        ),
      )

      expect(result.first).toBe(1)
      expect(result.cached).toBe(1)
      expect(result.rebuilt).toBe(2)
      expect(result.stable).toBe(1)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})

// The mechanism test above proves `invalidateReloadable` rebuilds an opted-in
// cache. These prove the services users actually edit are opted in: without the
// flag both reads below return the pre-reload config, so a hot reload announces
// itself on the bus while the command/agent registry stays stale until restart.
describe("config-derived services join hot reload", () => {
  // These read a project-level nikcli.json, and `bun test` shares one process
  // across files — several of which disable project config at import time. The
  // flag is a live getter, so set it for the duration of each test and put it
  // back so the leak does not travel in the other direction either.
  let previousProjectConfig: string | undefined
  beforeEach(() => {
    previousProjectConfig = process.env["NIKCLI_DISABLE_PROJECT_CONFIG"]
    delete process.env["NIKCLI_DISABLE_PROJECT_CONFIG"]
  })
  afterEach(() => {
    if (previousProjectConfig === undefined) delete process.env["NIKCLI_DISABLE_PROJECT_CONFIG"]
    else process.env["NIKCLI_DISABLE_PROJECT_CONFIG"] = previousProjectConfig
  })

  it("rebuilds the command registry after a config change", async () => {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-reload-command-")))
    const configPath = path.join(directory, "nikcli.json")
    const writeCommand = (name: string) =>
      fs.writeFile(configPath, JSON.stringify({ command: { [name]: { template: "do $ARGUMENTS" } } }))

    try {
      await writeCommand("alpha")

      const result = await Effect.runPromise(
        InstanceScope.with(
          { directory },
          Effect.gen(function* () {
            const command = yield* Command.Service
            const before = (yield* command.list()).map((entry) => entry.name)

            yield* Effect.promise(() => writeCommand("beta"))
            yield* InstanceState.invalidateReloadable(directory)

            const after = (yield* command.list()).map((entry) => entry.name)
            return { before, after }
          }).pipe(Effect.provide(Command.defaultLayer)),
        ),
      )

      expect(result.before).toContain("alpha")
      expect(result.before).not.toContain("beta")
      expect(result.after).toContain("beta")
      expect(result.after).not.toContain("alpha")
    } finally {
      await Instance.provide({ directory, fn: () => Instance.dispose() })
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it("rebuilds the agent registry after a config change", async () => {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-reload-agent-")))
    const configPath = path.join(directory, "nikcli.json")
    const writeAgent = (name: string) =>
      fs.writeFile(
        configPath,
        JSON.stringify({
          agent: {
            [name]: { description: `${name} agent`, prompt: "be useful" },
          },
        }),
      )

    try {
      await writeAgent("alpha")

      const result = await Effect.runPromise(
        InstanceScope.with(
          { directory },
          Effect.gen(function* () {
            const agent = yield* Agent.Service
            const before = (yield* agent.list()).map((entry) => entry.name)

            yield* Effect.promise(() => writeAgent("beta"))
            yield* InstanceState.invalidateReloadable(directory)

            const after = (yield* agent.list()).map((entry) => entry.name)
            return { before, after }
          }).pipe(Effect.provide(Agent.defaultLayer)),
        ),
      )

      expect(result.before).toContain("alpha")
      expect(result.before).not.toContain("beta")
      expect(result.after).toContain("beta")
      expect(result.after).not.toContain("alpha")
    } finally {
      await Instance.provide({ directory, fn: () => Instance.dispose() })
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it("rebuilds config-dir tools after a reload without dropping runtime registrations", async () => {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-reload-tool-")))
    const configDir = path.join(directory, ".nikcli")
    const toolDir = path.join(configDir, "tool")
    const writeTool = async (name: string) => {
      await fs.writeFile(
        path.join(toolDir, `${name}.ts`),
        `export default {
  description: ${JSON.stringify(`${name} tool`)},
  args: {},
  async execute() { return ${JSON.stringify(name)} },
}
`,
      )
    }

    try {
      await fs.mkdir(toolDir, { recursive: true })
      await fs.writeFile(path.join(directory, "nikcli.json"), JSON.stringify({ tool: { allow: ["alpha", "beta"] } }))
      await writeTool("alpha")

      const sticky = Tool.define("sticky_runtime", {
        description: "runtime",
        parameters: z.object({}),
        async execute() {
          return { title: "", output: "ok", metadata: {} }
        },
      })

      const result = await Effect.runPromise(
        InstanceScope.with(
          { directory },
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            yield* registry.register(sticky)
            const before = yield* registry.ids()

            yield* Effect.promise(() => writeTool("beta"))
            yield* InstanceState.invalidateReloadable(directory)

            const after = yield* registry.ids()
            return { before, after }
          }).pipe(Effect.provide(ToolRegistry.defaultLayer)),
        ),
      )

      expect(result.before).toContain("alpha")
      expect(result.before).not.toContain("beta")
      expect(result.before).toContain("sticky_runtime")
      expect(result.after).toContain("alpha")
      expect(result.after).toContain("beta")
      expect(result.after).toContain("sticky_runtime")
    } finally {
      await Instance.provide({ directory, fn: () => Instance.dispose() })
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})

describe("InstanceReload", () => {
  it("announces reloads on the bus", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-reload-instance-"))

    try {
      const seen = await Instance.provide({
        directory,
        fn: async () => {
          const types: string[] = []
          const unsubscribe = Bus.subscribeAll((event) => {
            types.push(event.type)
          })
          try {
            await InstanceReload.reload(directory, ["nikcli.json"])
          } finally {
            unsubscribe()
          }
          return types
        },
      })

      expect(seen).toContain(InstanceReload.Event.Started.type)
      expect(seen).toContain(InstanceReload.Event.Completed.type)
    } finally {
      await Instance.provide({ directory, fn: () => Instance.dispose() })
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it("publishes completion after command state can rebuild", async () => {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-reload-barrier-")))
    const configPath = path.join(directory, "nikcli.json")
    const writeCommand = (name: string) =>
      fs.writeFile(configPath, JSON.stringify({ command: { [name]: { template: "do $ARGUMENTS" } } }))

    try {
      await writeCommand("alpha")
      const result = await Instance.provide({
        directory,
        fn: () =>
          Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const command = yield* Command.Service
                const before = (yield* command.list()).map((entry) => entry.name)
                let after: string[] = []
                let unsubscribe = () => {}

                yield* Effect.addFinalizer(() => Effect.sync(() => unsubscribe()))

                unsubscribe = Bus.subscribe(InstanceReload.Event.Completed, async () => {
                  after = (await Effect.runPromise(command.list())).map((entry) => entry.name)
                })

                yield* Effect.promise(() => writeCommand("beta-command"))
                yield* Effect.promise(() => InstanceReload.reload(directory, [configPath]))
                return { before, after }
              }).pipe(Effect.provide(Command.defaultLayer)),
            ),
          ),
      })

      expect(result.before).toContain("alpha")
      expect(result.before).not.toContain("beta-command")
      expect(result.after).toContain("beta-command")
      expect(result.after).not.toContain("alpha")
    } finally {
      await Instance.provide({ directory, fn: () => Instance.dispose() })
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
