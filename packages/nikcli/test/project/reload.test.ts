import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, describe, expect, it } from "bun:test"
import { Effect } from "effect"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-reload-home-"))
process.env.NIKCLI_TEST_HOME ??= testHome

const { InstanceState, locallyInstance } = await import("@/effect")
const { Instance } = await import("@/project/instance")
const { InstanceReload } = await import("@/project/reload")
const { Bus } = await import("@/bus")

afterAll(async () => {
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("InstanceState hot reload", () => {
  it("rebuilds reloadable caches on invalidate and leaves others untouched", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-reload-state-"))

    try {
      const result = await Effect.runPromise(
        locallyInstance(
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
            await InstanceReload.reload(["nikcli.json"])
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
})
