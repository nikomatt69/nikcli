import "@opentui/solid/preload"
import { afterAll, beforeAll } from "bun:test"
import path from "path"
import { initialize as initGlobal } from "../src/global"
import { recordBenchmark, flushBenchmarkRun, beginBenchmarkRun } from "./benchmarks/runner"

// Keep the whole suite hermetic: skip the `bun add @nikcli-ai/plugin` bootstrap
// step, which requires the npm registry and otherwise hangs/trips timeouts when
// tests run offline. Individual tests can still override if needed.
process.env.NIKCLI_TEST_MODE ??= "1"

// Ensure global directories are created before tests run
let globalInitPromise = initGlobal()

// Make tests wait for global init before running
beforeAll(async () => {
  await globalInitPromise
})

// Detect the current test file from Bun.main
function detectTestFile(): string {
  // Try Bun.main first (available in Bun test environment)
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

  // Fallback: try process.argv[1]
  const argvPath = process.argv[1]
  if (argvPath && argvPath.includes("/test/") && argvPath.endsWith(".ts")) {
    const testIndex = argvPath.indexOf("/test/")
    return argvPath.substring(testIndex + 1)
  }

  // Fallback: try stack trace
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

// Detect the current test file
const currentTestFile = detectTestFile()

// Begin a new benchmark run for this test file (synchronous now)
beginBenchmarkRun(currentTestFile)

// Record a startup benchmark for the test file
recordBenchmark({
  suite: "test",
  module: "suite",
  scenario: "test file initialization",
  iterations: 1,
  value: 0,
  unit: "value",
  metadata: { testFile: currentTestFile, startedAt: new Date().toISOString() },
})

// Flush after all tests in this file complete
afterAll(async () => {
  await flushBenchmarkRun()
})

// Also flush on process exit to catch any remaining records
process.on("beforeExit", async () => {
  await flushBenchmarkRun()
})
