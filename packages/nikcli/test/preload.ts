import "@opentui/solid/preload"
import { afterAll, afterEach, beforeAll } from "bun:test"
import path from "path"
import { initialize as initGlobal } from "@nikcli-ai/util/global"
import { setTestEnvBaseline } from "./helpers/env"

// Keep the whole suite hermetic: skip the `bun add @nikcli-ai/plugin` bootstrap
// step, which requires the npm registry and otherwise hangs/trips timeouts when
// tests run offline. Individual tests can still override if needed.
process.env.NIKCLI_TEST_MODE ??= "1"
process.env.NIKCLI_DISABLE_WAL_CHECKPOINT ??= "1"
setTestEnvBaseline()

// Ensure global directories are created before tests run
let globalInitPromise = initGlobal()

// Make tests wait for global init before running
beforeAll(async () => {
  await globalInitPromise
})

// CLI command tests intentionally exercise failure paths that set exitCode.
// Do not let that process-global signal leak into Bun's suite result.
afterEach(() => {
  process.exitCode = 0
})

// Benchmark bookkeeping is opt-in via `NIKCLI_TEST_BENCH=1`. Without the
// flag, the default unit suite stays lean — no benchmark DB writes, no
// `beforeExit` listener — which both speeds up the PR suite and reduces
// the surface area for SQLite I/O races that were triggering segfaults
// on Bun 1.3.14.
if (process.env.NIKCLI_TEST_BENCH === "1") {
  const { recordBenchmark, flushBenchmarkRun, beginBenchmarkRun } = await import("./benchmarks/runner")

  // Detect the current test file from Bun.main
  function detectTestFile(): string {
    const bunMain = typeof Bun !== "undefined" && Bun.main
    if (bunMain && typeof bunMain === "string") {
      const filePath = bunMain.replace(/\\/g, "/")
      if (filePath.includes("/test/") && filePath.endsWith(".ts")) {
        const testIndex = filePath.indexOf("/test/")
        return filePath.substring(testIndex + 1)
      }
      if (filePath.endsWith(".test.ts")) {
        return path.basename(filePath)
      }
    }

    const argvPath = process.argv[1]
    if (argvPath && argvPath.includes("/test/") && argvPath.endsWith(".ts")) {
      const testIndex = argvPath.indexOf("/test/")
      return argvPath.substring(testIndex + 1)
    }

    const stack = new Error().stack ?? ""
    const lines = stack.split("\n")
    for (const line of lines) {
      if (line.includes("test/benchmarks/") || line.includes("preload.ts")) continue
      const match = line.match(/at\s+(.+?)\s+\(/)?.[1] ?? line.match(/\((.+)\)/)?.[1]
      if (match) {
        const filePath = match.replace(/\\/g, "/")
        const testMatch = filePath.match(/([^/]+\.test\.ts)$/)
        if (testMatch) {
          if (filePath.includes("/test/")) {
            const testIndex = filePath.indexOf("/test/")
            return filePath.substring(testIndex + 1)
          }
          return testMatch[1]
        }
      }
    }
    return "unknown"
  }

  const currentTestFile = detectTestFile()
  beginBenchmarkRun(currentTestFile)
  recordBenchmark({
    suite: "test",
    module: "suite",
    scenario: "test file initialization",
    iterations: 1,
    value: 0,
    unit: "value",
    metadata: {
      testFile: currentTestFile,
      startedAt: new Date().toISOString(),
    },
  })
  afterAll(async () => {
    await flushBenchmarkRun()
  })
  process.on("beforeExit", async () => {
    await flushBenchmarkRun()
  })
}
