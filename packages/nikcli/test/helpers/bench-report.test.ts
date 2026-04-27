import { afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  clearBenchSamples,
  defaultBenchOutDir,
  flushBenchRunToFile,
  peekBenchSamples,
  recordBenchSample,
  renderHtmlCompare,
} from "./bench-report"

describe("bench-report", () => {
  afterEach(() => {
    clearBenchSamples()
  })

  it("recordBenchSample accumulates samples", () => {
    recordBenchSample({ suite: "a", name: "n1", durationMs: 1 })
    recordBenchSample({ suite: "a", name: "n2", durationMs: 2 })
    expect(peekBenchSamples().length).toBe(2)
  })

  it("clearBenchSamples empties buffer", () => {
    recordBenchSample({ suite: "a", name: "n", durationMs: 1 })
    clearBenchSamples()
    expect(peekBenchSamples().length).toBe(0)
  })

  it("flushBenchRunToFile writes JSON with samples", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-bench-"))
    try {
      recordBenchSample({ suite: "s", name: "op", iterations: 10, durationMs: 0.5 })
      const out = path.join(dir, "run.json")
      await flushBenchRunToFile(out, { tag: "test" })
      const raw = await fs.readFile(out, "utf8")
      const data = JSON.parse(raw) as { samples: unknown[]; meta: unknown; runId: string }
      expect(data.samples.length).toBe(1)
      expect(data.meta).toEqual({ tag: "test" })
      expect(typeof data.runId).toBe("string")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it("renderHtmlCompare includes suite names and baseline ms", () => {
    const base = JSON.stringify({
      runId: "b1",
      timestamp: 1,
      samples: [{ suite: "s", name: "op", durationMs: 10 }],
    })
    const cur = JSON.stringify({
      runId: "c1",
      timestamp: 2,
      samples: [{ suite: "s", name: "op", durationMs: 12 }],
    })
    const html = renderHtmlCompare(base, cur)
    expect(html).toContain("s")
    expect(html).toContain("op")
    expect(html).toContain("12.000")
    expect(html).toContain("10.000")
    expect(html).toContain("% vs baseline")
  })

  it("defaultBenchOutDir ends with bench-results", () => {
    expect(defaultBenchOutDir().replace(/\\/g, "/")).toMatch(/bench-results$/)
  })
})
