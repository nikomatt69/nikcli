import { describe, expect, it } from "bun:test"
import { Identifier } from "@/id/id"

describe("Identifier Benchmark", () => {
  describe("ascending creation", () => {
    it("100k ascending session IDs", () => {
      const iterations = 100000
      const warmup = 1000

      // Warmup
      for (let i = 0; i < warmup; i++) {
        Identifier.ascending("session")
      }

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Identifier.ascending("session")
      }
      const elapsed = performance.now() - start
      const perOp = elapsed / iterations

      console.log(`\n📊 Identifier.ascending (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${perOp.toFixed(4)}ms`)
      console.log(`   Ops/sec: ${((iterations / elapsed) * 1000).toFixed(0)}`)

      // Should be fast - under 2ms per operation
      expect(perOp).toBeLessThan(0.002)
    })

    it("100k ascending message IDs", () => {
      const iterations = 100000
      const warmup = 1000

      // Warmup
      for (let i = 0; i < warmup; i++) {
        Identifier.ascending("message")
      }

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Identifier.ascending("message")
      }
      const elapsed = performance.now() - start
      const perOp = elapsed / iterations

      console.log(`\n📊 Identifier.ascending message (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${perOp.toFixed(4)}ms`)

      expect(perOp).toBeLessThan(0.001)
    })
  })

  describe("descending creation", () => {
    it("100k descending session IDs", () => {
      const iterations = 100000
      const warmup = 1000

      // Warmup
      for (let i = 0; i < warmup; i++) {
        Identifier.descending("session")
      }

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Identifier.descending("session")
      }
      const elapsed = performance.now() - start
      const perOp = elapsed / iterations

      console.log(`\n📊 Identifier.descending (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${perOp.toFixed(4)}ms`)
      console.log(`   Ops/sec: ${((iterations / elapsed) * 1000).toFixed(0)}`)

      expect(perOp).toBeLessThan(0.002)
    })
  })

  describe("ascending vs descending", () => {
    it("compare performance overhead", () => {
      const iterations = 100000

      const startAsc = performance.now()
      for (let i = 0; i < iterations; i++) {
        Identifier.ascending("session")
      }
      const ascTime = performance.now() - startAsc

      const startDesc = performance.now()
      for (let i = 0; i < iterations; i++) {
        Identifier.descending("session")
      }
      const descTime = performance.now() - startDesc

      const overhead = descTime / ascTime

      console.log(`\n📊 ascending vs descending comparison (${iterations} iterations):`)
      console.log(`   Ascending: ${ascTime.toFixed(2)}ms`)
      console.log(`   Descending: ${descTime.toFixed(2)}ms`)
      console.log(`   Overhead: ${overhead.toFixed(2)}x`)

      // Descending should not be significantly slower
      expect(overhead).toBeLessThan(1.5)
    })
  })

  describe("timestamp extraction", () => {
    it("extract timestamp from ID", () => {
      const iterations = 100000
      const warmup = 1000

      // Create IDs first
      const ids: string[] = []
      for (let i = 0; i < 100; i++) {
        ids.push(Identifier.descending("session"))
      }

      // Warmup
      for (let i = 0; i < warmup; i++) {
        Identifier.timestamp(ids[0])
      }

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Identifier.timestamp(ids[i % ids.length])
      }
      const elapsed = performance.now() - start
      const perOp = elapsed / iterations

      console.log(`\n📊 Identifier.timestamp (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${perOp.toFixed(4)}ms`)

      expect(perOp).toBeLessThan(0.001)
    })

    it("extract timestamp from multiple IDs", () => {
      const iterations = 10000
      const ids: string[] = []
      for (let i = 0; i < iterations; i++) {
        ids.push(Identifier.descending("message"))
      }

      const start = performance.now()
      for (const id of ids) {
        Identifier.timestamp(id)
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Extract ${iterations} timestamps:`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      expect(elapsed).toBeLessThan(100) // Should be under 100ms for 10k extractions
    })
  })

  describe("schema validation", () => {
    it("validate session schema", () => {
      const iterations = 100000
      const schema = Identifier.schema("session")

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        schema.parse("ses_abc123def456ghi789jkl012")
      }
      const elapsed = performance.now() - start
      const perOp = elapsed / iterations

      console.log(`\n📊 Schema.parse (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${perOp.toFixed(4)}ms`)

      expect(perOp).toBeLessThan(0.001)
    })
  })

  describe("randomBase62 generation", () => {
    it("stress test unique ID generation", () => {
      const iterations = 50000
      const ids = new Set<string>()

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        ids.add(Identifier.ascending("session"))
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Unique ID generation (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Unique: ${ids.size}`)

      // Should generate all unique IDs
      expect(ids.size).toBe(iterations)
      expect(elapsed).toBeLessThan(1000) // Under 1 second for 50k IDs
    })
  })

  describe("create function", () => {
    it("create with explicit timestamp", () => {
      const iterations = 100000
      const timestamp = 1609459200000

      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Identifier.create("session", false, timestamp + i)
      }
      const elapsed = performance.now() - start

      console.log(`\n📊 Identifier.create with explicit timestamp (${iterations} iterations):`)
      console.log(`   Total: ${elapsed.toFixed(2)}ms`)
      console.log(`   Per op: ${(elapsed / iterations).toFixed(4)}ms`)

      expect(elapsed).toBeLessThan(1000)
    })

    it("create ascending vs descending", () => {
      const iterations = 100000
      const timestamp = Date.now()

      const startAsc = performance.now()
      for (let i = 0; i < iterations; i++) {
        Identifier.create("workspace", false, timestamp + i)
      }
      const ascTime = performance.now() - startAsc

      const startDesc = performance.now()
      for (let i = 0; i < iterations; i++) {
        Identifier.create("workspace", true, timestamp + i)
      }
      const descTime = performance.now() - startDesc

      console.log(`\n📊 create ascending vs descending (${iterations} iterations):`)
      console.log(`   Ascending: ${ascTime.toFixed(2)}ms`)
      console.log(`   Descending: ${descTime.toFixed(2)}ms`)
      console.log(`   Ratio: ${(descTime / ascTime).toFixed(2)}x`)

      expect(descTime).toBeLessThan(ascTime * 2) // Should not be more than 2x slower
    })
  })
})
