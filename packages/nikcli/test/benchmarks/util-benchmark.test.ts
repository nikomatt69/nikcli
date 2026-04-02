import { describe, expect, it } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Lock } from "../../src/util/lock"
import { Log } from "../../src/util/log"
import { Token } from "../../src/util/token"
import { Hash } from "../../src/util/hash"
import { Context } from "../../src/util/context"

describe("ID Generation Benchmarks", () => {
  const prefixes = [
    "session",
    "message",
    "permission",
    "question",
    "user",
    "part",
    "pty",
    "tool",
    "dbedit",
    "workspace",
  ] as const

  describe("Identifier.create", () => {
    it("should measure performance for ascending IDs", () => {
      const iterations = 100000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Identifier.create("session", false)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Identifier.create (ascending): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for descending IDs", () => {
      const iterations = 100000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Identifier.create("session", true)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Identifier.create (descending): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance across all prefixes", () => {
      const iterations = 10000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        for (const prefix of prefixes) {
          Identifier.create(prefix, false)
        }
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round((iterations * prefixes.length) / (elapsed / 1000))
      console.log(
        `✓ Identifier.create (all prefixes): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations * prefixes.length} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })

  describe("Identifier.timestamp", () => {
    it("should measure performance for timestamp extraction", () => {
      const ids: string[] = []
      for (let i = 0; i < 10000; i++) {
        ids.push(Identifier.create("session", false))
      }
      const iterations = ids.length
      const start = performance.now()
      for (const id of ids) {
        Identifier.timestamp(id)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Identifier.timestamp: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })
})

describe("Lock Mechanism Benchmarks", () => {
  describe("Lock.write", () => {
    it("should measure performance for single write lock acquisition", async () => {
      const iterations = 1000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Lock.write(`benchmark:lock:single:${i}`)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Lock.write (single): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for concurrent write locks", async () => {
      const iterations = 1000
      const concurrency = 100
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Promise.all(
          Array.from({ length: concurrency }, (_, j) => Lock.write(`benchmark:lock:concurrent:${i}:${j}`)),
        )
      }
      const elapsed = performance.now() - start
      const totalOps = iterations * concurrency
      const opsPerSec = Math.round(totalOps / (elapsed / 1000))
      console.log(
        `✓ Lock.write (concurrent): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${totalOps} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })

  describe("Lock.read", () => {
    it("should measure performance for single read lock acquisition", async () => {
      const iterations = 50000
      const key = "benchmark:lock:read:single"
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Lock.read(key)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Lock.read (single): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for multiple concurrent readers", async () => {
      const iterations = 1000
      const concurrency = 100
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Promise.all(
          Array.from({ length: concurrency }, (_, j) => Lock.read(`benchmark:lock:read:concurrent:${i}:${j}`)),
        )
      }
      const elapsed = performance.now() - start
      const totalOps = iterations * concurrency
      const opsPerSec = Math.round(totalOps / (elapsed / 1000))
      console.log(
        `✓ Lock.read (concurrent): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${totalOps} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })
})

describe("Log Creation Benchmarks", () => {
  describe("Log.create", () => {
    it("should measure performance for logger creation (uncached)", () => {
      const iterations = 100000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Log.create({ benchmark: true, iteration: i })
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Log.create (uncached): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for logger creation (cached)", () => {
      const serviceName = "benchmark-cached-service"
      Log.create({ service: serviceName })
      const iterations = 100000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Log.create({ service: serviceName })
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Log.create (cached): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for logger methods", () => {
      const logger = Log.create({ service: "benchmark-logger-methods" })
      const iterations = 100000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        logger.info(`Benchmark message ${i}`)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Logger.info: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })
})

describe("Token Counting Benchmarks", () => {
  describe("Token.estimate", () => {
    const testStrings = [
      "short",
      "This is a medium length string for token estimation.",
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.",
      Array(100).fill("word").join(" "),
    ]

    it("should measure performance for short strings", () => {
      const iterations = 100000
      const input = testStrings[0]
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Token.estimate(input)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Token.estimate (short): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for medium strings", () => {
      const iterations = 100000
      const input = testStrings[1]
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Token.estimate(input)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Token.estimate (medium): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for long strings", () => {
      const iterations = 10000
      const input = testStrings[2]
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Token.estimate(input)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Token.estimate (long): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for very long strings", () => {
      const iterations = 1000
      const input = testStrings[3]
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Token.estimate(input)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Token.estimate (very long): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })
})

describe("Hash Functions Benchmarks", () => {
  describe("Hash.fast", () => {
    const testInputs = [
      "short",
      "medium length string for hashing",
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
      Array(50).fill("word").join(" "),
    ]

    it("should measure performance for short strings", () => {
      const iterations = 50000
      const input = testInputs[0]
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Hash.fast(input)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Hash.fast (short): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for medium strings", () => {
      const iterations = 20000
      const input = testInputs[1]
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Hash.fast(input)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Hash.fast (medium): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for long strings", () => {
      const iterations = 5000
      const input = testInputs[2]
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Hash.fast(input)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Hash.fast (long): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for Buffer input", () => {
      const iterations = 20000
      const input = Buffer.from(testInputs[1])
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Hash.fast(input)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Hash.fast (Buffer): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })
})

describe("Context Benchmarks", () => {
  describe("Context.create", () => {
    it("should measure performance for context creation", () => {
      const iterations = 100000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Context.create<string>(`benchmark-${i}`)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Context.create: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })

  describe("Context.provide and Context.use", () => {
    it("should measure performance for provide/use cycle", () => {
      const context = Context.create<string>("benchmark-context")
      const iterations = 100000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        context.provide(`value-${i}`, () => {
          return context.use()
        })
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Context.provide/use cycle: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for nested provide/use", () => {
      const context = Context.create<{ str: string; num: number }>("benchmark-nested")
      const iterations = 10000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        context.provide({ str: `value-${i}`, num: i }, () => {
          const val = context.use()
          return { ...val }
        })
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Context nested provide/use: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })
})
