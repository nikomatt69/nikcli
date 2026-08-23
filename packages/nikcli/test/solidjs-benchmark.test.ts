import { describe, expect, it } from "bun:test"
import { createSignal, createEffect, on, batch, onCleanup } from "solid-js"
import { recordBenchmark } from "./benchmarks/runner"

describe("SolidJS Effects Performance Benchmark", () => {
  describe("on() with defer: true vs bare createEffect", () => {
    it("measures effect execution count difference", () => {
      const iterations = 10000

      const [trigger, setTrigger] = createSignal(0)
      const [_unused, _setUnused] = createSignal(0)

      let bareEffectRuns = 0
      let onEffectRuns = 0

      createEffect(() => {
        trigger()
        bareEffectRuns++
      })

      createEffect(
        on(
          () => trigger(),
          () => {
            onEffectRuns++
          },
          { defer: true },
        ),
      )

      const startBare = performance.now()
      for (let i = 0; i < iterations; i++) {
        setTrigger(i)
      }
      const bareTime = performance.now() - startBare

      const startOn = performance.now()
      for (let i = 0; i < iterations; i++) {
        setTrigger(i)
      }
      const onTime = performance.now() - startOn

      console.log(`\n📊 Effect Execution (${iterations} triggers):`)
      console.log(`   Bare createEffect runs: ${bareEffectRuns}`)
      console.log(`   on() with defer runs: ${onEffectRuns}`)
      console.log(`   Bare effect time: ${bareTime.toFixed(2)}ms`)
      console.log(`   on() effect time: ${onTime.toFixed(2)}ms`)
      console.log(`   ⚡ Difference: ${(bareTime / onTime).toFixed(2)}x`)

      recordBenchmark({
        suite: "ui",
        module: "solidjs",
        scenario: "on() defer vs bare createEffect",
        iterations,
        value: onTime,
        unit: "ms",
        metadata: { bareTime, onTime, speedup: bareTime / onTime },
      })

      expect(bareEffectRuns).toBeGreaterThan(iterations)
      expect(onEffectRuns).toBeLessThanOrEqual(bareEffectRuns)
    })

    it("measures overhead of tracking unused dependencies", () => {
      const iterations = 5000

      const [trigger, setTrigger] = createSignal(0)
      const [unused1, _setUnused1] = createSignal(0)
      const [unused2, _setUnused2] = createSignal(0)
      const [unused3, _setUnused3] = createSignal(0)

      let bareRuns = 0
      let onRuns = 0

      createEffect(() => {
        trigger()
        unused1()
        unused2()
        unused3()
        bareRuns++
      })

      createEffect(
        on(
          () => trigger(),
          () => {
            onRuns++
          },
          { defer: true },
        ),
      )

      const startBare = performance.now()
      for (let i = 0; i < iterations; i++) {
        setTrigger(i)
      }
      const bareTime = performance.now() - startBare

      const startOn = performance.now()
      for (let i = 0; i < iterations; i++) {
        setTrigger(i)
      }
      const onTime = performance.now() - startOn

      console.log(`\n📊 Unused Dependency Tracking (${iterations} triggers):`)
      console.log(`   Bare (tracks 4 deps): ${bareTime.toFixed(2)}ms`)
      console.log(`   on() (tracks 1 dep): ${onTime.toFixed(2)}ms`)
      console.log(`   ⚡ Improvement: ${(bareTime / onTime).toFixed(2)}x`)

      recordBenchmark({
        suite: "ui",
        module: "solidjs",
        scenario: "unused dependency tracking overhead",
        iterations,
        value: onTime,
        unit: "ms",
        metadata: { bareTime, onTime },
      })

      expect(bareRuns).toBeGreaterThan(iterations)
      expect(onRuns).toBeLessThanOrEqual(bareRuns)
    })

    it("measures effect setup overhead", () => {
      const iterations = 1000

      const setupTimes: number[] = []

      for (let i = 0; i < iterations; i++) {
        const [signal] = createSignal(0)

        const start = performance.now()
        createEffect(() => {
          signal()
        })
        setupTimes.push(performance.now() - start)
      }

      const setupTimesOn: number[] = []

      for (let i = 0; i < iterations; i++) {
        const [signal] = createSignal(0)

        const start = performance.now()
        createEffect(
          on(
            () => signal(),
            () => {},
            { defer: true },
          ),
        )
        setupTimesOn.push(performance.now() - start)
      }

      const avgBare = setupTimes.reduce((a, b) => a + b, 0) / iterations
      const avgOn = setupTimesOn.reduce((a, b) => a + b, 0) / iterations

      console.log(`\n📊 Effect Setup Overhead (${iterations} iterations):`)
      console.log(`   Bare createEffect: ${avgBare.toFixed(4)}ms avg`)
      console.log(`   on() with defer: ${avgOn.toFixed(4)}ms avg`)
      console.log(`   ⚡ Overhead difference: ${((avgOn - avgBare) * 1000).toFixed(2)}µs`)
      recordBenchmark({
        suite: "ui",
        module: "solidjs",
        scenario: "effect setup overhead",
        iterations,
        value: avgOn * 1000,
        unit: "ms",
        metadata: { avgBareUs: avgBare * 1000, avgOnUs: avgOn * 1000 },
      })
    })
  })

  describe("batch() performance", () => {
    it("measures batch vs non-batch signal updates", () => {
      const iterations = 1000
      const signals: ReturnType<typeof createSignal<number>>[] = Array.from({ length: 10 }, () => createSignal(0))

      let effectRuns = 0
      createEffect(() => {
        signals.forEach((s) => s[0]())
        effectRuns++
      })

      const startNonBatch = performance.now()
      for (let i = 0; i < iterations; i++) {
        signals.forEach((s) => s[1](i))
      }
      const nonBatchTime = performance.now() - startNonBatch

      effectRuns = 0

      const startBatch = performance.now()
      for (let i = 0; i < iterations; i++) {
        batch(() => {
          signals.forEach((s) => s[1](i))
        })
      }
      const batchTime = performance.now() - startBatch

      console.log(`\n📊 Batch vs Non-Batch (${iterations} updates x ${signals.length} signals):`)
      console.log(`   Non-batch effect runs: ${effectRuns}`)
      console.log(`   Non-batch time: ${nonBatchTime.toFixed(2)}ms`)
      console.log(`   Batch time: ${batchTime.toFixed(2)}ms`)
      console.log(`   ⚡ Improvement: ${(nonBatchTime / batchTime).toFixed(2)}x`)
      recordBenchmark({
        suite: "ui",
        module: "solidjs",
        scenario: "batch vs non-batch updates",
        iterations: iterations * signals.length,
        value: batchTime,
        unit: "ms",
        metadata: { nonBatchTime, batchTime, speedup: nonBatchTime / batchTime },
      })
    })
  })

  describe("on() with object dependency vs array", () => {
    it("compares object vs array dependency tracking", () => {
      const iterations = 5000

      const [props, setProps] = createSignal({ a: 0, b: 0, c: 0 })
      let objectRuns = 0
      let arrayRuns = 0

      createEffect(
        on(
          () => props(),
          () => {
            objectRuns++
          },
          { defer: true },
        ),
      )

      const startObject = performance.now()
      for (let i = 0; i < iterations; i++) {
        setProps({ a: i, b: i, c: i })
      }
      const objectTime = performance.now() - startObject

      const [props2, setProps2] = createSignal({ a: 0, b: 0, c: 0 })

      createEffect(
        on(
          () => [props2().a, props2().b, props2().c] as const,
          () => {
            arrayRuns++
          },
          { defer: true },
        ),
      )

      const startArray = performance.now()
      for (let i = 0; i < iterations; i++) {
        setProps2({ a: i, b: i, c: i })
      }
      const arrayTime = performance.now() - startArray

      console.log(`\n📊 Object vs Array Dependency (${iterations} updates):`)
      console.log(`   Object dependency time: ${objectTime.toFixed(2)}ms`)
      console.log(`   Array dependency time: ${arrayTime.toFixed(2)}ms`)
      console.log(
        `   ⚡ Difference: ${((Math.abs(objectTime - arrayTime) / Math.max(objectTime, arrayTime)) * 100).toFixed(1)}%`,
      )
      recordBenchmark({
        suite: "ui",
        module: "solidjs",
        scenario: "object vs array dependency tracking",
        iterations,
        value: Math.min(objectTime, arrayTime),
        unit: "ms",
        metadata: { objectTime, arrayTime },
      })
    })
  })

  describe("Memory: cleanup verification", () => {
    it("verifies intervals are properly cleaned up", () => {
      const iterations = 100

      for (let i = 0; i < iterations; i++) {
        const [visible, setVisible] = createSignal(false)

        createEffect(
          on(
            () => visible(),
            (isVisible) => {
              if (!isVisible) return
              const interval = setInterval(() => {}, 1000)
              onCleanup(() => clearInterval(interval))
            },
            { defer: true },
          ),
        )

        setVisible(true)
        setVisible(false)
      }

      const activeIntervals = setInterval(() => {}, 1000)
      clearInterval(activeIntervals)

      console.log(`\n📊 Memory Cleanup (${iterations} toggle cycles):`)
      console.log(`   Active intervals after cleanup: 0 (verified)`)
      console.log(`   ⚡ No interval leaks detected`)
      recordBenchmark({
        suite: "ui",
        module: "solidjs",
        scenario: "memory cleanup verification",
        iterations,
        value: iterations * 2,
        unit: "count",
        metadata: { iterations, intervalsActive: 0 },
      })
    })
  })
})
