import { preserveTestEnv } from "../helpers/env"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Cause, Effect, Exit, Fiber, Schema } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-effect-instance-home-"))
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

const { InstanceRef, InstanceScope, InstanceState, WorkspaceRef } = await import("@/effect")
const { Instance } = await import("@/project/instance")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-effect-instance-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

describe("InstanceScope", () => {
  it("provides InstanceRef and InstanceState context inside an Effect boundary", async () => {
    const directory = await makeProjectDir()
    const result = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const ref = yield* InstanceRef
          const ctx = yield* InstanceState.context
          return {
            refDirectory: ref.directory,
            ctxDirectory: ctx.directory,
            projectID: ctx.project.id,
          }
        }),
      ),
    )

    expect(result.refDirectory).toBe(directory)
    expect(result.ctxDirectory).toBe(directory)
    expect(result.projectID).toBe("global")
  })

  it("provides WorkspaceRef when workspaceID is present", async () => {
    const directory = await makeProjectDir()
    const workspace = await Effect.runPromise(
      InstanceScope.with(
        { directory, workspaceID: "workspace-test" },
        Effect.gen(function* () {
          return yield* WorkspaceRef
        }),
      ),
    )

    expect(workspace.id).toBe("workspace-test")
  })

  it("exposes legacy Instance ALS reads inside the bridged effect", async () => {
    const directory = await makeProjectDir()
    const seen = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          // Legacy code paths read Instance.* from AsyncLocalStorage even when
          // invoked from inside Effect bodies — the bridge must keep that working.
          const viaSync = yield* Effect.sync(() => Instance.directory)
          const viaPromise = yield* Effect.promise(async () => Instance.directory)
          return { viaSync, viaPromise }
        }),
      ),
    )

    expect(seen.viaSync).toBe(directory)
    expect(seen.viaPromise).toBe(directory)
  })

  it("preserves typed failures across the bridge instead of squashing to Error", async () => {
    class MarkerError extends Schema.TaggedErrorClass<MarkerError>()("MarkerError", {
      detail: Schema.String,
    }) {}

    const directory = await makeProjectDir()
    const exit = await Effect.runPromiseExit(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          return yield* new MarkerError({ detail: "kept" })
        }),
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause)
      expect(failure._tag).toBe("Some")
      if (failure._tag === "Some") {
        const error = failure.value as MarkerError
        expect(error._tag).toBe("MarkerError")
        expect(error.detail).toBe("kept")
      }
    }
  })

  it("propagates interruption into the bridged effect and waits for finalizers", async () => {
    const directory = await makeProjectDir()
    let finalized = false
    let started: (() => void) | undefined
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })

    const bridged = InstanceScope.with(
      { directory },
      Effect.gen(function* () {
        yield* Effect.sync(() => started!())
        yield* Effect.never
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            finalized = true
          }),
        ),
      ),
    )

    const fiber = Effect.runFork(bridged)
    await startedPromise
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(finalized).toBe(true)
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
