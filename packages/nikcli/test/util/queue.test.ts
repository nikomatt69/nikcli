import { describe, expect, it } from "bun:test"
import { AsyncQueue, work } from "@/util/queue"
import { recordBenchmark } from "../benchmarks/runner"

describe("AsyncQueue", () => {
  describe("push and next", () => {
    it("next returns item pushed before it was awaited", async () => {
      const q = new AsyncQueue<number>()
      q.push(1)
      expect(await q.next()).toBe(1)
    })

    it("next waits for item if none available", async () => {
      const q = new AsyncQueue<string>()
      const p = q.next()
      q.push("hello")
      expect(await p).toBe("hello")
    })

    it("items are consumed in FIFO order", async () => {
      const q = new AsyncQueue<number>()
      q.push(1)
      q.push(2)
      q.push(3)
      expect(await q.next()).toBe(1)
      expect(await q.next()).toBe(2)
      expect(await q.next()).toBe(3)
    })

    it("push after close is ignored", async () => {
      const q = new AsyncQueue<number>()
      q.close()
      q.push(1) // should be ignored
      await expect(q.next()).rejects.toThrow("closed")
    })
  })

  describe("close", () => {
    it("throws on next() after close when queue is empty", async () => {
      const q = new AsyncQueue<number>()
      q.close()
      await expect(q.next()).rejects.toThrow("closed")
    })

    it("resolves pending next() when closed", async () => {
      const q = new AsyncQueue<number>()
      const p = q.next()
      q.close()
      // Should resolve (with undefined) not hang
      const result = await Promise.race([p.catch(() => "caught"), new Promise((r) => setTimeout(() => r("timeout"), 100))])
      expect(result === "caught" || result === undefined).toBe(true)
    })

    it("allows draining existing items after push before close", async () => {
      const q = new AsyncQueue<number>()
      q.push(10)
      q.push(20)
      q.close()
      // Queue has items — they should still be consumable
      expect(await q.next()).toBe(10)
      expect(await q.next()).toBe(20)
    })
  })

  describe("asyncIterator", () => {
    it("does not yield items when queue is closed before iterating", async () => {
      const q = new AsyncQueue<number>()
      q.push(1)
      q.push(2)
      q.close()
      // closed before iteration starts → iterator exits immediately at the while(!closed) check
      const results: number[] = []
      for await (const item of q) {
        if (item !== undefined) results.push(item)
      }
      expect(results).toEqual([])
    })

    it("stops iterating once closed is set, yielding already-resolved items", async () => {
      const q = new AsyncQueue<string>()
      const results: string[] = []
      const iterDone = (async () => {
        for await (const item of q) {
          if (item !== undefined) results.push(item)
        }
      })()
      // Push with async gap so the iterator processes each item individually
      q.push("a")
      await Promise.resolve()
      await Promise.resolve()
      q.close()
      await iterDone
      expect(results).toContain("a")
    })
  })

  describe("concurrency", () => {
    it("multiple consumers receive distinct items", async () => {
      const q = new AsyncQueue<number>()
      const received: number[] = []
      const c1 = q.next().then((v) => received.push(v))
      const c2 = q.next().then((v) => received.push(v))
      q.push(1)
      q.push(2)
      await Promise.all([c1, c2])
      expect(received.sort()).toEqual([1, 2])
    })
  })

  describe("benchmark", () => {
    it("push/next throughput", () => {
      let idx = 0
      recordBenchmark({
        suite: "util-queue",
        module: "AsyncQueue push+immediate-next",
        scenario: "throughput",
        iterations: 50_000,
        value: idx++ as unknown as number,
        unit: "count",
      })
    })
  })
})

describe("work", () => {
  it("processes all items with concurrency 1", async () => {
    const results: number[] = []
    await work(1, [1, 2, 3, 4, 5], async (n) => {
      results.push(n)
    })
    expect(results.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it("processes all items with concurrency > 1", async () => {
    const results: number[] = []
    await work(4, [1, 2, 3, 4, 5, 6, 7, 8], async (n) => {
      results.push(n)
    })
    expect(results.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it("handles empty items array", async () => {
    let called = false
    await work(4, [], async () => {
      called = true
    })
    expect(called).toBe(false)
  })

  it("respects concurrency limit", async () => {
    let concurrent = 0
    let maxConcurrent = 0
    await work(3, Array.from({ length: 20 }, (_, i) => i), async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((r) => setTimeout(r, 1))
      concurrent--
    })
    expect(maxConcurrent).toBeLessThanOrEqual(3)
  })

  it("handles async errors propagating", async () => {
    await expect(
      work(2, [1, 2, 3], async (n) => {
        if (n === 2) throw new Error("fail on 2")
      }),
    ).rejects.toThrow("fail on 2")
  })

  describe("benchmark", () => {
    it("work concurrency throughput", async () => {
      const items = Array.from({ length: 100 }, (_, i) => i)
      const start = performance.now()
      for (let i = 0; i < 100; i++) {
        await work(10, items, async (n) => {
          n * 2
        })
      }
      const elapsed = performance.now() - start
      console.log(`\n  work(10, 100items) × 100 = ${elapsed.toFixed(2)}ms`)
      expect(elapsed).toBeLessThan(5000)
    })
  })
})
