import { describe, expect, it } from "bun:test"
import { Hash } from "@/util/hash"
import { runBench, printBenchResult, compareBenchmarks } from "../bench/runner"

describe("Hash", () => {
  describe("fast", () => {
    it("returns a hex string", () => {
      const result = Hash.fast("hello")
      expect(typeof result).toBe("string")
      expect(/^[0-9a-f]+$/.test(result)).toBe(true)
    })

    it("returns 40-character SHA1 hex digest", () => {
      expect(Hash.fast("hello").length).toBe(40)
      expect(Hash.fast("").length).toBe(40)
    })

    it("is deterministic", () => {
      expect(Hash.fast("hello")).toBe(Hash.fast("hello"))
      expect(Hash.fast("world")).toBe(Hash.fast("world"))
    })

    it("different inputs produce different hashes", () => {
      expect(Hash.fast("hello")).not.toBe(Hash.fast("world"))
      expect(Hash.fast("a")).not.toBe(Hash.fast("b"))
    })

    it("handles empty string", () => {
      const result = Hash.fast("")
      expect(result.length).toBe(40)
    })

    it("handles Buffer input", () => {
      const buf = Buffer.from("hello")
      const strResult = Hash.fast("hello")
      const bufResult = Hash.fast(buf)
      expect(bufResult).toBe(strResult)
    })

    it("handles long input", () => {
      const long = "a".repeat(10000)
      const result = Hash.fast(long)
      expect(result.length).toBe(40)
    })
  })

  describe("benchmark", () => {
    it("Hash.fast throughput — short string", () => {
      const r = runBench("Hash.fast short", "util-hash", 100_000, () => {
        Hash.fast("hello world")
      })
      printBenchResult(r)
      compareBenchmarks("util-hash")
      expect(r.opsPerSec).toBeGreaterThan(10_000)
    })

    it("Hash.fast throughput — long string", () => {
      const long = "a".repeat(10000)
      const r = runBench("Hash.fast long", "util-hash", 10_000, () => {
        Hash.fast(long)
      })
      printBenchResult(r)
      expect(r.opsPerSec).toBeGreaterThan(1_000)
    })
  })
})
