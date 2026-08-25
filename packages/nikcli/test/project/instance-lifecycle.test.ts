import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { realpathSync } from "fs"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-instance-lifecycle-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const { Instance } = await import("@/project/instance")
const { InstanceState } = await import("@/effect")

const created: string[] = []

async function directory(label: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `nikcli-instance-${label}-`))
  created.push(dir)
  // Every assertion about the cache is an assertion about its key, and the key
  // is the realpath — on macOS `/var/folders/...` is itself a symlink.
  return realpathSync(dir)
}

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

afterAll(async () => {
  await Instance.disposeAll()
  for (const dir of created) await removeTestDir(dir)
  await removeTestDir(testHome)
})

/**
 * R1 replaces the `Map<string, Promise<Context>>` promise cache and the
 * AsyncLocalStorage scope in `project/instance.ts` with a keyed scoped runtime.
 * These tests exist so that migration is a swap of mechanism and not of
 * behaviour: they pin what the current implementation guarantees about
 * acquisition, failure, invalidation and disposal, without asserting anything
 * about *how* it is stored. A replacement that keeps every one of these green
 * is a replacement that cannot silently change what callers depend on.
 */
describe("Instance lifecycle — concurrent acquisition", () => {
  it("bootstraps once for overlapping acquisitions of the same directory", async () => {
    const dir = await directory("concurrent")
    const gate = deferred()
    let firstInit = 0
    let secondInit = 0

    // Started but deliberately not awaited: the second call has to find the
    // bootstrap still in flight, which is the case the cache exists for.
    const first = Instance.provide({
      directory: dir,
      init: async () => {
        firstInit++
        await gate.promise
      },
      fn: () => Instance.project.id,
    })
    const second = Instance.provide({
      directory: dir,
      init: async () => {
        secondInit++
      },
      fn: () => Instance.project.id,
    })

    gate.resolve()
    const [a, b] = await Promise.all([first, second])

    expect(a).toBe(b)
    expect(firstInit).toBe(1)
    // `init` belongs to the bootstrap, not to the call. The loser of the race
    // joins the winner's instance and its own `init` never runs — callers that
    // pass one must treat it as "once per directory", never "before my body".
    expect(secondInit).toBe(0)
  })

  it("keys the instance by realpath, so an alias joins rather than duplicates", async () => {
    const dir = await directory("alias")
    const link = path.join(path.dirname(dir), `${path.basename(dir)}-link`)
    await fs.symlink(dir, link)
    created.push(link)

    let inits = 0
    const canonical = await Instance.provide({
      directory: dir,
      init: async () => {
        inits++
      },
      fn: () => Instance.directory,
    })
    const viaLink = await Instance.provide({
      directory: link,
      init: async () => {
        inits++
      },
      fn: () => Instance.directory,
    })

    expect(canonical).toBe(dir)
    expect(viaLink).toBe(dir)
    expect(inits).toBe(1)
    expect(Instance.has(link)).toBe(true)
  })

  it("shares instance-scoped state between callers of the same directory", async () => {
    const dir = await directory("shared-state")
    const cell = Instance.state(() => ({ token: {} }))

    const one = await Instance.provide({ directory: dir, fn: () => cell() })
    const two = await Instance.provide({ directory: dir, fn: () => cell() })

    expect(two).toBe(one)
  })

  it("gives each directory its own state", async () => {
    const [a, b] = await Promise.all([directory("state-a"), directory("state-b")])
    const cell = Instance.state(() => ({ token: {} }))

    const fromA = await Instance.provide({ directory: a, fn: () => cell() })
    const fromB = await Instance.provide({ directory: b, fn: () => cell() })

    expect(fromB).not.toBe(fromA)
  })

  it("restores the enclosing instance after a nested acquisition returns", async () => {
    const [outer, inner] = await Promise.all([directory("outer"), directory("inner")])

    const seen = await Instance.provide({
      directory: outer,
      fn: async () => {
        const before = Instance.directory
        const nested = await Instance.provide({ directory: inner, fn: () => Instance.directory })
        return { before, nested, after: Instance.directory }
      },
    })

    expect(seen.before).toBe(outer)
    expect(seen.nested).toBe(inner)
    expect(seen.after).toBe(outer)
  })
})

describe("Instance lifecycle — bootstrap failure", () => {
  it("does not cache a failed bootstrap, and the next acquisition retries", async () => {
    const dir = await directory("boot-fail")
    let attempts = 0

    await expect(
      Instance.provide({
        directory: dir,
        init: async () => {
          attempts++
          throw new Error("bootstrap exploded")
        },
        fn: () => "unreachable",
      }),
    ).rejects.toThrow("bootstrap exploded")

    // The failure is not sticky: a poisoned entry would make the directory
    // permanently unusable for the life of the process.
    expect(Instance.has(dir)).toBe(false)

    const recovered = await Instance.provide({
      directory: dir,
      init: async () => {
        attempts++
      },
      fn: () => Instance.directory,
    })

    expect(recovered).toBe(dir)
    expect(attempts).toBe(2)
    expect(Instance.has(dir)).toBe(true)
  })

  it("fails every waiter on a shared failing bootstrap, and evicts it once", async () => {
    const dir = await directory("boot-fail-shared")
    const gate = deferred()

    const first = Instance.provide({
      directory: dir,
      init: async () => {
        await gate.promise
        throw new Error("shared bootstrap exploded")
      },
      fn: () => "unreachable",
    })
    const second = Instance.provide({ directory: dir, fn: () => "unreachable" })

    gate.resolve()
    const [a, b] = await Promise.allSettled([first, second])

    expect(a.status).toBe("rejected")
    expect(b.status).toBe("rejected")
    // Both waiters observe the same failure — the loser is not handed a
    // half-built instance, and not a different error either.
    expect((a as PromiseRejectedResult).reason).toBe((b as PromiseRejectedResult).reason)
    // Eviction is guarded by identity, so the second waiter's cleanup cannot
    // remove an entry that a later acquisition has already installed.
    expect(Instance.has(dir)).toBe(false)
  })

  it("keeps the instance cached when the body throws", async () => {
    const dir = await directory("body-throws")
    let inits = 0

    await expect(
      Instance.provide({
        directory: dir,
        init: async () => {
          inits++
        },
        fn: () => {
          throw new Error("body exploded")
        },
      }),
    ).rejects.toThrow("body exploded")

    // A failing body says nothing about the instance. Evicting here would make
    // one bad request re-bootstrap the project for everyone.
    expect(Instance.has(dir)).toBe(true)
    await Instance.provide({ directory: dir, fn: () => Instance.directory })
    expect(inits).toBe(1)
  })
})

describe("Instance lifecycle — disposal", () => {
  it("runs registered disposers, drops the instance, and rebuilds state", async () => {
    const dir = await directory("dispose")
    const builds: number[] = []
    let stateDisposals = 0
    let disposerRuns = 0
    let build = 0
    const cell = Instance.state(
      () => {
        build++
        builds.push(build)
        return { build }
      },
      async () => {
        stateDisposals++
      },
    )

    await Instance.provide({
      directory: dir,
      fn: () => {
        Instance.registerDisposer(() => {
          disposerRuns++
        })
        cell()
      },
    })

    await Instance.provide({ directory: dir, fn: () => Instance.dispose() })

    expect(disposerRuns).toBe(1)
    expect(stateDisposals).toBe(1)
    expect(Instance.has(dir)).toBe(false)

    // The point of disposal: the next acquisition starts from disk again.
    const after = await Instance.provide({ directory: dir, fn: () => cell() })
    expect(after.build).toBe(2)
  })

  it("runs each disposer once even if disposal is entered twice", async () => {
    const dir = await directory("dispose-twice")
    let runs = 0

    await Instance.provide({
      directory: dir,
      fn: async () => {
        Instance.registerDisposer(() => {
          runs++
        })
        // Both calls resolve the same context off the ambient scope, so the
        // second one still has a disposer set to walk. `disposers.clear()` is
        // the only thing standing between that and a double teardown — which
        // for a real disposer (a watcher, a server, a database handle) is a
        // second close on something already closed.
        await Instance.dispose()
        await Instance.dispose()
      },
    })

    expect(runs).toBe(1)
  })

  it("gives a re-acquired instance a fresh disposer set", async () => {
    const dir = await directory("dispose-reacquire")
    let runs = 0

    await Instance.provide({
      directory: dir,
      fn: () => {
        Instance.registerDisposer(() => {
          runs++
        })
      },
    })
    await Instance.provide({ directory: dir, fn: () => Instance.dispose() })
    expect(runs).toBe(1)

    // Not the same property as the test above: this one holds because disposal
    // evicts the cache entry, so the next acquisition builds a new context with
    // its own set. A disposer registered against the old context is gone with it.
    await Instance.provide({ directory: dir, fn: () => undefined })
    await Instance.provide({ directory: dir, fn: () => Instance.dispose() })
    expect(runs).toBe(1)
  })

  it("isolates a failing disposer from the rest of teardown", async () => {
    const dir = await directory("dispose-throws")
    let sync = 0
    let async_ = 0

    await Instance.provide({
      directory: dir,
      fn: () => {
        Instance.registerDisposer(() => {
          throw new Error("sync disposer exploded")
        })
        Instance.registerDisposer(async () => {
          throw new Error("async disposer exploded")
        })
        Instance.registerDisposer(() => {
          sync++
        })
        Instance.registerDisposer(async () => {
          async_++
        })
      },
    })

    // Teardown is best-effort by design: one broken disposer must not strand
    // the others or leave the directory cached and unusable.
    await Instance.provide({ directory: dir, fn: () => Instance.dispose() })

    expect(sync).toBe(1)
    expect(async_).toBe(1)
    expect(Instance.has(dir)).toBe(false)
  })

  it("requires an active scope to dispose", async () => {
    const dir = await directory("dispose-unscoped")
    await Instance.provide({ directory: dir, fn: () => undefined })

    // `dispose` reads the ambient context rather than taking a directory, so
    // calling it outside a scope is an error and not a silent no-op.
    await expect(Instance.dispose()).rejects.toThrow(/No context found/)
    expect(Instance.has(dir)).toBe(true)
  })

  it("disposes every live instance in disposeAll", async () => {
    const [a, b] = await Promise.all([directory("dispose-all-a"), directory("dispose-all-b")])
    let runs = 0

    for (const dir of [a, b]) {
      await Instance.provide({
        directory: dir,
        fn: () => {
          Instance.registerDisposer(() => {
            runs++
          })
        },
      })
    }

    await Instance.disposeAll()

    expect(runs).toBe(2)
    expect(Instance.has(a)).toBe(false)
    expect(Instance.has(b)).toBe(false)
  })
})

describe("Instance lifecycle — the ALS fallback R1 removes", () => {
  it("resolves the instance context from ALS when no InstanceRef is provided", async () => {
    const dir = await directory("als-fallback")
    const { Effect } = await import("effect")

    const ctx = await Instance.provide({
      directory: dir,
      fn: () => Effect.runPromise(InstanceState.context),
    })

    // This is the fallback in `effect/instance-state.ts`, and it is the reason
    // R1 cannot simply delete `util/context.ts`: an Effect run without
    // `InstanceRef` still resolves, because the ambient scope answers. When the
    // keyed runtime lands, this test should be inverted — not deleted — so the
    // day the fallback stops working is a decision and not a surprise.
    expect(ctx.directory).toBe(dir)
    expect(ctx.worktree).toBeString()
    expect(ctx.project.id).toBeString()
  })
})

/**
 * `dispose()` tears down the instance but leaves the ambient scope answering,
 * so a caller that disposes mid-request and keeps working — which is exactly
 * what `httpapi/provider.ts` and `httpapi/config.ts` do — builds state that
 * nothing owns. These tests characterize that, they do not endorse it: they are
 * the reason R1 needs the keyed runtime to give those call sites invalidation
 * semantics instead of teardown. When it lands, invert them.
 */
describe("Instance lifecycle — what survives dispose (characterized, not endorsed)", () => {
  it("keeps the ambient context live after the instance is gone", async () => {
    const dir = await directory("post-dispose-ambient")

    await Instance.provide({
      directory: dir,
      fn: async () => {
        await Instance.dispose()
        // The cache entry is gone, yet every accessor still answers, because
        // they read the scope rather than the cache. Nothing tells the caller
        // it is now holding a disposed instance.
        expect(Instance.has(dir)).toBe(false)
        expect(Instance.directory).toBe(dir)
      },
    })
  })

  it("never runs a disposer registered after dispose", async () => {
    const dir = await directory("post-dispose-disposer")
    let runs = 0

    await Instance.provide({
      directory: dir,
      fn: async () => {
        await Instance.dispose()
        Instance.registerDisposer(() => {
          runs++
        })
      },
    })

    // The set was already walked and cleared, and the cache entry it would have
    // been reached through is deleted, so `disposeAll` has nothing to find.
    await Instance.disposeAll()
    expect(runs).toBe(0)
  })

  it("leaves state rebuilt after dispose without an owner", async () => {
    const dir = await directory("post-dispose-state")
    let disposed = 0

    await Instance.provide({
      directory: dir,
      fn: async () => {
        const state = Instance.state(
          () => ({ n: 1 }),
          async () => {
            disposed++
          },
        )
        state()
        await Instance.dispose()
        expect(disposed).toBe(1)
        // Reading it again re-runs `init` under the same directory key. This
        // second instance outlives the scope: only a later acquire-and-dispose
        // of the same directory would ever collect it.
        state()
      },
    })

    await Instance.disposeAll()
    expect(disposed).toBe(1)
  })
})
