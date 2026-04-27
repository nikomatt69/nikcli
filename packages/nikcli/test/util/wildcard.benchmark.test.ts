import { describe, expect, it } from "bun:test"
import { Wildcard } from "@/util/wildcard"

describe("Wildcard Benchmark", () => {
  describe("match performance", () => {
    it("simple string comparison", () => {
      const iterations = 100000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Wildcard.match("exact-match", "exact-match")
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Wildcard.match exact (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)
      console.log(`   Ops/sec: ${((iterations / elapsed) * 1000).toFixed(0)}`)

      expect(elapsed).toBeLessThan(5000)
    })

    it("simple wildcard pattern", () => {
      const iterations = 100000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Wildcard.match("test-value", "test-*")
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Wildcard.match with * (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      expect(elapsed).toBeLessThan(10000)
    })

    it("regex escaping overhead", () => {
      const iterations = 50000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Wildcard.match("file.name.with.dots.txt", "*.txt")
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Wildcard.match with special chars (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      expect(elapsed).toBeLessThan(10000)
    })
  })

  describe("cache efficiency", () => {
    it("repeated same pattern", () => {
      const iterations = 100000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Wildcard.match("test-value", "test-*")
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Repeated wildcard pattern (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      expect(elapsed).toBeLessThan(15000)
    })
  })

  describe("all function performance", () => {
    it("small patterns object", () => {
      const patterns = {
        exact: "exact",
        "prefix-*": "prefix",
        "*": "default",
      }

      const iterations = 100000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Wildcard.all("exact", patterns)
        Wildcard.all("prefix-value", patterns)
        Wildcard.all("other", patterns)
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Wildcard.all with 3 patterns (${iterations * 3} calls):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per call: ${(elapsed / (iterations * 3)).toFixed(4)}ms`)

      expect(elapsed).toBeLessThan(15000)
    })

    it("large patterns object", () => {
      const patterns: Record<string, string> = {}
      for (let i = 0; i < 100; i++) {
        patterns[`pattern${i}-*`] = `value${i}`
      }
      patterns["*"] = "default"

      const iterations = 10000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Wildcard.all("pattern50-value", patterns)
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Wildcard.all with 100 patterns (${iterations} calls):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per call: ${(elapsed / iterations).toFixed(4)}ms`)

      expect(elapsed).toBeLessThan(15000)
    })
  })

  describe("allStructured performance", () => {
    it("head + tail matching", () => {
      const patterns = {
        "git add *": "git-add",
        "git commit *": "git-commit",
        "git *": "git-generic",
      }

      const iterations = 50000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Wildcard.allStructured({ head: "git", tail: ["add", "file"] }, patterns)
        Wildcard.allStructured({ head: "git", tail: ["commit"] }, patterns)
        Wildcard.allStructured({ head: "npm", tail: ["install"] }, patterns)
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Wildcard.allStructured (${iterations * 3} calls):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per call: ${(elapsed / (iterations * 3)).toFixed(4)}ms`)

      expect(elapsed).toBeLessThan(15000)
    })

    it("deep tail sequences", () => {
      const patterns = {
        "cmd * * *": "deep",
      }

      const iterations = 50000
      const input = { head: "cmd", tail: ["a", "b", "c", "d", "e"] }

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Wildcard.allStructured(input, patterns)
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 allStructured with deep tail (${iterations} calls):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per call: ${(elapsed / iterations).toFixed(4)}ms`)

      expect(elapsed).toBeLessThan(15000)
    })
  })

  describe("pattern complexity impact", () => {
    it("simple pattern vs complex pattern", () => {
      const iterations = 50000

      // Simple pattern
      const startSimple = performance.now()
      for (let i = 0; i < iterations; i++) {
        Wildcard.match("test-value", "*")
      }
      const simpleTime = performance.now() - startSimple

      // Complex pattern with many wildcards
      const startComplex = performance.now()
      for (let i = 0; i < iterations; i++) {
        Wildcard.match("test-value", "test-*")
      }
      const complexTime = performance.now() - startComplex

      console.log(`\n📊 Pattern complexity comparison (${iterations} iterations):`)
      console.log(`   Simple (*): ${simpleTime.toFixed(2)}ms`)
      console.log(`   Complex (test-*): ${complexTime.toFixed(2)}ms`)
      console.log(`   Ratio: ${(complexTime / simpleTime).toFixed(2)}x`)

      expect(complexTime).toBeLessThan(simpleTime * 10) // Should not be more than 10x slower
    })
  })

  describe("matchSequence performance", () => {
    it("empty tail matching", () => {
      const patterns = {
        cmd: "cmd-only",
        "cmd *": "cmd-with-args",
      }

      const iterations = 100000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Wildcard.allStructured({ head: "cmd", tail: [] }, patterns)
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Empty tail matching (${iterations} calls):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per call: ${(elapsed / iterations).toFixed(4)}ms`)

      expect(elapsed).toBeLessThan(10000)
    })

    it("multiple tail items", () => {
      const patterns = {
        "cmd * * * *": "max-args",
      }

      const iterations = 50000
      const input = { head: "cmd", tail: ["a", "b", "c", "d"] }

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Wildcard.allStructured(input, patterns)
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 4-item tail matching (${iterations} calls):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per call: ${(elapsed / iterations).toFixed(4)}ms`)

      expect(elapsed).toBeLessThan(15000)
    })
  })

  describe("batch operations", () => {
    it("multiple matches in batch", () => {
      const patterns = ["a*", "b*", "c*", "d*", "e*"]
      const values = ["apple", "banana", "cherry", "date", "elderberry"]

      const iterations = 20000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        for (let j = 0; j < patterns.length; j++) {
          Wildcard.match(values[j], patterns[j])
        }
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Batch matches (${iterations * patterns.length} calls):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per call: ${(elapsed / (iterations * patterns.length)).toFixed(4)}ms`)

      expect(elapsed).toBeLessThan(15000)
    })
  })
})
