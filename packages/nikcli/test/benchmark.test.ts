import { describe, it } from "bun:test"
import { recordBenchmark } from "./benchmarks/runner"

const CLAUDE_TOOL_ID_REGEX = /[^a-zA-Z0-9_-]/g
const MISTRAL_TOOL_ID_REGEX = /[^a-zA-Z0-9]/g

const DEFAULT_TITLE_REGEX = new RegExp(
  `^(New session - |Child session - )\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
)

const PARENT_TITLE_PREFIX = "New session - "
const CHILD_TITLE_PREFIX = "Child session - "

function inlineDefaultTitleRegex(title: string) {
  return new RegExp(
    `^(${PARENT_TITLE_PREFIX}|${CHILD_TITLE_PREFIX})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
  ).test(title)
}

describe("Performance Benchmark", () => {
  describe("DEFAULT_TITLE_REGEX optimization (the big win)", () => {
    it("inline vs pre-compiled", () => {
      const iterations = 100000
      const titles = [
        "New session - 2024-01-15T10:30:00.000Z",
        "Child session - 2024-06-20T15:45:30.123Z",
        "New session - 2024-12-31T23:59:59.999Z",
        "random title",
        "My custom session",
      ]

      const startInline = performance.now()
      for (let i = 0; i < iterations; i++) {
        for (const title of titles) {
          inlineDefaultTitleRegex(title)
        }
      }
      const inlineTime = performance.now() - startInline

      const startCompiled = performance.now()
      for (let i = 0; i < iterations; i++) {
        for (const title of titles) {
          DEFAULT_TITLE_REGEX.test(title)
        }
      }
      const compiledTime = performance.now() - startCompiled

      console.log(`\n📊 DEFAULT_TITLE_REGEX (${iterations} iterations x ${titles.length} titles):`)
      console.log(`   Inline (new RegExp each call): ${inlineTime.toFixed(2)}ms`)
      console.log(`   Pre-compiled (module constant): ${compiledTime.toFixed(2)}ms`)
      console.log(
        `   ⚡ Improvement: ${(inlineTime / compiledTime).toFixed(2)}x faster (${(((inlineTime - compiledTime) / inlineTime) * 100).toFixed(1)}% reduction)`,
      )
      recordBenchmark({
        suite: "core",
        module: "regex",
        scenario: "DEFAULT_TITLE_REGEX inline vs compiled",
        iterations: iterations * titles.length,
        value: inlineTime,
        unit: "ms",
        metadata: { compiledTime },
      })
    })
  })

  describe("doom loop JSON.stringify optimization", () => {
    it("optimized version avoids repeated stringify", () => {
      const iterations = 5000
      const parts = [
        { type: "tool", tool: "read", state: { status: "completed", input: { file: "test1.ts" } } },
        { type: "tool", tool: "read", state: { status: "completed", input: { file: "test2.ts" } } },
        { type: "tool", tool: "read", state: { status: "completed", input: { file: "test3.ts" } } },
      ]
      const currentInput = { file: "test1.ts" }

      const startBefore = performance.now()
      for (let i = 0; i < iterations; i++) {
        parts.every((p) => JSON.stringify(p.state.input) === JSON.stringify(currentInput))
      }
      const beforeTime = performance.now() - startBefore

      const startAfter = performance.now()
      for (let i = 0; i < iterations; i++) {
        const currentStr = JSON.stringify(currentInput)
        parts.every((p) => JSON.stringify(p.state.input) === currentStr)
      }
      const afterTime = performance.now() - startAfter

      console.log(`\n📊 Doom loop detection (${iterations} iterations):`)
      console.log(`   Before (stringify all + current): ${beforeTime.toFixed(2)}ms`)
      console.log(`   After (stringify current once):   ${afterTime.toFixed(2)}ms`)
      console.log(
        `   ⚡ Improvement: ${(beforeTime / afterTime).toFixed(2)}x faster (${(((beforeTime - afterTime) / beforeTime) * 100).toFixed(1)}% reduction)`,
      )
      recordBenchmark({
        suite: "core",
        module: "json",
        scenario: "doom-loop stringify optimization",
        iterations,
        value: afterTime,
        unit: "ms",
        metadata: { beforeTime },
      })
    })
  })

  describe("Real-world scenario simulation", () => {
    it("session title checking during normal operation", () => {
      const iterations = 50000
      const isDefaultTitleCalls = [
        "New session - 2024-01-15T10:30:00.000Z",
        "Child session - 2024-06-20T15:45:30.123Z",
        "Working on fix for bug #123",
        "Implementing new feature",
        "Reviewing PR #456",
      ]

      const startInline = performance.now()
      for (let i = 0; i < iterations; i++) {
        for (const title of isDefaultTitleCalls) {
          inlineDefaultTitleRegex(title)
        }
      }
      const inlineTime = performance.now() - startInline

      const startCompiled = performance.now()
      for (let i = 0; i < iterations; i++) {
        for (const title of isDefaultTitleCalls) {
          DEFAULT_TITLE_REGEX.test(title)
        }
      }
      const compiledTime = performance.now() - startCompiled

      const callsPerSecond = Math.round((iterations * isDefaultTitleCalls.length) / (compiledTime / 1000))
      console.log(`\n📊 Real-world scenario (50k sessions checking titles):`)
      console.log(`   Pre-compiled can handle: ${callsPerSecond.toLocaleString()} title checks/second`)
      console.log(`   Time saved per 50k sessions: ${(inlineTime - compiledTime).toFixed(2)}ms`)
      recordBenchmark({
        suite: "core",
        module: "regex",
        scenario: "real-world title checks per second",
        iterations: 1,
        value: callsPerSecond,
        unit: "count",
        metadata: { inlineTime, compiledTime },
      })
    })
  })
})
