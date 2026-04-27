import { afterAll, describe, expect, it } from "bun:test"
import { chunkText } from "@/rag/chunk"
import { flushBenchmarkRun, recordBenchmark } from "../benchmarks/runner"

afterAll(async () => {
  await flushBenchmarkRun()
})

describe("chunkText benchmark", () => {
  it("chunks large line-based documents", () => {
    const lines = 10_000
    const text = Array.from({ length: lines }, (_, i) => `line ${i} content`).join("\n")
    const iterations = 50
    const warmup = 5

    for (let i = 0; i < warmup; i++) {
      chunkText({ file: "bench.ts", text, chunkLines: 40, maxChunks: 500 })
    }

    const start = performance.now()
    for (let i = 0; i < iterations; i++) {
      chunkText({ file: `bench-${i}.ts`, text, chunkLines: 40, maxChunks: 500 })
    }
    const elapsed = performance.now() - start

    recordBenchmark({
      suite: "rag",
      module: "chunk",
      scenario: "chunkText 10k lines",
      iterations,
      value: elapsed,
      unit: "ms",
      metadata: {
        lines,
        chunkLines: 40,
        maxChunks: 500,
      },
    })

    expect(elapsed).toBeGreaterThanOrEqual(0)
    expect(elapsed / iterations).toBeLessThan(500)
  })
})
