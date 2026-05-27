import { describe, expect, it } from "bun:test"
import { Color } from "@/util/color"
import { recordBenchmark } from "../benchmarks/runner"

describe("Color", () => {
  describe("isValidHex", () => {
    it("returns true for valid 6-digit hex with #", () => {
      expect(Color.isValidHex("#000000")).toBe(true)
      expect(Color.isValidHex("#ffffff")).toBe(true)
      expect(Color.isValidHex("#FF0000")).toBe(true)
      expect(Color.isValidHex("#aAbBcC")).toBe(true)
    })

    it("returns false for undefined", () => {
      expect(Color.isValidHex(undefined)).toBe(false)
    })

    it("returns false for empty string", () => {
      expect(Color.isValidHex("")).toBe(false)
    })

    it("returns false without # prefix", () => {
      expect(Color.isValidHex("ffffff")).toBe(false)
    })

    it("returns false for 3-digit hex", () => {
      expect(Color.isValidHex("#fff")).toBe(false)
    })

    it("returns false for invalid characters", () => {
      expect(Color.isValidHex("#gggggg")).toBe(false)
      expect(Color.isValidHex("#12345Z")).toBe(false)
    })

    it("returns false for 7+ char hex", () => {
      expect(Color.isValidHex("#1234567")).toBe(false)
    })
  })

  describe("hexToRgb", () => {
    it("converts black", () => {
      expect(Color.hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 })
    })

    it("converts white", () => {
      expect(Color.hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 })
    })

    it("converts red", () => {
      expect(Color.hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 })
    })

    it("converts green", () => {
      expect(Color.hexToRgb("#00ff00")).toEqual({ r: 0, g: 255, b: 0 })
    })

    it("converts blue", () => {
      expect(Color.hexToRgb("#0000ff")).toEqual({ r: 0, g: 0, b: 255 })
    })

    it("converts mixed color", () => {
      expect(Color.hexToRgb("#1a2b3c")).toEqual({ r: 26, g: 43, b: 60 })
    })

    it("handles uppercase hex digits", () => {
      expect(Color.hexToRgb("#FF8800")).toEqual({ r: 255, g: 136, b: 0 })
    })
  })

  describe("hexToAnsiBold", () => {
    it("returns undefined for invalid hex", () => {
      expect(Color.hexToAnsiBold(undefined)).toBeUndefined()
      expect(Color.hexToAnsiBold("")).toBeUndefined()
      expect(Color.hexToAnsiBold("invalid")).toBeUndefined()
    })

    it("returns ANSI escape sequence for valid hex", () => {
      const result = Color.hexToAnsiBold("#ff0000")
      expect(result).toBeDefined()
      expect(result).toContain("\x1b[38;2;255;0;0m")
      expect(result).toContain("\x1b[1m")
    })

    it("produces correct RGB values in escape sequence", () => {
      const result = Color.hexToAnsiBold("#1a2b3c")!
      expect(result).toContain("26;43;60")
    })
  })

  describe("benchmark", () => {
    it("Color.isValidHex throughput", () => {
      const inputs = ["#ff0000", "#invalid", undefined, "#abc", "#AABBCC"]
      let i = 0
      const r = recordBenchmark({
        suite: "util-color",
        module: "Color.isValidHex",
        scenario: "throughput",
        iterations: 500_000,
        value: Color.isValidHex(inputs[i++ % inputs.length] as any) as unknown as number,
        unit: "ms",
      })
    })

    it("Color.hexToRgb throughput", () => {
      recordBenchmark({
        suite: "util-color",
        module: "Color.hexToRgb",
        scenario: "throughput",
        iterations: 300_000,
        value: Color.hexToRgb("#1a2b3c") as unknown as number,
        unit: "ms",
      })
    })
  })
})
