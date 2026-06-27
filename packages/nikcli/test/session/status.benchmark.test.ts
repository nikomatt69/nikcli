import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Instance } from "@/project/instance"
import { SessionStatus } from "@/session/status"
import { recordBenchmark } from "../benchmarks/runner"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Effect } from "effect"
import { rmrf } from "../helpers/rmrf"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-session-status-bench-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

const projectDirs: string[] = []

async function withProject<T>(fn: () => Promise<T> | T): Promise<T> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-status-bench-project-"))
  projectDirs.push(projectDir)
  return Instance.provide({
    directory: projectDir,
    fn,
  })
}

function runStatus<A, E>(effect: Effect.Effect<A, E, SessionStatus.Service>) {
  return runPromiseWithLayer(SessionStatus.defaultLayer, withCurrentInstance(effect))
}

describe("SessionStatus benchmark", () => {
  it("records set/get loop under Instance", async () => {
    await withProject(async () => {
      const iterations = 6_000
      const start = performance.now()
      await runStatus(
        Effect.gen(function* () {
          const status = yield* SessionStatus.Service
          for (let i = 0; i < iterations; i += 1) {
            const id = `sb-${i}`
            yield* status.set(id, { type: "busy" })
            yield* status.get(id)
            yield* status.set(id, { type: "idle" })
          }
        }),
      )
      const elapsed = performance.now() - start
      recordBenchmark({
        suite: "session",
        module: "status",
        scenario: "set/get busy-idle",
        iterations,
        value: elapsed,
        unit: "ms",
      })
      expect(elapsed).toBeGreaterThanOrEqual(0)
    })
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => rmrf(dir)))
  await rmrf(testHome)
})
