import { describe, expect, it } from "bun:test"
import { errorFormat, errorMessage, errorData } from "@/util/error"
import { runBench, printBenchResult, compareBenchmarks } from "../bench/runner"

describe("errorFormat", () => {
  it("returns stack for Error with stack", () => {
    const err = new Error("test error")
    const result = errorFormat(err)
    expect(result).toContain("test error")
  })

  it("returns name:message if no stack", () => {
    const err = new Error("no stack")
    delete (err as any).stack
    const result = errorFormat(err)
    expect(result).toContain("Error: no stack")
  })

  it("JSON stringifies plain objects", () => {
    const obj = { code: 404, reason: "not found" }
    const result = errorFormat(obj)
    expect(result).toContain("404")
    expect(result).toContain("not found")
  })

  it("converts primitive values to string", () => {
    expect(errorFormat("something went wrong")).toBe("something went wrong")
    expect(errorFormat(42)).toBe("42")
    expect(errorFormat(true)).toBe("true")
  })

  it("handles null", () => {
    expect(errorFormat(null)).toBe("null")
  })
})

describe("errorMessage", () => {
  it("returns the error message from Error", () => {
    expect(errorMessage(new Error("hello"))).toBe("hello")
  })

  it("returns error name if no message", () => {
    const err = new Error("")
    Object.defineProperty(err, "message", { value: "" })
    const result = errorMessage(err)
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)
  })

  it("extracts message from plain record object", () => {
    const obj = { message: "something failed" }
    expect(errorMessage(obj)).toBe("something failed")
  })

  it("converts string errors", () => {
    expect(errorMessage("raw string error")).toBe("raw string error")
  })

  it("handles number as error", () => {
    const result = errorMessage(404)
    expect(typeof result).toBe("string")
  })

  it("returns unknown error for unserializable sentinel", () => {
    const circular: any = {}
    circular.self = circular
    const result = errorMessage(circular)
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)
  })

  it("does not return [object Object]", () => {
    const obj = {}
    const result = errorMessage(obj)
    expect(result).not.toBe("[object Object]")
  })
})

describe("errorData", () => {
  it("returns structured data for Error instances", () => {
    const err = new Error("oops")
    const data = errorData(err)
    expect(data.type).toBe("Error")
    expect(data.message).toBe("oops")
    expect(data.stack).toBeDefined()
  })

  it("includes cause when present", () => {
    const cause = new Error("root cause")
    const err = new Error("top level", { cause })
    const data = errorData(err)
    expect(data.cause).toBeDefined()
    expect(String(data.cause)).toContain("root cause")
  })

  it("returns type for non-Error non-record values", () => {
    const data = errorData("string error")
    expect(data.type).toBe("string")
    expect(data.message).toBe("string error")
  })

  it("returns structured data for plain object", () => {
    const obj = { code: 500, message: "server error" }
    const data = errorData(obj)
    expect(data.message).toBe("server error")
    expect(data.code).toBe(500)
  })

  it("handles custom error class", () => {
    class CustomError extends Error {
      constructor(
        msg: string,
        public readonly code: number,
      ) {
        super(msg)
        this.name = "CustomError"
      }
    }
    const err = new CustomError("custom", 42)
    const data = errorData(err)
    expect(data.type).toBe("CustomError")
    expect(data.message).toBe("custom")
  })

  describe("benchmark", () => {
    it("errorMessage throughput", () => {
      const inputs = [new Error("err"), { message: "msg" }, "string", 42, null]
      let i = 0
      const r = runBench("errorMessage", "util-error", 200_000, () => {
        errorMessage(inputs[i++ % inputs.length])
      })
      printBenchResult(r)
      compareBenchmarks("util-error")
      expect(r.opsPerSec).toBeGreaterThan(100_000)
    })

    it("errorData throughput", () => {
      const err = new Error("test")
      const r = runBench("errorData(Error)", "util-error", 100_000, () => {
        errorData(err)
      })
      printBenchResult(r)
      expect(r.opsPerSec).toBeGreaterThan(50_000)
    })
  })
})
