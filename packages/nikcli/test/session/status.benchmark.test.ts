import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Instance } from "@/project/instance"
import { SessionStatus } from "@/session/status"
import { recordBenchmark } from "../benchmarks/runner"

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

describe("SessionStatus benchmark", () => {
  it("records set/get loop under Instance", async () => {
    await withProject(async () => {
      const iterations = 6_000
      const start = performance.now()
      for (let i = 0; i < iterations; i += 1) {
        const id = `sb-${i}`
        SessionStatus.set(id, { type: "busy" })
        SessionStatus.get(id)
        SessionStatus.set(id, { type: "idle" })
      }
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
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})
