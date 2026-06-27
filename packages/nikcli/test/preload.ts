import "@opentui/solid/preload"
import { afterAll, beforeAll } from "bun:test"
import path from "path"
import fsPromises from "fs/promises"
import { createRequire } from "module"
import { initialize as initGlobal } from "../src/global"
import { recordBenchmark, flushBenchmarkRun, beginBenchmarkRun } from "./benchmarks/runner"

// Windows releases file handles (SQLite DBs, watchers) asynchronously after an
// Instance is disposed, so an `afterAll` that `fs.rm`s its temp dir
// intermittently throws EBUSY/ENOTEMPTY/EPERM/EACCES and fails an otherwise
// green test file. This is pure CI flakiness, and it can hit any test that
// creates an Instance — not a fixed set of files — so patch fs.rm once here,
// process-wide and test-only, to retry on those transient lock codes. After the
// final retry a still-locked throwaway dir (force:true) is swallowed rather than
// thrown: the OS reclaims the temp dir later and failing cleanup is exactly the
// flake we're removing. Non-lock errors are always surfaced. No-op on platforms
// that never raise these codes (Linux/macOS).
;(() => {
  const LOCK = new Set(["EBUSY", "ENOTEMPTY", "EPERM", "EACCES"])
  const withRetry = (orig: (target: any, options?: any) => Promise<void>) =>
    async function rmWithRetry(target: any, options?: any) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await orig(target, options)
        } catch (err) {
          const code = (err as NodeJS.ErrnoException)?.code
          if (!code || !LOCK.has(code) || attempt >= 11) {
            if (code && LOCK.has(code) && options?.force) return // give up on a throwaway dir
            throw err
          }
          await new Promise((resolve) => setTimeout(resolve, Math.min(50 * (attempt + 1), 400)))
        }
      }
    }
  const patch = (holder: any) => {
    if (!holder || typeof holder.rm !== "function" || holder.rm.__rmRetry) return
    const wrapped = withRetry(holder.rm.bind(holder)) as typeof holder.rm & { __rmRetry?: boolean }
    wrapped.__rmRetry = true
    try {
      holder.rm = wrapped
    } catch {
      // readonly binding (e.g. ESM namespace) — skip; the default-import object below covers callers
    }
  }
  const req = createRequire(import.meta.url)
  const safeReq = (id: string) => {
    try {
      return req(id)
    } catch {
      return undefined
    }
  }
  // Test files use `import fs from "fs/promises"` (default object) almost
  // exclusively; also patch the require/node: variants so the few stragglers
  // and `require("fs").promises` are covered.
  patch(fsPromises)
  patch(safeReq("fs/promises"))
  patch(safeReq("node:fs/promises"))
  patch(safeReq("fs")?.promises)
})()

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
