import { describe, expect, it } from "bun:test"
import { fn } from "@/util/fn"
import z from "zod"
import { recordBenchmark } from "../benchmarks/runner"

describe("fn Benchmark", () => {
  describe("validation overhead", () => {
    it("parse vs no-parse comparison", () => {
      const schema = z.object({
        id: z.string(),
        name: z.string(),
        count: z.number(),
      })

      const wrapped = fn(schema, (input) => input.name)

      const iterations = 100000

      // Without validation
      const startNoVal = performance.now()
      for (let i = 0; i < iterations; i++) {
        const input = { id: "1", name: "test", count: i }
        input.name // Direct access
      }
      const noValTime = performance.now() - startNoVal

      // With validation
      const startVal = performance.now()
      for (let i = 0; i < iterations; i++) {
        const input = { id: "1", name: "test", count: i }
        wrapped(input)
      }
      const valTime = performance.now() - startVal

      console.log(`\n📊 fn validation overhead (${iterations} iterations):`)
      console.log(`   Without validation: ${noValTime.toFixed(2)}ms`)
      console.log(`   With fn wrapper: ${valTime.toFixed(2)}ms`)
      console.log(`   Overhead: ${(valTime / noValTime).toFixed(2)}x`)

      recordBenchmark({
        suite: "util",
        module: "fn",
        scenario: "parse vs no-parse comparison",
        iterations,
        value: valTime,
        unit: "ms",
        metadata: { noValTime, overhead: valTime / noValTime },
      })

      expect(valTime).toBeLessThan(noValTime * 100) // Should not be more than 100x slower
    })

    it("simple schema parsing", () => {
      const schema = z.string()
      const wrapped = fn(schema, (s) => s.length)

      const iterations = 100000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        wrapped("test-string-" + i)
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 fn with simple schema (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)
      console.log(`   Ops/sec: ${((iterations / elapsed) * 1000).toFixed(0)}`)

      recordBenchmark({
        suite: "util",
        module: "fn",
        scenario: "simple schema parsing",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(5000)
    })
  })

  describe("complex schema performance", () => {
    it("nested object parsing", () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          email: z.string(),
          profile: z.object({
            avatar: z.string(),
            bio: z.string(),
          }),
        }),
        settings: z.object({
          theme: z.string(),
          notifications: z.boolean(),
        }),
      })

      const wrapped = fn(schema, (input) => input.user.name)

      const iterations = 50000
      const input = {
        user: {
          name: "Alice",
          email: "alice@example.com",
          profile: {
            avatar: "avatar.png",
            bio: "A person",
          },
        },
        settings: {
          theme: "dark",
          notifications: true,
        },
      }

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        wrapped(input)
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 fn with nested schema (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      recordBenchmark({
        suite: "util",
        module: "fn",
        scenario: "nested object parsing",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(10000)
    })

    it("array schema parsing", () => {
      const schema = z.object({
        items: z.array(
          z.object({
            id: z.string(),
            value: z.number(),
          }),
        ),
      })

      const wrapped = fn(schema, (input) => input.items.length)

      const iterations = 50000
      const input = {
        items: [
          { id: "1", value: 1 },
          { id: "2", value: 2 },
          { id: "3", value: 3 },
        ],
      }

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        wrapped(input)
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 fn with array schema (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      recordBenchmark({
        suite: "util",
        module: "fn",
        scenario: "array schema parsing",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(10000)
    })
  })

  describe("force method performance", () => {
    it("force bypasses parsing overhead", () => {
      const schema = z.object({
        complex: z.object({
          nested: z.object({
            value: z.string(),
          }),
        }),
      })

      const wrapped = fn(schema, (input) => input.complex.nested.value)

      const iterations = 100000
      const input = { complex: { nested: { value: "test" } } }

      // Normal call
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        wrapped(input)
      }
      const normalTime = performance.now() - start

      // Force call
      const startForce = performance.now()
      for (let i = 0; i < iterations; i++) {
        wrapped.force(input)
      }
      const forceTime = performance.now() - startForce

      console.log(`\n📊 fn.force vs normal (${iterations} iterations):`)
      console.log(`   Normal: ${normalTime.toFixed(2)}ms`)
      console.log(`   Force: ${forceTime.toFixed(2)}ms`)
      console.log(`   Speedup: ${(normalTime / forceTime).toFixed(2)}x`)

      recordBenchmark({
        suite: "util",
        module: "fn",
        scenario: "force vs normal comparison",
        iterations,
        value: normalTime,
        unit: "ms",
        metadata: { normalTime, forceTime, speedup: normalTime / forceTime },
      })

      // Force should be faster
      expect(forceTime).toBeLessThan(normalTime)
    })
  })

  describe("schema access", () => {
    it("schema property access overhead", () => {
      const schema = z.object({ id: z.string() })
      const wrapped = fn(schema, (input) => input.id)

      const iterations = 100000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const s = wrapped.schema
        s.parse({ id: "test" })
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 schema property access (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      recordBenchmark({
        suite: "util",
        module: "fn",
        scenario: "schema property access",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(5000)
    })
  })

  describe("callback overhead", () => {
    it("minimal callback performance", () => {
      const schema = z.object({ value: z.number() })
      const wrapped = fn(schema, (input) => input.value)

      const iterations = 100000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        wrapped({ value: i })
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 fn with minimal callback (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)
      console.log(`   Ops/sec: ${((iterations / elapsed) * 1000).toFixed(0)}`)

      recordBenchmark({
        suite: "util",
        module: "fn",
        scenario: "minimal callback",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(3000)
    })

    it("heavy callback performance", () => {
      const schema = z.object({ values: z.array(z.number()) })

      const wrapped = fn(schema, (input) => {
        let sum = 0
        for (const v of input.values) {
          sum += v * v
        }
        return sum
      })

      const iterations = 50000
      const input = { values: Array.from({ length: 100 }, (_, i) => i) }

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        wrapped(input)
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 fn with heavy callback (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      recordBenchmark({
        suite: "util",
        module: "fn",
        scenario: "heavy callback",
        iterations,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(15000)
    })
  })

  describe("batch operations", () => {
    it("multiple fn wrappers", () => {
      const schemas = [z.object({ id: z.string() }), z.object({ name: z.string() }), z.object({ count: z.number() })]

      const wrapped = schemas.map((schema) => fn(schema, (input: any) => input))

      const iterations = 50000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        wrapped[0]({ id: String(i) })
        wrapped[1]({ name: String(i) })
        wrapped[2]({ count: i })
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Multiple fn wrappers (${iterations * 3} total calls):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per batch: ${(elapsed / iterations).toFixed(4)}ms`)

      recordBenchmark({
        suite: "util",
        module: "fn",
        scenario: "multiple fn wrappers batch",
        iterations: iterations * 3,
        value: elapsed,
        unit: "ms",
      })

      expect(elapsed).toBeLessThan(10000)
    })
  })
})
