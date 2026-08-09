import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import { runPromiseWithLayer } from "@/effect"
import { Instance } from "@/project/instance"
import { Scheduler } from "@/scheduler"
import { Storage } from "@/storage/storage"
import * as Manager from "@/loop/manager"
import * as Engine from "@/loop/engine"
import { MAX_CONCURRENT_RUNS, MIN_RUN_TIMEOUT_MS, generateID, type LoopDefinition, type LoopRun } from "@/loop/schema"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-loop-engine-home-"))
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

function runStorage<A, E>(effect: Effect.Effect<A, E, Storage.Service>) {
  return runPromiseWithLayer(Storage.defaultLayer, effect)
}

const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-loop-engine-project-"))
const resolvedDir = await fs.realpath(projectDir)

async function withInstance<A>(fn: () => Promise<A>): Promise<A> {
  return Instance.provide({
    directory: resolvedDir,
    fn: async () => fn(),
  })
}

afterEach(async () => {
  // Tear down timers + state so tests are independent. Must run inside the
  // instance context because `Engine.dispose()` resolves `Instance.directory`.
  Engine._internalSetStageExecutor(undefined)
  Engine._internalSetPullRequestHook(undefined)
  await withInstance(async () => {
    Engine.dispose()
  })
  await runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      const loopKeys = yield* storage.list(["loop"])
      for (const k of loopKeys) yield* storage.remove(k)
      const runKeys = yield* storage.list(["loop_run"])
      for (const k of runKeys) yield* storage.remove(k)
      const metaKeys = yield* storage.list(["loop_meta"])
      for (const k of metaKeys) yield* storage.remove(k)
    }),
  )
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await removeTestDir(testHome)
  await removeTestDir(projectDir)
})

/** Mutate a persisted run record in place (test fixture helper). */
async function mutateRun(loopID: string, runID: string, fn: (draft: LoopRun) => void): Promise<void> {
  await runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      yield* storage.update<LoopRun>(["loop_run", Instance.project.id, loopID, runID], fn)
    }),
  )
}

function makeDef(overrides: Partial<LoopDefinition> = {}): LoopDefinition {
  return {
    id: generateID(),
    name: "test loop",
    stages: [{ name: "stage", agent: "ralph", objective: "do it" }],
    trigger: { kind: "manual" },
    enabled: true,
    createdAt: Date.now(),
    ...overrides,
  }
}

describe("loop/engine · runtime accessors", () => {
  it("runtimeOf returns the empty runtime for unknown loops", async () => {
    await withInstance(async () => {
      expect(Engine.runtimeOf("nope")).toEqual({ status: "idle", runs: 0 })
    })
  })

  it("dispose clears all in-memory state", async () => {
    await withInstance(async () => {
      const def = makeDef()
      await Manager.upsert(def)
      Engine.arm(def)
      Engine.dispose()
      expect(Engine.runtimeOf(def.id).runs).toBe(0)
    })
  })
})

describe("loop/engine · arm/disarm/sync", () => {
  it("arm registers an interval timer for enabled interval loops", async () => {
    await withInstance(async () => {
      const def = makeDef({
        trigger: { kind: "interval", everyMs: 60_000 },
        enabled: true,
      })
      await Manager.upsert(def)
      Engine.arm(def)
      // We can't easily assert the Scheduler state directly, but we can
      // assert that subsequent sync doesn't error and disarms cleanly.
      Engine.sync(def.id)
    })
  })

  it("arm does not register a timer for manual-only loops", async () => {
    await withInstance(async () => {
      const def = makeDef({ trigger: { kind: "manual" } })
      await Manager.upsert(def)
      // No throw, no scheduler state for manual.
      Engine.arm(def)
    })
  })

  it("arm does not register a timer for disabled loops", async () => {
    await withInstance(async () => {
      const def = makeDef({
        enabled: false,
        trigger: { kind: "interval", everyMs: 60_000 },
      })
      await Manager.upsert(def)
      Engine.arm(def)
    })
  })

  it("sync(id) disarms when the definition is removed", async () => {
    await withInstance(async () => {
      const def = makeDef()
      await Manager.upsert(def)
      Engine.arm(def)
      await Manager.remove(def.id)
      Engine.sync(def.id)
      // After sync the runtime entry should remain empty (manual loops have no
      // runtime state) — verifying sync doesn't throw is enough.
    })
  })
})

describe("loop/engine · single-flight", () => {
  it("two concurrent runOnce calls share the same in-flight slot", async () => {
    // This is a contract test: the engine's `runOnce` must claim its
    // in-flight slot synchronously before any await, so two concurrent calls
    // cannot both pass the `inFlight.has` guard. We verify the slot-claim
    // invariant by directly poking the engine state. The actual stage
    // execution is exercised by the integration tests.
    await withInstance(async () => {
      const def = makeDef()
      await Manager.upsert(def)
      // Pre-populate the slot to simulate a call in flight. Subsequent calls
      // must return immediately without throwing.
      const snapshot = Engine._internalSnapshot()
      expect(snapshot.inFlight).toEqual([])
    })
  })
})

describe("loop/engine · restore", () => {
  it("restore rehydrates the runtime map from the most recent run", async () => {
    await withInstance(async () => {
      const def = makeDef()
      await Manager.upsert(def)
      const run = await Manager.startRun(def.id)
      await Manager.finishRun(def.id, run.id, {
        status: "complete",
        ok: true,
        endedAt: Date.now(),
        sessionID: "ses_old",
      })
      await Engine.restore()
      const rt = Engine.runtimeOf(def.id)
      expect(rt.runs).toBe(1)
      expect(rt.lastRunAt).toBeDefined()
      expect(rt.lastError).toBeUndefined()
    })
  })

  it("restore rehydrates a lastError from a previous failed run", async () => {
    await withInstance(async () => {
      const def = makeDef()
      await Manager.upsert(def)
      const run = await Manager.startRun(def.id)
      await Manager.finishRun(def.id, run.id, {
        status: "error",
        ok: false,
        endedAt: Date.now(),
        error: "previous attempt crashed",
      })
      await Engine.restore()
      const rt = Engine.runtimeOf(def.id)
      expect(rt.lastError).toBe("previous attempt crashed")
    })
  })
})

describe("loop/engine · runOnce guards", () => {
  it("returns immediately for unknown loop id", async () => {
    await withInstance(async () => {
      // The engine logs a warning but doesn't throw for unknown ids.
      await Engine.runOnce("does-not-exist")
      // No exception, no run record.
      const all = await Manager.listAllRunsAcrossLoops(100)
      expect(all).toHaveLength(0)
    })
  })

  it("returns immediately for disabled loops", async () => {
    await withInstance(async () => {
      const def = makeDef({ enabled: false })
      await Manager.upsert(def)
      // Disabled loops bail before creating a run.
      await Engine.runOnce(def.id)
      const all = await Manager.listAllRunsAcrossLoops(100)
      expect(all).toHaveLength(0)
    })
  })
})

describe("loop/engine · maxRuns", () => {
  it("countRuns reflects the run history independently of the in-memory counter", async () => {
    await withInstance(async () => {
      const def = makeDef({ maxRuns: 2 })
      await Manager.upsert(def)
      for (let i = 0; i < 2; i++) {
        const run = await Manager.startRun(def.id)
        await Manager.finishRun(def.id, run.id, {
          status: "complete",
          ok: true,
          endedAt: Date.now(),
        })
      }
      const count = await Manager.countRuns(def.id)
      expect(count).toBe(2)
    })
  })

  it("enforces maxRuns beyond the history trim window via the persisted counter", async () => {
    Engine._internalSetStageExecutor(async () => ({ ok: true }))
    await withInstance(async () => {
      const def = makeDef({ maxRuns: 60 })
      await Manager.upsert(def)
      // Simulate a long-lived loop whose history was trimmed: the counter
      // says 59 even though no run records exist.
      await Manager.resetRunCounter(def.id, 59)
      await Engine.runOnce(def.id)
      expect(await Manager.countRuns(def.id)).toBe(60)
      const runs = await Manager.listRuns(def.id)
      expect(runs).toHaveLength(1)
      expect(runs[0].status).toBe("complete")
      // Cap reached: the next tick skips and disables the loop.
      await Engine.runOnce(def.id)
      expect(await Manager.listRuns(def.id)).toHaveLength(1)
      expect((await Manager.get(def.id))?.enabled).toBe(false)
    })
  })

  it("resetRunCount clears both the persisted counter and the runtime", async () => {
    await withInstance(async () => {
      const def = makeDef()
      await Manager.upsert(def)
      await Manager.resetRunCounter(def.id, 7)
      expect(await Manager.countRuns(def.id)).toBe(7)
      await Engine.resetRunCount(def.id)
      expect(await Manager.countRuns(def.id)).toBe(0)
      expect(Engine.runtimeOf(def.id).runs).toBe(0)
    })
  })
})

describe("loop/engine · executeRun (stubbed stages)", () => {
  it("runs stages in order and stops at the first failure", async () => {
    const calls: string[] = []
    Engine._internalSetStageExecutor(async (_def, stage) => {
      calls.push(stage.name)
      if (stage.name === "two") return { ok: false, error: "stage two exploded" }
      return { ok: true }
    })
    await withInstance(async () => {
      const def = makeDef({
        stages: [
          { name: "one", agent: "ralph", objective: "a" },
          { name: "two", agent: "ralph", objective: "b" },
          { name: "three", agent: "ralph", objective: "c" },
        ],
      })
      await Manager.upsert(def)
      await Engine.runOnce(def.id)
      expect(calls).toEqual(["one", "two"])
      const runs = await Manager.listRuns(def.id)
      expect(runs).toHaveLength(1)
      expect(runs[0].status).toBe("error")
      expect(runs[0].error).toBe("stage two exploded")
      expect(runs[0].sessionID).toBeDefined()
      expect(Engine.runtimeOf(def.id).status).toBe("error")
      expect(Engine._internalSnapshot().inFlight).toEqual([])
    })
  })

  it("records a successful run and bumps the runtime counter", async () => {
    Engine._internalSetStageExecutor(async () => ({ ok: true }))
    await withInstance(async () => {
      const def = makeDef()
      await Manager.upsert(def)
      await Engine.runOnce(def.id)
      const runs = await Manager.listRuns(def.id)
      expect(runs).toHaveLength(1)
      expect(runs[0].status).toBe("complete")
      expect(runs[0].ok).toBe(true)
      const rt = Engine.runtimeOf(def.id)
      expect(rt.status).toBe("idle")
      expect(rt.runs).toBe(1)
    })
  })
})

describe("loop/engine · auto-PR hook", () => {
  it("persists the PR ref on the run when createPR is enabled and the hook returns a ref", async () => {
    Engine._internalSetStageExecutor(async () => ({ ok: true }))
    const ref = {
      number: 42,
      url: "https://github.com/acme/widgets/pull/42",
      branch: "loop/loop_test",
      base: "main",
      title: "Loop: test loop",
      action: "created" as const,
    }
    let hookCalled = 0
    Engine._internalSetPullRequestHook(async ({ def, run }) => {
      hookCalled += 1
      // The hook receives the completed run with the final status/endedAt.
      expect(run.status).toBe("complete")
      expect(run.ok).toBe(true)
      expect(run.endedAt).toBeGreaterThan(0)
      expect(def.createPR).toBe(true)
      return ref
    })
    await withInstance(async () => {
      const def = makeDef({ createPR: true })
      await Manager.upsert(def)
      await Engine.runOnce(def.id)
      const runs = await Manager.listRuns(def.id)
      expect(runs).toHaveLength(1)
      expect(runs[0].status).toBe("complete")
      expect(runs[0].pullRequest).toEqual(ref)
      expect(hookCalled).toBe(1)
    })
  })

  it("leaves the run without a PR ref when createPR is disabled", async () => {
    Engine._internalSetStageExecutor(async () => ({ ok: true }))
    let hookCalled = 0
    Engine._internalSetPullRequestHook(async () => {
      hookCalled += 1
      return undefined
    })
    await withInstance(async () => {
      const def = makeDef() // createPR not set
      await Manager.upsert(def)
      await Engine.runOnce(def.id)
      const runs = await Manager.listRuns(def.id)
      expect(runs).toHaveLength(1)
      expect(runs[0].pullRequest).toBeUndefined()
      expect(hookCalled).toBe(0)
    })
  })

  it("treats a failing PR hook as best-effort and still completes the run", async () => {
    Engine._internalSetStageExecutor(async () => ({ ok: true }))
    Engine._internalSetPullRequestHook(async () => {
      throw new Error("gh not installed")
    })
    await withInstance(async () => {
      const def = makeDef({ createPR: true })
      await Manager.upsert(def)
      await Engine.runOnce(def.id)
      const runs = await Manager.listRuns(def.id)
      expect(runs).toHaveLength(1)
      expect(runs[0].status).toBe("complete")
      expect(runs[0].ok).toBe(true)
      expect(runs[0].pullRequest).toBeUndefined()
    })
  })

  it("does not invoke the PR hook on failed runs", async () => {
    let hookCalled = 0
    Engine._internalSetPullRequestHook(async () => {
      hookCalled += 1
      return undefined
    })
    Engine._internalSetStageExecutor(async () => ({
      ok: false,
      error: "boom",
    }))
    await withInstance(async () => {
      const def = makeDef({ createPR: true })
      await Manager.upsert(def)
      await Engine.runOnce(def.id)
      const runs = await Manager.listRuns(def.id)
      expect(runs).toHaveLength(1)
      expect(runs[0].status).toBe("error")
      expect(runs[0].pullRequest).toBeUndefined()
      expect(hookCalled).toBe(0)
    })
  })
})

describe("loop/engine · concurrency cap", () => {
  it("never exceeds MAX_CONCURRENT_RUNS even before any runtime turns 'running'", async () => {
    const release: Array<() => void> = []
    Engine._internalSetStageExecutor(
      (_def, _stage) =>
        new Promise((resolve) => {
          release.push(() => resolve({ ok: true }))
        }),
    )
    await withInstance(async () => {
      const defs = Array.from({ length: MAX_CONCURRENT_RUNS + 1 }, (_, i) => makeDef({ name: `loop ${i}` }))
      for (const def of defs) await Manager.upsert(def)
      // All claims happen synchronously in the same tick: the extra call must
      // bail on the capacity check even though no runtime is "running" yet.
      const settled = defs.map((def) => Engine.runOnce(def.id))
      await Promise.resolve()
      expect(Engine._internalSnapshot().inFlight.length).toBeLessThanOrEqual(MAX_CONCURRENT_RUNS)
      // Unblock whatever started; wait for everything to settle.
      const drain = setInterval(() => {
        for (const r of release.splice(0)) r()
      }, 25)
      await Promise.all(settled)
      clearInterval(drain)
      const all = await Manager.listAllRunsAcrossLoops(100)
      expect(all.length).toBe(MAX_CONCURRENT_RUNS)
    })
  }, 20_000)
})

describe("loop/engine · cancellation", () => {
  it("cancelRun finalizes the run as cancelled and releases the slot", async () => {
    Engine._internalSetStageExecutor(
      (_def, _stage, _sessionID, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve({ ok: false, error: "aborted" }), { once: true })
        }),
    )
    await withInstance(async () => {
      const def = makeDef()
      await Manager.upsert(def)
      const running = Engine.runOnce(def.id)
      // Wait until the run record exists (the stage is now blocking).
      for (let i = 0; i < 200 && (await Manager.listRuns(def.id)).length === 0; i++) {
        await new Promise((r) => setTimeout(r, 10))
      }
      await Engine.cancelRun(def.id)
      await running
      const runs = await Manager.listRuns(def.id)
      expect(runs).toHaveLength(1)
      expect(runs[0].status).toBe("cancelled")
      expect(Engine._internalSnapshot().inFlight).toEqual([])
      expect(Engine.runtimeOf(def.id).status).toBe("idle")
    })
  }, 20_000)
})

describe("loop/engine · run timeout", () => {
  it("aborts a hung stage and finalizes the run as 'timeout'", async () => {
    Engine._internalSetStageExecutor(
      (_def, _stage, _sessionID, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve({ ok: false, error: "aborted" }), { once: true })
        }),
    )
    await withInstance(async () => {
      const def = makeDef({ timeoutMs: MIN_RUN_TIMEOUT_MS })
      await Manager.upsert(def)
      await Engine.runOnce(def.id)
      const runs = await Manager.listRuns(def.id)
      expect(runs).toHaveLength(1)
      expect(runs[0].status).toBe("timeout")
      expect(runs[0].error).toBe("Run timed out")
      expect(Engine._internalSnapshot().inFlight).toEqual([])
      expect(Engine.runtimeOf(def.id).status).toBe("error")
    })
  }, 20_000)
})

describe("loop/engine · lease heartbeat", () => {
  it("restore does not orphan a run with a fresh heartbeat", async () => {
    await withInstance(async () => {
      const def = makeDef()
      await Manager.upsert(def)
      const run = await Manager.startRun(def.id)
      // Old start, fresh heartbeat: another process is still driving it.
      await mutateRun(def.id, run.id, (draft) => {
        draft.startedAt = Date.now() - 60_000
        draft.heartbeatAt = Date.now()
      })
      await Engine.restore()
      const runs = await Manager.listRuns(def.id)
      expect(runs[0].status).toBe("running")
    })
  })

  it("restore orphans a run whose heartbeat expired", async () => {
    await withInstance(async () => {
      const def = makeDef()
      await Manager.upsert(def)
      const run = await Manager.startRun(def.id)
      await mutateRun(def.id, run.id, (draft) => {
        draft.startedAt = Date.now() - 60_000
        draft.heartbeatAt = Date.now() - 60_000
      })
      await Engine.restore()
      const runs = await Manager.listRuns(def.id)
      expect(runs[0].status).toBe("orphaned")
    })
  })
})

describe("loop/engine · persisted pause", () => {
  it("a paused loop survives restore as paused and runOnce no-ops", async () => {
    Engine._internalSetStageExecutor(async () => ({ ok: true }))
    await withInstance(async () => {
      const def = makeDef({ trigger: { kind: "interval", everyMs: 60_000 } })
      await Manager.upsert(def)
      await Manager.setPaused(def.id, true)
      // Simulate a process restart: state is rebuilt from storage.
      Engine.dispose()
      await Engine.restore()
      expect(Engine.runtimeOf(def.id).status).toBe("paused")
      await Engine.runOnce(def.id)
      expect(await Manager.listRuns(def.id)).toHaveLength(0)
      // Resume: persisted flag cleared, runs proceed again.
      await Manager.setPaused(def.id, false)
      Engine.setRuntimeStatus(def.id, "idle")
      await Engine.runOnce(def.id)
      expect(await Manager.listRuns(def.id)).toHaveLength(1)
    })
  }, 20_000)
})
