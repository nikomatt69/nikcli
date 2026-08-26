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
const { Bus } = await import("@/bus")

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
 * R1 replaces the `Map<string, Promise<Context>>` promise cache with a keyed
 * `ScopedCache` in `project/instance.ts`. ALS still carries "which instance
 * am I in" for the remaining synchronous reads; these tests pin what
 * acquisition, failure, invalidation and disposal guarantee, without
 * asserting anything about *how* the entry is stored. A replacement that
 * keeps every one of these green is a replacement that cannot silently
 * change what callers depend on.
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
    // `init` belongs to the bootstrap, not to the call. Whichever asker
    // reaches the empty `bootstrapped` slot first runs it; the other joins.
    // Production has only `InstanceBootstrap`, so the two functions are the
    // same constant — callers must treat this as "once per directory", never
    // "before my body".
    expect(firstInit + secondInit).toBe(1)
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
        const nested = await Instance.provide({
          directory: inner,
          fn: () => Instance.directory,
        })
        return { before, nested, after: Instance.directory }
      },
    })

    expect(seen.before).toBe(outer)
    expect(seen.nested).toBe(inner)
    expect(seen.after).toBe(outer)
  })
})

describe("Instance lifecycle — bootstrap failure", () => {
  it("keeps the instance when the first caller's init fails, and the next acquisition retries", async () => {
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

    // Inverted 2026-08-26. `init` used to run inside the creation promise, so
    // a failed first bootstrap evicted the instance as if `fromDirectory` had
    // failed. The keyed cache looks up the context only; `init` is the same
    // retroactive path whether the instance is new or already held. The
    // failure is not sticky — a poisoned `bootstrapped` would make the
    // directory permanently unusable — but the entry stays.
    expect(Instance.has(dir)).toBe(true)

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

  it("fails every waiter that asked for a shared failing init, and keeps the instance", async () => {
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
    const second = Instance.provide({
      directory: dir,
      init: async () => {
        throw new Error("should join the first init, not run")
      },
      fn: () => "unreachable",
    })
    const bystander = Instance.provide({
      directory: dir,
      fn: () => "ok",
    })

    gate.resolve()
    const [a, b, c] = await Promise.allSettled([first, second, bystander])

    expect(a.status).toBe("rejected")
    expect(b.status).toBe("rejected")
    // Both waiters that asked for init observe the same failure — the loser
    // is not handed a half-bootstrapped instance, and not a different error.
    expect((a as PromiseRejectedResult).reason).toBe((b as PromiseRejectedResult).reason)
    // Inverted 2026-08-26. A waiter that did not ask for bootstrap is not
    // failed by someone else's `init`. Creation already succeeded; they
    // wanted the instance. Evicting here would also drop the entry out from
    // under them.
    expect(c).toEqual({ status: "fulfilled", value: "ok" })
    expect(Instance.has(dir)).toBe(true)
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
        // Both calls resolve the same context off the ambient scope. Teardown
        // is idempotent as of 2026-08-25, so the second returns immediately;
        // before that, `disposers.clear()` was the only thing standing between
        // this and a double close on a watcher, a server or a database handle,
        // and the disposal event and state teardown outside that set ran twice
        // regardless.
        await Instance.dispose()
        await Instance.dispose()
      },
    })

    expect(runs).toBe(1)
  })

  it("publishes the disposal event once when disposal is entered twice", async () => {
    // What `disposers.clear()` never covered: everything outside the disposer
    // set — the disposal event, the state teardown — ran again on the second
    // call, because both calls resolve the same context off the ambient scope.
    const dir = await directory("dispose-twice-event")
    let events = 0

    await Instance.provide({
      directory: dir,
      fn: async () => {
        const unsubscribe = await Bus.subscribe(Bus.InstanceDisposed, (event) => {
          if (event.properties.directory === dir) events++
        })
        await Instance.dispose()
        await Instance.dispose()
        unsubscribe()
      },
    })

    expect(events).toBe(1)
  })

  it("runs a disposer that registers another disposer during teardown", async () => {
    // The instance is marked disposed before the walk, not after it, so a
    // registration that arrives mid-teardown is treated as late and runs.
    // Marking it afterwards would add it to a set that is cleared moments
    // later, which drops it without a word.
    const dir = await directory("dispose-nested")
    let nested = 0

    await Instance.provide({
      directory: dir,
      fn: async () => {
        Instance.registerDisposer(() => {
          Instance.registerDisposer(() => {
            nested++
          })
        })
        await Instance.dispose()
      },
    })

    await Instance.disposeAll()
    expect(nested).toBe(1)
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
/**
 * Two of the three defects this block characterized are fixed (2026-08-25).
 * They are inverted here rather than deleted, so the day the old behaviour
 * stopped is recorded as a decision and not as a missing test.
 *
 * The first is deliberately still green: `dispose()` does not blind the
 * ambient accessors. 215 synchronous `Instance.*` reads across 89 files
 * depend on them answering, and making them throw is the keyed runtime's
 * change to make, not a side effect of fixing disposer registration.
 */
describe("Instance lifecycle — what survives dispose", () => {
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

  it("runs a disposer registered after dispose instead of dropping it", async () => {
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

    // Inverted 2026-08-25. The set has been walked and will not be walked
    // again, and the cache entry that would have reached it is deleted — so
    // adding to it used to drop the disposer in silence. It runs immediately
    // now, because whatever it closes was created on a dead instance.
    await Instance.disposeAll()
    expect(runs).toBe(1)
  })

  it("collects state rebuilt after dispose instead of leaking it", async () => {
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
        // Reading it again re-runs `init` under the same directory key, with
        // no cache entry left to reach it.
        state()
      },
    })

    // Inverted 2026-08-25. That second cell used to be collectable only by a
    // later acquire-and-dispose of the same directory, which may never come;
    // `disposeAll` sweeps the state records that outlived their instances.
    await Instance.disposeAll()
    expect(disposed).toBe(2)
  })
})

/**
 * `Instance.invalidate` is the seam the characterized dispose tests above
 * point at: config/provider mutations need derived state rebuilt, not the
 * instance torn down mid-request. These pin what invalidation guarantees,
 * so the keyed scoped runtime can swap mechanism without changing
 * behaviour — and so nothing quietly drifts back to dispose-as-invalidate.
 */
describe("Instance lifecycle — invalidation", () => {
  it("keeps the instance cached, its disposers, and its state cells", async () => {
    const dir = await directory("invalidate-keep")
    let disposerRuns = 0
    const cell = Instance.state(() => ({ token: {} }))

    const before = await Instance.provide({
      directory: dir,
      fn: () => {
        Instance.registerDisposer(() => {
          disposerRuns++
        })
        return cell()
      },
    })

    await Instance.provide({ directory: dir, fn: () => Instance.invalidate() })

    // Invalidation is not teardown: the entry stays, disposers are untouched.
    expect(Instance.has(dir)).toBe(true)
    expect(disposerRuns).toBe(0)
    // A non-reloadable state cell keeps serving the same state — only
    // reloadable caches rebuild on the next access.
    const after = await Instance.provide({ directory: dir, fn: () => cell() })
    expect(after).toBe(before)

    // Teardown remains available and runs exactly once afterwards.
    await Instance.provide({ directory: dir, fn: () => Instance.dispose() })
    expect(disposerRuns).toBe(1)
    expect(Instance.has(dir)).toBe(false)
  })

  it("accepts an explicit directory without an ambient scope", async () => {
    const dir = await directory("invalidate-explicit")
    await Instance.provide({ directory: dir, fn: () => undefined })

    // Unlike dispose, invalidation can be addressed by key: callers that
    // hold a directory (tests, global tooling) do not need to stand in a
    // scope first.
    await Instance.invalidate(dir)
    expect(Instance.has(dir)).toBe(true)
  })

  it("requires an active scope when no directory is given", async () => {
    const dir = await directory("invalidate-unscoped")
    await Instance.provide({ directory: dir, fn: () => undefined })

    // Same contract as dispose: without a key it reads the ambient scope,
    // and with none it fails loudly instead of silently doing nothing.
    await expect(Instance.invalidate()).rejects.toThrow(/No context found/)
    expect(Instance.has(dir)).toBe(true)
  })
})

/**
 * Bootstrap belongs to the instance, not to whoever reached it first.
 *
 * It used not to. `init` was a parameter of the caller, so an acquisition that
 * passed none permanently decided that the directory would never be
 * bootstrapped, and every later caller's `init` was dropped in silence. That
 * was reachable in production, not a test-only shape: `server/mobile/
 * session.ts` creates a session on a *freshly created worktree directory* with
 * no `init`, so that worktree's instance came up without LSP, the file
 * watcher, the formatter, snapshots, hot reload, or the loop / mission /
 * routine restores — and a later `withInstanceAsync({ directory, init:
 * InstanceBootstrap })` for the same worktree joined that entry and did
 * nothing.
 *
 * Every `init` passed anywhere in `src` is the same constant
 * (`InstanceBootstrap`), which is what made this a defect rather than a
 * policy: no caller wants a different bootstrap, they only disagreed about
 * whether one happens at all.
 */
describe("Instance lifecycle — init belongs to the instance", () => {
  it("runs a later init on an instance an earlier caller created without one", async () => {
    const dir = await directory("init-first-caller")
    let bootstraps = 0

    // Stands in for the mobile session route: a fresh worktree, no init.
    await Instance.provide({ directory: dir, fn: async () => {} })

    // Stands in for the HTTP router: same directory, InstanceBootstrap.
    await Instance.provide({
      directory: dir,
      init: async () => {
        bootstraps++
      },
      fn: async () => {},
    })

    expect(bootstraps).toBe(1)
    expect(Instance.has(dir)).toBe(true)

    // And still only once: a third caller joins the bootstrap that ran.
    await Instance.provide({
      directory: dir,
      init: async () => {
        bootstraps++
      },
      fn: async () => {},
    })
    expect(bootstraps).toBe(1)
  })

  it("shares one retroactive bootstrap between concurrent askers", async () => {
    const dir = await directory("init-retro-shared")
    const gate = deferred()
    let bootstraps = 0

    await Instance.provide({ directory: dir, fn: async () => {} })

    const init = async () => {
      bootstraps++
      await gate.promise
    }
    // Both find the instance already built and both ask for a bootstrap; the
    // loser has to join the winner's run rather than start a second one.
    const first = Instance.provide({ directory: dir, init, fn: async () => "a" })
    const second = Instance.provide({ directory: dir, init, fn: async () => "b" })

    gate.resolve()
    expect(await Promise.all([first, second])).toEqual(["a", "b"])
    expect(bootstraps).toBe(1)
  })

  it("lets the next caller retry a retroactive bootstrap that failed, and keeps the instance", async () => {
    const dir = await directory("init-retro-fail")
    let attempts = 0

    await Instance.provide({ directory: dir, fn: async () => {} })

    await expect(
      Instance.provide({
        directory: dir,
        init: async () => {
          attempts++
          throw new Error("retro bootstrap exploded")
        },
        fn: () => "unreachable",
      }),
    ).rejects.toThrow("retro bootstrap exploded")

    // The instance predates the failed bootstrap and other callers hold it, so
    // unlike a failed *creation* it is not evicted — but the failure is not
    // sticky either.
    expect(Instance.has(dir)).toBe(true)

    await Instance.provide({
      directory: dir,
      init: async () => {
        attempts++
      },
      fn: async () => {},
    })
    expect(attempts).toBe(2)
  })

  it("runs init once when the caller that passes one arrives first", async () => {
    const dir = await directory("init-bootstrap-first")
    let bootstraps = 0
    const init = async () => {
      bootstraps++
    }

    await Instance.provide({ directory: dir, init, fn: async () => {} })
    await Instance.provide({ directory: dir, init, fn: async () => {} })
    await Instance.provide({ directory: dir, fn: async () => {} })

    // Once per directory, not once per call — the property the keyed runtime
    // has to keep. Only the *skipped* case above is the defect.
    expect(bootstraps).toBe(1)
  })

  it("runs init inside the instance scope it is bootstrapping", async () => {
    const dir = await directory("init-scope")
    let seen: string | undefined

    await Instance.provide({
      directory: dir,
      init: async () => {
        seen = Instance.directory
      },
      fn: async () => {},
    })

    // InstanceBootstrap reads `Instance.directory` on its first line and
    // registers disposers on the context being built, so init must not run
    // before the scope exists.
    expect(seen).toBe(dir)
  })
})
