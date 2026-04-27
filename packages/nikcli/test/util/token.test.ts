import { describe, expect, it } from "bun:test"
import { Token } from "@/util/token"
import { runBench, printBenchResult, compareBenchmarks } from "../bench/runner"

describe("Token", () => {
  describe("estimate", () => {
    it("returns 0 for empty string", () => {
      expect(Token.estimate("")).toBe(0)
    })

    it("returns 0 for null-ish input", () => {
      expect(Token.estimate(null as any)).toBe(0)
      expect(Token.estimate(undefined as any)).toBe(0)
    })

    it("estimates 1 token for 4 chars", () => {
      expect(Token.estimate("abcd")).toBe(1)
    })

    it("estimates 2 tokens for 8 chars", () => {
      expect(Token.estimate("abcdefgh")).toBe(2)
    })

    it("rounds to nearest token", () => {
      expect(Token.estimate("ab")).toBe(1)
      expect(Token.estimate("abc")).toBe(1)
    })

    it("handles long strings", () => {
      const str = "a".repeat(4000)
      expect(Token.estimate(str)).toBe(1000)
    })

    it("never returns negative", () => {
      expect(Token.estimate("")).toBeGreaterThanOrEqual(0)
    })

    it("scales linearly", () => {
      const short = Token.estimate("a".repeat(40))
      const long = Token.estimate("a".repeat(400))
      expect(long).toBe(short * 10)
    })
  })

  describe("benchmark", () => {
    it("Token.estimate throughput", () => {
      const texts = [
        "",
        "hello world",
        "a".repeat(100),
        "a".repeat(1000),
        "The quick brown fox jumps over the lazy dog".repeat(10),
      ]
      let i = 0
      const r = runBench("Token.estimate", "util-token", 500_000, () => {
        Token.estimate(texts[i++ % texts.length]!)
      })
      printBenchResult(r)
      compareBenchmarks("util-token")
      expect(r.opsPerSec).toBeGreaterThan(1_000_000)
    })
  })
})
