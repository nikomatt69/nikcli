import { describe, expect, it } from "bun:test"
import { Color } from "../../src/util/color"
import { Locale } from "../../src/util/locale"

describe("Color Utilities Benchmarks", () => {
  describe("Color.isValidHex", () => {
    const validHexes = ["#FF0000", "#00FF00", "#0000FF", "#AABBCC", "#123456", "#abcdef"]
    const invalidHexes = ["red", "FF0000", "#FF00", "#GGGGGG", "", undefined]

    it("should measure performance for valid hex validation", () => {
      const iterations = 100000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Color.isValidHex(validHexes[i % validHexes.length])
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Color.isValidHex (valid): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for invalid hex validation", () => {
      const iterations = 100000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Color.isValidHex(invalidHexes[i % invalidHexes.length] as any)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Color.isValidHex (invalid): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })

  describe("Color.hexToRgb", () => {
    const hexValues = ["#FF0000", "#00FF00", "#0000FF", "#AABBCC", "#123456", "#abcdef", "#ffffff", "#000000"]

    it("should measure performance for hex to RGB conversion", () => {
      const iterations = 100000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Color.hexToRgb(hexValues[i % hexValues.length])
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Color.hexToRgb: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })

  describe("Color.hexToAnsiBold", () => {
    const validHexes = ["#FF0000", "#00FF00", "#0000FF", "#AABBCC", "#123456", "#abcdef"]

    it("should measure performance for hex to ANSI bold conversion", () => {
      const iterations = 50000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Color.hexToAnsiBold(validHexes[i % validHexes.length])
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Color.hexToAnsiBold: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })
})

describe("Locale Benchmarks", () => {
  describe("Locale.titlecase", () => {
    const testStrings = [
      "hello world",
      "the quick brown fox",
      "lorem ipsum dolor sit amet",
      "ALL CAPS STRING",
      "mIxEd CaSe TeXt",
    ]

    it("should measure performance for titlecase conversion", () => {
      const iterations = 100000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Locale.titlecase(testStrings[i % testStrings.length])
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Locale.titlecase: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })

  describe("Locale.time", () => {
    const timestamps = [Date.now(), Date.now() - 3600000, Date.now() - 86400000, Date.now() + 3600000]

    it("should measure performance for time formatting", () => {
      const iterations = 1000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Locale.time(timestamps[i % timestamps.length])
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Locale.time: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })

  describe("Locale.datetime", () => {
    const timestamps = [Date.now(), Date.now() - 3600000, Date.now() - 86400000, Date.now() + 3600000]

    it("should measure performance for datetime formatting", () => {
      const iterations = 1000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Locale.datetime(timestamps[i % timestamps.length])
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Locale.datetime: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })

  describe("Locale.number", () => {
    const numbers = [0, 100, 999, 1000, 5000, 99999, 100000, 999999, 1000000, 5000000, 999999999]

    it("should measure performance for number formatting", () => {
      const iterations = 100000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Locale.number(numbers[i % numbers.length])
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Locale.number: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })

  describe("Locale.duration", () => {
    const durations = [0, 100, 500, 999, 1000, 5000, 10000, 60000, 120000, 3600000, 7200000, 86400000, 172800000]

    it("should measure performance for duration formatting", () => {
      const iterations = 100000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Locale.duration(durations[i % durations.length])
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Locale.duration: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })

  describe("Locale.truncate", () => {
    const testStrings = [
      "short",
      "This is a medium length string for testing truncation.",
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    ]
    const lengths = [10, 20, 50, 100]

    it("should measure performance for truncate (short)", () => {
      const iterations = 100000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Locale.truncate(testStrings[i % testStrings.length], 50)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Locale.truncate: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for truncate with various lengths", () => {
      const iterations = 100000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Locale.truncate(testStrings[i % testStrings.length], lengths[i % lengths.length])
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Locale.truncate (varied lengths): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })

  describe("Locale.truncateMiddle", () => {
    const testStrings = [
      "short",
      "This is a medium length string for testing truncation.",
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
      "verylongstringwithnospaceswhatsoeverthatneedstobetruncatedinthemiddle",
    ]

    it("should measure performance for truncate middle", () => {
      const iterations = 100000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Locale.truncateMiddle(testStrings[i % testStrings.length], 35)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Locale.truncateMiddle: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })

  describe("Locale.pluralize", () => {
    const testCases = [
      { count: 1, singular: "{} item", plural: "{} items" },
      { count: 0, singular: "{} item", plural: "{} items" },
      { count: 5, singular: "{} file", plural: "{} files" },
      { count: 100, singular: "{} byte", plural: "{} bytes" },
    ]

    it("should measure performance for pluralization", () => {
      const iterations = 100000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const tc = testCases[i % testCases.length]
        Locale.pluralize(tc.count, tc.singular, tc.plural)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Locale.pluralize: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })

  describe("Locale.todayTimeOrDateTime", () => {
    const timestamps = [Date.now(), Date.now() - 86400000, Date.now() - 172800000, Date.now() + 86400000]

    it("should measure performance for today time or datetime", () => {
      const iterations = 1000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        Locale.todayTimeOrDateTime(timestamps[i % timestamps.length])
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Locale.todayTimeOrDateTime: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })
})

describe("String Operations Benchmarks", () => {
  describe("String concatenation patterns", () => {
    it("should measure performance for template literal concatenation", () => {
      const iterations = 100000
      const parts = ["hello", "world", "test", "string"]
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const _ = `${parts[0]}-${parts[1]}-${parts[2]}-${parts[3]}-${i}`
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Template literals: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for array join concatenation", () => {
      const iterations = 100000
      const parts = ["hello", "world", "test", "string"]
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const _ = [...parts, i.toString()].join("-")
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Array.join(): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for string concat", () => {
      const iterations = 100000
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const _ = "hello".concat("-", "world", "-", "test", "-", "string", "-", i.toString())
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ String.concat(): ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })

  describe("String parsing operations", () => {
    it("should measure performance for JSON parse", () => {
      const iterations = 10000
      const jsonStr = JSON.stringify({ id: 1, name: "test", items: [1, 2, 3], nested: { a: 1, b: 2 } })
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        JSON.parse(jsonStr)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ JSON.parse: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for JSON stringify", () => {
      const iterations = 10000
      const obj = { id: 1, name: "test", items: [1, 2, 3], nested: { a: 1, b: 2 } }
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        JSON.stringify(obj)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ JSON.stringify: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for regex matching", () => {
      const iterations = 100000
      const str = "hello-world-test-123"
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        str.match(/\w+-\w+-\w+-\d+/)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Regex.match: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for split operation", () => {
      const iterations = 100000
      const str = "hello-world-test-string-for-splitting"
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        str.split("-")
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ String.split: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })

  describe("Array operations", () => {
    it("should measure performance for array filter", () => {
      const iterations = 50000
      const arr = Array.from({ length: 100 }, (_, i) => i)
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        arr.filter((n) => n % 2 === 0)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Array.filter: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for array map", () => {
      const iterations = 50000
      const arr = Array.from({ length: 100 }, (_, i) => i)
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        arr.map((n) => n * 2)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Array.map: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })

    it("should measure performance for array reduce", () => {
      const iterations = 50000
      const arr = Array.from({ length: 100 }, (_, i) => i)
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        arr.reduce((acc, n) => acc + n, 0)
      }
      const elapsed = performance.now() - start
      const opsPerSec = Math.round(iterations / (elapsed / 1000))
      console.log(
        `✓ Array.reduce: ${opsPerSec.toLocaleString()} ops/sec (${elapsed.toFixed(2)}ms for ${iterations} iterations)`,
      )
      expect(opsPerSec).toBeGreaterThan(0)
    })
  })
})
