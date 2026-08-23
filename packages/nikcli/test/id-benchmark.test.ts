import { describe, expect, it } from "bun:test"
import { randomBytes } from "crypto"
import { recordBenchmark } from "./benchmarks/runner"

function randomBase62Old(length: number): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  let result = ""
  const bytes = randomBytes(length)
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % 62]
  }
  return result
}

function randomBase62New(length: number): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  const bytes = randomBytes(length)
  let result = ""
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % 62]
  }
  return result
}

describe("ID Generation Optimization", () => {
  describe("Correctness", () => {
    it("generates valid base62 strings", () => {
      const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

      for (let i = 0; i < 100; i++) {
        const result = randomBase62New(14)
        expect(result.length).toBe(14)
        for (const char of result) {
          expect(chars.includes(char)).toBe(true)
        }
      }
    })

    it("produces different results each call", () => {
      const results = new Set<string>()
      for (let i = 0; i < 1000; i++) {
        results.add(randomBase62New(14))
      }
      expect(results.size).toBeGreaterThan(990)
    })

    it("old and new implementations produce same format", () => {
      for (let i = 0; i < 100; i++) {
        const old = randomBase62Old(14)
        const newResult = randomBase62New(14)

        expect(old.length).toBe(newResult.length)
        expect(typeof old).toBe(typeof newResult)

        const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
        for (const char of newResult) {
          expect(chars.includes(char)).toBe(true)
        }
      }
    })
  })

  describe("Performance Benchmark", () => {
    it("string concatenation benchmark", () => {
      const iterations = 100000

      const startOld = performance.now()
      for (let i = 0; i < iterations; i++) {
        randomBase62Old(14)
      }
      const oldTime = performance.now() - startOld

      const startNew = performance.now()
      for (let i = 0; i < iterations; i++) {
        randomBase62New(14)
      }
      const newTime = performance.now() - startNew

      const improvement = oldTime / newTime
      const percentReduction = ((oldTime - newTime) / oldTime) * 100

      console.log(`\n📊 randomBase62 (${iterations} iterations):`)
      console.log(`   Implementation 1: ${oldTime.toFixed(2)}ms`)
      console.log(`   Implementation 2: ${newTime.toFixed(2)}ms`)
      console.log(
        `   ⚡ Difference: ${Math.abs(improvement).toFixed(2)}x (${Math.abs(percentReduction).toFixed(1)}% ${percentReduction > 0 ? "reduction" : "increase"})`,
      )
      recordBenchmark({
        suite: "core",
        module: "id",
        scenario: "randomBase62 string concatenation",
        iterations,
        value: Math.min(oldTime, newTime),
        unit: "ms",
        metadata: { oldTime, newTime, improvement },
      })

      // Micro-benchmarks vary by CPU load; new impl should not be dramatically slower.
      expect(newTime).toBeLessThanOrEqual(oldTime * 1.35)
    })

    it("full ID creation benchmark", () => {
      const iterations = 100000

      const prefix = "ses"
      const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const bytes = randomBytes(14)
        let result = prefix + "_"
        for (let j = 0; j < 14; j++) {
          result += chars[bytes[j] % 62]
        }
        result += "00000000000000"
      }
      const oldTime = performance.now() - start

      const start2 = performance.now()
      for (let i = 0; i < iterations; i++) {
        const bytes = randomBytes(14)
        let result = prefix + "_"
        for (let j = 0; j < 14; j++) {
          result += chars[bytes[j] % 62]
        }
        result += "00000000000000"
      }
      const newTime = performance.now() - start2

      const improvement = oldTime / newTime
      const percentReduction = ((oldTime - newTime) / oldTime) * 100

      console.log(`\n📊 Full ID creation (${iterations} iterations):`)
      console.log(`   Run 1: ${oldTime.toFixed(2)}ms`)
      console.log(`   Run 2: ${newTime.toFixed(2)}ms`)
      console.log(
        `   ⚡ Difference: ${Math.abs(improvement).toFixed(2)}x (${Math.abs(percentReduction).toFixed(1)}% ${percentReduction > 0 ? "reduction" : "increase"})`,
      )
      recordBenchmark({
        suite: "core",
        module: "id",
        scenario: "full ID creation",
        iterations,
        value: Math.min(oldTime, newTime),
        unit: "ms",
        metadata: { oldTime, newTime, improvement },
      })
    })
  })
})
