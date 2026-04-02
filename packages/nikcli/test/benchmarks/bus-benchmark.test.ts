import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import { randomBytes } from "crypto"
import { mkdirSync, rmSync } from "fs"
import { join } from "path"
import { Bus } from "../../src/bus/index"
import { BusEvent } from "../../src/bus/bus-event"
import { Instance } from "../../src/project/instance"
import z from "zod"

describe("Bus Benchmark Tests", () => {
  const tempDir = join("/tmp", `nikcli-bus-bench-${randomBytes(8).toString("hex")}`)

  beforeAll(async () => {
    mkdirSync(tempDir, { recursive: true })
    await Instance.provide({
      directory: tempDir,
      fn: () => {},
    })
  })

  afterAll(async () => {
    await Instance.disposeAll()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  // Define test events (outside the instance context for benchmarking pure overhead)
  const TestEvent = BusEvent.define(
    "test.event",
    z.object({
      id: z.number(),
      message: z.string(),
      timestamp: z.number(),
    }),
  )

  const HeavyPayloadEvent = BusEvent.define(
    "test.heavy",
    z.object({
      data: z.array(
        z.object({
          id: z.number(),
          value: z.string(),
          nested: z.object({
            key: z.string(),
            items: z.array(z.number()),
          }),
        }),
      ),
    }),
  )

  // Heavy payload constant
  const heavyPayload = {
    data: Array.from({ length: 100 }, (_, i) => ({
      id: i,
      value: `value-${i}-${"x".repeat(50)}`,
      nested: {
        key: `key-${i}`,
        items: Array.from({ length: 10 }, (_, j) => j * i),
      },
    })),
  }

  // BusEvent.define() overhead - pure operation, no context needed
  describe("BusEvent.define() overhead", () => {
    it("define simple event", () => {
      const iterations = 5000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        BusEvent.define("bench.simple", z.object({ id: z.number() }))
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round(iterations / (elapsed / 1000))
      console.log(`\n📊 BusEvent.define() - simple:`)
      console.log(`   Iterations: ${iterations.toLocaleString()}`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)
      expect(elapsed).toBeGreaterThan(0)
    })

    it("define complex event with nested schema", () => {
      const iterations = 1000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        BusEvent.define(
          "bench.complex",
          z.object({
            users: z.array(
              z.object({
                id: z.number(),
                name: z.string(),
                profile: z.object({
                  bio: z.string(),
                  settings: z.record(z.string(), z.unknown()),
                }),
              }),
            ),
          }),
        )
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round(iterations / (elapsed / 1000))
      console.log(`\n📊 BusEvent.define() - complex nested:`)
      console.log(`   Iterations: ${iterations.toLocaleString()}`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)
      expect(elapsed).toBeGreaterThan(0)
    })

    it("define event with discriminated union", () => {
      const iterations = 1000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        BusEvent.define(
          "bench.union",
          z.discriminatedUnion("type", [
            z.object({ type: z.literal("a"), data: z.string() }),
            z.object({ type: z.literal("b"), data: z.number() }),
          ]),
        )
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round(iterations / (elapsed / 1000))
      console.log(`\n📊 BusEvent.define() - discriminated union:`)
      console.log(`   Iterations: ${iterations.toLocaleString()}`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)
      expect(elapsed).toBeGreaterThan(0)
    })
  })

  // Bus.subscribe() and Bus.publish() require instance context
  // These tests use Instance.provide() inline to ensure context is available
  describe("Bus operations with instance context", () => {
    it("subscribe single handler", async () => {
      const iterations = 5000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Instance.provide({
          directory: tempDir,
          fn: () => {
            const unsub = Bus.subscribe(TestEvent, () => {})
            unsub()
          },
        })
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round(iterations / (elapsed / 1000))
      console.log(`\n📊 Bus.subscribe() - single handler:`)
      console.log(`   Iterations: ${iterations.toLocaleString()}`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)
      expect(elapsed).toBeGreaterThan(0)
    })

    it("rapid subscribe/unsubscribe (10x)", async () => {
      const iterations = 2000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Instance.provide({
          directory: tempDir,
          fn: () => {
            for (let j = 0; j < 10; j++) {
              const unsub = Bus.subscribe(TestEvent, () => {})
              unsub()
            }
          },
        })
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations * 10) / (elapsed / 1000))
      console.log(`\n📊 Bus.subscribe() - rapid 10x:`)
      console.log(`   Iterations: ${iterations.toLocaleString()} (${(iterations * 10).toLocaleString()} total ops)`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)
      expect(elapsed).toBeGreaterThan(0)
    })

    it("publish with no handlers", async () => {
      const iterations = 3000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Instance.provide({
          directory: tempDir,
          fn: async () => {
            await Bus.publish(TestEvent, { id: 1, message: "test", timestamp: Date.now() })
          },
        })
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round(iterations / (elapsed / 1000))
      console.log(`\n📊 Bus.publish() - no handlers:`)
      console.log(`   Iterations: ${iterations.toLocaleString()}`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)
      expect(elapsed).toBeGreaterThan(0)
    })

    it("publish with single handler", async () => {
      const iterations = 2000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Instance.provide({
          directory: tempDir,
          fn: async () => {
            const unsub = Bus.subscribe(TestEvent, () => {})
            await Bus.publish(TestEvent, { id: 1, message: "test", timestamp: Date.now() })
            unsub()
          },
        })
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round(iterations / (elapsed / 1000))
      console.log(`\n📊 Bus.publish() - single handler:`)
      console.log(`   Iterations: ${iterations.toLocaleString()}`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)
      expect(elapsed).toBeGreaterThan(0)
    })

    it("publish with 5 handlers", async () => {
      const iterations = 1000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Instance.provide({
          directory: tempDir,
          fn: async () => {
            const unsubs = Array.from({ length: 5 }, () => Bus.subscribe(TestEvent, () => {}))
            await Bus.publish(TestEvent, { id: 1, message: "test", timestamp: Date.now() })
            unsubs.forEach((unsub) => unsub())
          },
        })
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round(iterations / (elapsed / 1000))
      console.log(`\n📊 Bus.publish() - 5 handlers:`)
      console.log(`   Iterations: ${iterations.toLocaleString()}`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)
      expect(elapsed).toBeGreaterThan(0)
    })

    it("publish with 10 handlers", async () => {
      const iterations = 500
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Instance.provide({
          directory: tempDir,
          fn: async () => {
            const unsubs = Array.from({ length: 10 }, () => Bus.subscribe(TestEvent, () => {}))
            await Bus.publish(TestEvent, { id: 1, message: "test", timestamp: Date.now() })
            unsubs.forEach((unsub) => unsub())
          },
        })
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round(iterations / (elapsed / 1000))
      console.log(`\n📊 Bus.publish() - 10 handlers:`)
      console.log(`   Iterations: ${iterations.toLocaleString()}`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)
      expect(elapsed).toBeGreaterThan(0)
    })

    it("publish heavy payload (100 items)", async () => {
      const iterations = 500
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Instance.provide({
          directory: tempDir,
          fn: async () => {
            const unsub = Bus.subscribe(HeavyPayloadEvent, () => {})
            await Bus.publish(HeavyPayloadEvent, heavyPayload)
            unsub()
          },
        })
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round(iterations / (elapsed / 1000))
      console.log(`\n📊 Bus.publish() - heavy payload (100 items):`)
      console.log(`   Iterations: ${iterations.toLocaleString()}`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)
      expect(elapsed).toBeGreaterThan(0)
    })

    it("handler processing heavy payload", async () => {
      const iterations = 500
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Instance.provide({
          directory: tempDir,
          fn: async () => {
            const unsub = Bus.subscribe(HeavyPayloadEvent, (event) => {
              let sum = 0
              for (const item of event.properties.data) {
                sum += item.id
                sum += item.nested.items.reduce((a, b) => a + b, 0)
              }
              return sum
            })
            await Bus.publish(HeavyPayloadEvent, heavyPayload)
            unsub()
          },
        })
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round(iterations / (elapsed / 1000))
      console.log(`\n📊 Handler - processing heavy payload:`)
      console.log(`   Iterations: ${iterations.toLocaleString()}`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)
      expect(elapsed).toBeGreaterThan(0)
    })

    it("dispatch 10 events sequentially", async () => {
      const iterations = 1000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Instance.provide({
          directory: tempDir,
          fn: async () => {
            const unsub = Bus.subscribe(TestEvent, () => {})
            for (let j = 0; j < 10; j++) {
              await Bus.publish(TestEvent, { id: j, message: `msg-${j}`, timestamp: Date.now() })
            }
            unsub()
          },
        })
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations * 10) / (elapsed / 1000))
      console.log(`\n📊 Sequential dispatch 10 events:`)
      console.log(`   Iterations: ${iterations.toLocaleString()} (${(iterations * 10).toLocaleString()} total events)`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} events/sec`)
      expect(elapsed).toBeGreaterThan(0)
    })

    it("dispatch 50 events sequentially", async () => {
      const iterations = 300
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await Instance.provide({
          directory: tempDir,
          fn: async () => {
            const unsub = Bus.subscribe(TestEvent, () => {})
            for (let j = 0; j < 50; j++) {
              await Bus.publish(TestEvent, { id: j, message: `msg-${j}`, timestamp: Date.now() })
            }
            unsub()
          },
        })
      }
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round((iterations * 50) / (elapsed / 1000))
      console.log(`\n📊 Sequential dispatch 50 events:`)
      console.log(`   Iterations: ${iterations.toLocaleString()} (${(iterations * 50).toLocaleString()} total events)`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} events/sec`)
      expect(elapsed).toBeGreaterThan(0)
    })

    it("Bus.state() access", async () => {
      const iterations = 50000
      const start = performance.now()
      await Instance.provide({
        directory: tempDir,
        fn: () => {
          for (let i = 0; i < iterations; i++) {
            Bus.state()
          }
        },
      })
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round(iterations / (elapsed / 1000))
      console.log(`\n📊 Bus.state() access:`)
      console.log(`   Iterations: ${iterations.toLocaleString()}`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)
      expect(elapsed).toBeGreaterThan(0)
    })

    it("read subscriptions Map", async () => {
      const iterations = 30000
      const start = performance.now()
      await Instance.provide({
        directory: tempDir,
        fn: () => {
          for (let i = 0; i < iterations; i++) {
            const state = Bus.state()
            state.subscriptions.get("test.event")
          }
        },
      })
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round(iterations / (elapsed / 1000))
      console.log(`\n📊 Read subscriptions Map:`)
      console.log(`   Iterations: ${iterations.toLocaleString()}`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)
      expect(elapsed).toBeGreaterThan(0)
    })

    it("iterate subscriptions", async () => {
      const iterations = 5000
      const start = performance.now()
      await Instance.provide({
        directory: tempDir,
        fn: () => {
          for (let i = 0; i < iterations; i++) {
            const state = Bus.state()
            for (const [_type, handlers] of state.subscriptions) {
              handlers.length
            }
          }
        },
      })
      const elapsed = performance.now() - start
      const opsPerSecond = Math.round(iterations / (elapsed / 1000))
      console.log(`\n📊 Iterate subscriptions:`)
      console.log(`   Iterations: ${iterations.toLocaleString()}`)
      console.log(`   Total time: ${elapsed.toFixed(2)}ms`)
      console.log(`   Throughput: ${opsPerSecond.toLocaleString()} ops/sec`)
      expect(elapsed).toBeGreaterThan(0)
    })
  })
})
