import { describe, expect, it } from "bun:test"
import { Locale } from "@/util/locale"
import { runBench, printBenchResult, compareBenchmarks } from "../bench/runner"

describe("Locale", () => {
  describe("titlecase", () => {
    it("capitalizes first letter of each word", () => {
      expect(Locale.titlecase("hello world")).toBe("Hello World")
    })

    it("handles single word", () => {
      expect(Locale.titlecase("foo")).toBe("Foo")
    })

    it("handles already capitalized", () => {
      expect(Locale.titlecase("Hello World")).toBe("Hello World")
    })

    it("handles empty string", () => {
      expect(Locale.titlecase("")).toBe("")
    })

    it("handles multiple spaces", () => {
      expect(Locale.titlecase("hello  world")).toBe("Hello  World")
    })
  })

  describe("number", () => {
    it("returns plain number below 1000", () => {
      expect(Locale.number(0)).toBe("0")
      expect(Locale.number(999)).toBe("999")
      expect(Locale.number(1)).toBe("1")
    })

    it("formats thousands with K suffix", () => {
      expect(Locale.number(1000)).toBe("1.0K")
      expect(Locale.number(1500)).toBe("1.5K")
      expect(Locale.number(10000)).toBe("10.0K")
      expect(Locale.number(999999)).toBe("1000.0K")
    })

    it("formats millions with M suffix", () => {
      expect(Locale.number(1000000)).toBe("1.0M")
      expect(Locale.number(2500000)).toBe("2.5M")
      expect(Locale.number(10000000)).toBe("10.0M")
    })
  })

  describe("duration (milliseconds)", () => {
    it("formats sub-second in ms", () => {
      expect(Locale.duration(0)).toBe("0ms")
      expect(Locale.duration(500)).toBe("500ms")
      expect(Locale.duration(999)).toBe("999ms")
    })

    it("formats seconds (1000ms – 59999ms)", () => {
      expect(Locale.duration(1000)).toBe("1.0s")
      expect(Locale.duration(1500)).toBe("1.5s")
      expect(Locale.duration(59999)).toBe("60.0s")
    })

    it("formats minutes (60000ms – 3599999ms)", () => {
      expect(Locale.duration(60000)).toBe("1m 0s")
      expect(Locale.duration(90000)).toBe("1m 30s")
      expect(Locale.duration(3599999)).toBe("59m 59s")
    })

    it("formats hours (3600000ms – 86399999ms)", () => {
      expect(Locale.duration(3600000)).toBe("1h 0m")
      expect(Locale.duration(7200000)).toBe("2h 0m")
    })
  })

  describe("truncate", () => {
    it("returns string unchanged if within limit", () => {
      expect(Locale.truncate("hello", 10)).toBe("hello")
      expect(Locale.truncate("hello", 5)).toBe("hello")
    })

    it("truncates with ellipsis if over limit", () => {
      expect(Locale.truncate("hello world", 8)).toBe("hello w…")
    })

    it("handles limit of 1", () => {
      expect(Locale.truncate("abc", 1)).toBe("…")
    })

    it("handles empty string", () => {
      expect(Locale.truncate("", 5)).toBe("")
    })
  })

  describe("truncateMiddle", () => {
    it("returns string unchanged if within maxLength", () => {
      expect(Locale.truncateMiddle("hello", 10)).toBe("hello")
      expect(Locale.truncateMiddle("hello", 5)).toBe("hello")
    })

    it("truncates in the middle with ellipsis", () => {
      const result = Locale.truncateMiddle("hello world foo bar baz qux", 15)
      expect(result.length).toBe(15)
      expect(result).toContain("…")
    })

    it("uses default maxLength of 35", () => {
      const long = "a".repeat(40)
      const result = Locale.truncateMiddle(long)
      expect(result.length).toBe(35)
    })

    it("handles exact maxLength", () => {
      const str = "a".repeat(35)
      expect(Locale.truncateMiddle(str, 35)).toBe(str)
    })
  })

  describe("pluralize", () => {
    it("uses singular template for count 1", () => {
      expect(Locale.pluralize(1, "{} item", "{} items")).toBe("1 item")
    })

    it("uses plural template for count 0", () => {
      expect(Locale.pluralize(0, "{} item", "{} items")).toBe("0 items")
    })

    it("uses plural template for count > 1", () => {
      expect(Locale.pluralize(5, "{} item", "{} items")).toBe("5 items")
    })

    it("replaces {} with count", () => {
      expect(Locale.pluralize(42, "found {} result", "found {} results")).toBe("found 42 results")
    })
  })

  describe("benchmark", () => {
    it("Locale.number throughput", () => {
      const nums = [0, 500, 1500, 50000, 1500000]
      let i = 0
      const r = runBench("Locale.number", "util-locale", 300_000, () => {
        Locale.number(nums[i++ % nums.length]!)
      })
      printBenchResult(r)
      compareBenchmarks("util-locale")
      expect(r.opsPerSec).toBeGreaterThan(500_000)
    })

    it("Locale.truncateMiddle throughput", () => {
      const str = "hello world this is a longer string for testing purposes"
      const r = runBench("Locale.truncateMiddle", "util-locale", 200_000, () => {
        Locale.truncateMiddle(str, 20)
      })
      printBenchResult(r)
      expect(r.opsPerSec).toBeGreaterThan(100_000)
    })
  })
})
