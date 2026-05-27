import { describe, expect, it } from "bun:test"
import { recordBenchmark } from "./benchmarks/runner"

const CACHE_MAX_SIZE = 100

function getRegexOld(pattern: string): RegExp {
  let escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")

  if (escaped.endsWith(" .*")) {
    escaped = escaped.slice(0, -3) + "( .*)?"
  }

  return new RegExp("^" + escaped + "$", "s")
}

function matchOld(str: string, pattern: string): boolean {
  return getRegexOld(pattern).test(str)
}

const regexCache = new Map<string, RegExp>()

function getRegexNew(pattern: string): RegExp {
  let regex = regexCache.get(pattern)
  if (regex) return regex

  if (regexCache.size >= CACHE_MAX_SIZE) {
    const firstKey = regexCache.keys().next().value
    if (firstKey) regexCache.delete(firstKey)
  }

  let escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")

  let escapedWithOptional = escaped
  if (escaped.endsWith(" .*")) {
    escapedWithOptional = escaped.slice(0, -3) + "( .*)?"
  }

  regex = new RegExp("^" + escapedWithOptional + "$", "s")
  regexCache.set(pattern, regex)
  return regex
}

function matchNew(str: string, pattern: string): boolean {
  return getRegexNew(pattern).test(str)
}

describe("Wildcard Regex Caching Optimization", () => {
  describe("Correctness", () => {
    it("produces same results as uncached version", () => {
      const patterns = [
        "*.ts",
        "*.js",
        "src/**/*",
        "test/**/*.test.ts",
        "src/**/*.ts",
        "?ile.txt",
        "file?.txt",
        "*.{ts,js}",
        "**/*.json",
        "src/{foo,bar}/*",
      ]

      const strings = [
        "file.ts",
        "file.js",
        "src/index.ts",
        "src/utils/helper.ts",
        "test/unit.test.ts",
        "test/integration/api.test.ts",
        "1ile.txt",
        "file1.txt",
        "data.json",
        "config.json",
        "src/foo/file.ts",
        "src/bar/file.ts",
      ]

      for (const pattern of patterns) {
        regexCache.clear()
        for (const str of strings) {
          const oldResult = matchOld(str, pattern)
          const newResult = matchNew(str, pattern)
          expect(newResult).toBe(oldResult)
        }
      }
    })

    it("handles edge cases", () => {
      expect(matchNew("", "")).toBe(true)
      expect(matchNew("a", "")).toBe(false)
      expect(matchNew("test", "*")).toBe(true)
      expect(matchNew("test", "tes?")).toBe(true)
    })
  })

  describe("Performance Benchmark", () => {
    it("uncached vs cached regex", () => {
      const iterations = 100000
      const patterns = ["*.ts", "src/**/*.ts", "test/**/*.test.ts", "**/*.json", "?ile.txt", "**/*"]
      const strings = [
        "file.ts",
        "src/index.ts",
        "src/utils/helper.ts",
        "test/unit.test.ts",
        "config.json",
        "data.json",
        "1ile.txt",
        "anything.txt",
      ]

      regexCache.clear()
      const startOld = performance.now()
      for (let i = 0; i < iterations; i++) {
        for (const pattern of patterns) {
          for (const str of strings) {
            matchOld(str, pattern)
          }
        }
      }
      const oldTime = performance.now() - startOld

      regexCache.clear()
      const startNew = performance.now()
      for (let i = 0; i < iterations; i++) {
        for (const pattern of patterns) {
          for (const str of strings) {
            matchNew(str, pattern)
          }
        }
      }
      const newTime = performance.now() - startNew

      const improvement = oldTime / newTime
      const percentReduction = ((oldTime - newTime) / oldTime) * 100

      console.log(
        `\n📊 Wildcard regex (${iterations} iterations x ${patterns.length} patterns x ${strings.length} strings):`,
      )
      console.log(`   Uncached (new RegExp each call): ${oldTime.toFixed(2)}ms`)
      console.log(`   Cached (Map cache): ${newTime.toFixed(2)}ms`)
      console.log(`   ⚡ Improvement: ${improvement.toFixed(2)}x faster (${percentReduction.toFixed(1)}% reduction)`)
      recordBenchmark({
        suite: "core",
        module: "wildcard",
        scenario: "cached vs uncached regex",
        iterations: iterations * patterns.length * strings.length,
        value: newTime,
        unit: "ms",
        metadata: { oldTime, improvement },
      })

      expect(newTime).toBeLessThan(oldTime)
    })

    it("cache hit rate impact", () => {
      const iterations = 100000
      const patterns = ["*.ts", "*.js", "**/*.json", "src/**/*", "test/**/*"]
      const strings = ["file.ts", "file.js", "config.json", "src/index.ts", "test/test.ts"]

      const startOld = performance.now()
      for (let i = 0; i < iterations; i++) {
        for (let j = 0; j < patterns.length; j++) {
          matchOld(strings[j % strings.length], patterns[j])
        }
      }
      const oldTime = performance.now() - startOld

      const startNew = performance.now()
      for (let i = 0; i < iterations; i++) {
        for (let j = 0; j < patterns.length; j++) {
          matchNew(strings[j % strings.length], patterns[j])
        }
      }
      const newTime = performance.now() - startNew

      const improvement = oldTime / newTime

      console.log(`\n📊 Cache hit rate test (${iterations} iterations):`)
      console.log(`   Uncached: ${oldTime.toFixed(2)}ms`)
      console.log(`   Cached: ${newTime.toFixed(2)}ms`)
      console.log(`   ⚡ Improvement: ${improvement.toFixed(2)}x faster`)
      recordBenchmark({
        suite: "core",
        module: "wildcard",
        scenario: "cache hit rate impact",
        iterations: iterations * patterns.length,
        value: newTime,
        unit: "ms",
        metadata: { oldTime, improvement },
      })
    })
  })
})
