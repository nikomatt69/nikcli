import { describe, expect, it } from "bun:test"
import { isRecord } from "@nikcli-ai/util/record"
import { recordBenchmark } from "../benchmarks/runner"

describe("isRecord", () => {
  describe("truthy cases", () => {
    it("returns true for plain object", () => {
      expect(isRecord({})).toBe(true)
      expect(isRecord({ a: 1 })).toBe(true)
    })

    it("returns true for object with nested fields", () => {
      expect(isRecord({ a: { b: 2 }, c: [1, 2] })).toBe(true)
    })

    it("returns true for Object.create(null)", () => {
      expect(isRecord(Object.create(null))).toBe(true)
    })

    it("returns true for class instance", () => {
      class Foo {}
      expect(isRecord(new Foo())).toBe(true)
    })
  })

  describe("falsy cases", () => {
    it("returns false for null", () => {
      expect(isRecord(null)).toBe(false)
    })

    it("returns false for undefined", () => {
      expect(isRecord(undefined)).toBe(false)
    })

    it("returns false for array", () => {
      expect(isRecord([])).toBe(false)
      expect(isRecord([1, 2, 3])).toBe(false)
    })

    it("returns false for string", () => {
      expect(isRecord("")).toBe(false)
      expect(isRecord("hello")).toBe(false)
    })

    it("returns false for number", () => {
      expect(isRecord(0)).toBe(false)
      expect(isRecord(42)).toBe(false)
    })

    it("returns false for boolean", () => {
      expect(isRecord(true)).toBe(false)
      expect(isRecord(false)).toBe(false)
    })

    it("returns false for function", () => {
      expect(isRecord(() => {})).toBe(false)
    })

    it("returns false for symbol", () => {
      expect(isRecord(Symbol("test"))).toBe(false)
    })
  })

  describe("benchmark", () => {
    it("isRecord throughput", () => {
      const values = [{}, null, [], "str", 42, true, { a: 1 }]
      const iterations = 500_000
      let i = 0
      recordBenchmark({
        suite: "util-record",
        module: "isRecord",
        scenario: "throughput",
        iterations,
        value: isRecord(values[i++ % values.length]) ? 1 : (0 as number),
        unit: "ms",
      })
    })
  })
})
