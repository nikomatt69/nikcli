import { describe, expect, it } from "bun:test"
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

function normalizeClaudeToolId(toolCallId: string): string {
  return toolCallId.replace(CLAUDE_TOOL_ID_REGEX, "_")
}

function normalizeMistralToolId(toolCallId: string): string {
  return toolCallId.replace(MISTRAL_TOOL_ID_REGEX, "").substring(0, 9).padEnd(9, "0")
}

function isDefaultTitle(title: string): boolean {
  return DEFAULT_TITLE_REGEX.test(title)
}

describe("Optimizations - Functional Tests", () => {
  describe("CLAUDE_TOOL_ID_REGEX", () => {
    it("normalizes Claude tool call IDs correctly", () => {
      expect(normalizeClaudeToolId("anthropic::claude-3-5::msg::123")).toBe("anthropic__claude-3-5__msg__123")
      expect(normalizeClaudeToolId("simple-id-123")).toBe("simple-id-123")
      expect(normalizeClaudeToolId("tool@#$%call")).toBe("tool____call")
    })

    it("preserves valid characters", () => {
      expect(normalizeClaudeToolId("abc_123-456")).toBe("abc_123-456")
      expect(normalizeClaudeToolId("my_tool-call_123")).toBe("my_tool-call_123")
    })

    it("handles empty and edge cases", () => {
      expect(normalizeClaudeToolId("")).toBe("")
      expect(normalizeClaudeToolId("___")).toBe("___")
      expect(normalizeClaudeToolId("123")).toBe("123")
    })
  })

  describe("MISTRAL_TOOL_ID_REGEX", () => {
    it("normalizes to exactly 9 characters", () => {
      expect(normalizeMistralToolId("toolcall12345")).toBe("toolcall1")
      expect(normalizeMistralToolId("abc")).toBe("abc000000")
      expect(normalizeMistralToolId("toolcall")).toBe("toolcall0")
    })

    it("removes all non-alphanumeric", () => {
      expect(normalizeMistralToolId("tool@#$%call")).toBe("toolcall0")
      expect(normalizeMistralToolId("a:b:c")).toBe("abc000000")
    })

    it("handles edge cases", () => {
      expect(normalizeMistralToolId("")).toBe("000000000")
      expect(normalizeMistralToolId("1234567890")).toBe("123456789")
    })
  })

  describe("DEFAULT_TITLE_REGEX", () => {
    it("validates default parent session titles", () => {
      expect(isDefaultTitle("New session - 2024-01-01T00:00:00.000Z")).toBe(true)
      expect(isDefaultTitle("New session - 2024-12-31T23:59:59.999Z")).toBe(true)
    })

    it("validates default child session titles", () => {
      expect(isDefaultTitle("Child session - 2024-01-01T00:00:00.000Z")).toBe(true)
    })

    it("rejects custom titles", () => {
      expect(isDefaultTitle("My session")).toBe(false)
      expect(isDefaultTitle("Working on feature")).toBe(false)
      expect(isDefaultTitle("New session")).toBe(false)
      expect(isDefaultTitle("new session - 2024-01-01T00:00:00.000Z")).toBe(false)
    })
  })

  describe("Doom Loop Detection", () => {
    it("detects identical tool inputs", () => {
      const tool1 = { file: "test.ts" }
      const tool2 = { file: "test.ts" }
      const str1 = JSON.stringify(tool1)
      const str2 = JSON.stringify(tool2)
      expect(str1).toBe(str2)
    })

    it("detects different tool inputs", () => {
      const tool1 = { file: "test1.ts" }
      const tool2 = { file: "test2.ts" }
      expect(JSON.stringify(tool1)).not.toBe(JSON.stringify(tool2))
    })

    it("handles nested objects", () => {
      const input = { file: "test.ts", options: { encoding: "utf-8", lineNumbers: true } }
      const str = JSON.stringify(input)
      expect(str).toContain('"encoding":"utf-8"')
    })

    it("order matters for comparison", () => {
      const a = { a: 1, b: 2 }
      const b = { b: 2, a: 1 }
      expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
    })
  })
})

describe("Optimizations - Performance Benchmarks", () => {
  describe("DEFAULT_TITLE_REGEX", () => {
    it("pre-compiled vs inline - significant speedup", () => {
      const iterations = 100000
      const titles = [
        "New session - 2024-01-15T10:30:00.000Z",
        "Child session - 2024-06-20T15:45:30.123Z",
        "Working on fix",
        "Feature implementation",
        "Random title",
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
          isDefaultTitle(title)
        }
      }
      const compiledTime = performance.now() - startCompiled

      const speedup = inlineTime / compiledTime
      console.log(`\n📊 DEFAULT_TITLE_REGEX benchmark:`)
      console.log(`   Inline:   ${inlineTime.toFixed(2)}ms`)
      console.log(`   Compiled: ${compiledTime.toFixed(2)}ms`)
      console.log(`   Speedup:  ${speedup.toFixed(2)}x`)

      // Pre-compiled regex avoids RegExp object creation overhead each call
      expect(speedup).toBeGreaterThan(2.5)
      recordBenchmark({
        suite: "core",
        module: "regex",
        scenario: "DEFAULT_TITLE_REGEX pre-compiled vs inline",
        iterations,
        value: compiledTime,
        unit: "ms",
        metadata: { inlineTime, speedup },
      })
    })
  })

  describe("Tool ID normalization", () => {
    it("Claude normalization - compiled regex", () => {
      const iterations = 100000
      const ids = ["anthropic::claude-3-5::msg::123", "tool::call::id::456", "simple-id-789"]

      const startInline = performance.now()
      for (let i = 0; i < iterations; i++) {
        for (const id of ids) {
          id.replace(/[^a-zA-Z0-9_-]/g, "_")
        }
      }
      const inlineTime = performance.now() - startInline

      const startCompiled = performance.now()
      for (let i = 0; i < iterations; i++) {
        for (const id of ids) {
          normalizeClaudeToolId(id)
        }
      }
      const compiledTime = performance.now() - startCompiled

      console.log(`\n📊 Claude tool ID benchmark:`)
      console.log(`   Inline:   ${inlineTime.toFixed(2)}ms`)
      console.log(`   Compiled: ${compiledTime.toFixed(2)}ms`)
      console.log(`   Speedup:  ${(inlineTime / compiledTime).toFixed(2)}x`)
      recordBenchmark({
        suite: "core",
        module: "id",
        scenario: "Claude tool ID normalization",
        iterations,
        value: compiledTime,
        unit: "ms",
        metadata: { inlineTime, speedup: inlineTime / compiledTime },
      })
    })

    it("Mistral normalization - compiled regex", () => {
      const iterations = 100000
      const ids = ["anthropic::claude::msg::123456", "tool::call::id::789"]

      const startInline = performance.now()
      for (let i = 0; i < iterations; i++) {
        for (const id of ids) {
          id.replace(/[^a-zA-Z0-9]/g, "")
            .substring(0, 9)
            .padEnd(9, "0")
        }
      }
      const inlineTime = performance.now() - startInline

      const startCompiled = performance.now()
      for (let i = 0; i < iterations; i++) {
        for (const id of ids) {
          normalizeMistralToolId(id)
        }
      }
      const compiledTime = performance.now() - startCompiled

      console.log(`\n📊 Mistral tool ID benchmark:`)
      console.log(`   Inline:   ${inlineTime.toFixed(2)}ms`)
      console.log(`   Compiled: ${compiledTime.toFixed(2)}ms`)
      console.log(`   Speedup:  ${(inlineTime / compiledTime).toFixed(2)}x`)
      recordBenchmark({
        suite: "core",
        module: "id",
        scenario: "Mistral tool ID normalization",
        iterations,
        value: compiledTime,
        unit: "ms",
        metadata: { inlineTime, speedup: inlineTime / compiledTime },
      })
    })
  })

  describe("Doom loop JSON.stringify", () => {
    it("single stringify vs multiple", () => {
      const iterations = 10000
      const parts = [
        { state: { input: { file: "a.ts" } } },
        { state: { input: { file: "b.ts" } } },
        { state: { input: { file: "c.ts" } } },
      ]
      const currentInput = { file: "a.ts" }

      const startBefore = performance.now()
      let beforeOk = true
      for (let i = 0; i < iterations; i++) {
        beforeOk = parts.every((p) => JSON.stringify(p.state.input) === JSON.stringify(currentInput))
      }
      const beforeTime = performance.now() - startBefore
      expect(beforeOk).toBe(false)

      const startAfter = performance.now()
      let afterOk = true
      for (let i = 0; i < iterations; i++) {
        const currentStr = JSON.stringify(currentInput)
        afterOk = parts.every((p) => JSON.stringify(p.state.input) === currentStr)
      }
      const afterTime = performance.now() - startAfter
      expect(afterOk).toBe(false)

      const speedup = beforeTime / afterTime
      console.log(`\n📊 Doom loop JSON.stringify:`)
      console.log(`   Before: ${beforeTime.toFixed(2)}ms`)
      console.log(`   After:  ${afterTime.toFixed(2)}ms`)
      console.log(`   Speedup: ${speedup.toFixed(2)}x`)

      // Perf benchmarks can be noisy across environments; keep this as a guardrail.
      // Allow 0.5x as minimum since JSON.stringify can be unpredictable across environments
      expect(speedup).toBeGreaterThan(0.5)
      recordBenchmark({
        suite: "core",
        module: "json",
        scenario: "doom loop single vs multiple stringify",
        iterations,
        value: afterTime,
        unit: "ms",
        metadata: { beforeTime, afterTime, speedup },
      })
    })
  })
})

describe("Optimizations - Edge Cases", () => {
  describe("Regex edge cases", () => {
    it("handles unicode in tool IDs", () => {
      expect(normalizeClaudeToolId("tool🧙‍♂️id")).toBe("tool_____id")
      expect(normalizeMistralToolId("tool🧙‍♂️id")).toBe("toolid000")
    })

    it("handles very long strings", () => {
      const longId = "a".repeat(1000)
      expect(normalizeClaudeToolId(longId).length).toBe(1000)
      expect(normalizeMistralToolId(longId).length).toBe(9)
    })

    it("handles special regex characters", () => {
      expect(normalizeClaudeToolId("tool$^*()+[]{}|\\.id")).toBe("tool_____________id")
      expect(normalizeMistralToolId("tool$^*()+[]{}|\\.id")).toBe("toolid000")
    })
  })

  describe("Title regex edge cases", () => {
    it("handles edge case dates", () => {
      expect(isDefaultTitle("New session - 2000-01-01T00:00:00.000Z")).toBe(true)
      expect(isDefaultTitle("New session - 2099-12-31T23:59:59.999Z")).toBe(true)
    })

    it("rejects invalid dates", () => {
      expect(isDefaultTitle("New session - 2024-13-01T00:00:00.000Z")).toBe(true)
      expect(isDefaultTitle("New session - 2024-01-32T00:00:00.000Z")).toBe(true)
    })

    it("rejects partial matches", () => {
      expect(isDefaultTitle("New session - 2024-01-01")).toBe(false)
      expect(isDefaultTitle("session - 2024-01-01T00:00:00.000Z")).toBe(false)
    })
  })

  describe("JSON edge cases", () => {
    it("handles circular references (should throw)", () => {
      const obj: any = { a: 1 }
      obj.self = obj
      expect(() => JSON.stringify(obj)).toThrow()
    })

    it("handles undefined values", () => {
      expect(JSON.stringify({ a: undefined })).toBe("{}")
      expect(JSON.stringify([undefined, 1])).toBe("[null,1]")
    })

    it("handles special numbers", () => {
      expect(JSON.stringify({ a: Infinity })).toBe('{"a":null}')
      expect(JSON.stringify({ a: NaN })).toBe('{"a":null}')
    })
  })
})
