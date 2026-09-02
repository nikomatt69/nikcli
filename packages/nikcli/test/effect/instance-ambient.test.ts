import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { realpathSync } from "fs"
import { Effect } from "effect"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-instance-ambient-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const { Instance } = await import("@/project/instance")
const { InstanceState } = await import("@/effect")
const { locallyInstance } = await import("@/effect/instance-ref")
const { AppRuntime } = await import("@/effect/runtime")

const created: string[] = []

async function directory(label: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `nikcli-ambient-${label}-`))
  created.push(dir)
  return realpathSync(dir)
}

afterAll(async () => {
  await Instance.disposeAll()
  for (const dir of created) await removeTestDir(dir)
  await removeTestDir(testHome)
})

/**
 * `InstanceState.ambient()` is the synchronous read of the instance scope that
 * six call sites were obtaining by starting a fiber on a `ManagedRuntime`
 * whose only work was to read these three getters and hand them straight back.
 *
 * It is also now the single definition of "the ambient instance": the Effect
 * form, `InstanceState.context`, falls back to it. That makes the fallback
 * order below load-bearing, so it is pinned rather than assumed.
 */
describe("InstanceState.ambient", () => {
  it("reads the enclosing instance scope", async () => {
    const dir = await directory("read")
    const ctx = await Instance.provide({ directory: dir, fn: async () => InstanceState.ambient() })

    expect(ctx.directory).toBe(dir)
    expect(ctx.worktree).toBe(await Instance.provide({ directory: dir, fn: async () => Instance.worktree }))
    expect(ctx.project).toBe(await Instance.provide({ directory: dir, fn: async () => Instance.project }))
  })

  it("reads the innermost scope when instances are nested", async () => {
    const outer = await directory("outer")
    const inner = await directory("inner")

    const seen = await Instance.provide({
      directory: outer,
      fn: () =>
        Instance.provide({
          directory: inner,
          fn: async () => InstanceState.ambient().directory,
        }),
    })

    expect(seen).toBe(inner)
  })

  it("throws outside an instance scope instead of inventing one", () => {
    // The call sites it replaced would have rejected their promise here. A
    // silent default would hand a caller some other project's directory.
    expect(() => InstanceState.ambient()).toThrow()
  })

  it("agrees with the Effect form when no InstanceRef is in the fiber", async () => {
    const dir = await directory("agree")
    const [sync, viaEffect] = await Instance.provide({
      directory: dir,
      fn: async () =>
        Promise.all([Promise.resolve(InstanceState.ambient()), AppRuntime.runPromise(InstanceState.context)]),
    })

    expect(viaEffect).toEqual(sync)
  })

  it("does not override an InstanceRef the fiber already carries", async () => {
    // `context` prefers the fiber's service and only falls back to `ambient`.
    // Collapsing the two would silently re-point Effects that were deliberately
    // bound to another instance — which is the whole point of `locallyInstance`.
    const ambientDir = await directory("ambient")
    const boundDir = await directory("bound")

    const bound = await Instance.provide({
      directory: boundDir,
      fn: async () => InstanceState.ambient(),
    })

    const seen = await Instance.provide({
      directory: ambientDir,
      fn: async () =>
        AppRuntime.runPromise(
          locallyInstance(
            bound,
            Effect.map(InstanceState.context, (c) => c.directory),
          ),
        ),
    })

    expect(seen).toBe(boundDir)
    expect(seen).not.toBe(ambientDir)
  })
})
