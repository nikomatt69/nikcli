import { describe, expect, it } from "bun:test"
import { appendOutput, MAX_OUTPUT_LENGTH } from "@/tool/bash"

describe("bash output bounds", () => {
  it("caps retained output while reporting truncation", () => {
    const result = appendOutput("prefix", Buffer.alloc(MAX_OUTPUT_LENGTH, "x"))

    expect(result.output).toHaveLength(MAX_OUTPUT_LENGTH)
    expect(result.output.startsWith("prefix")).toBe(true)
    expect(result.truncated).toBe(true)
  })

  it("keeps normal chunks unchanged", () => {
    expect(appendOutput("prefix", Buffer.from(" output"))).toEqual({
      output: "prefix output",
      truncated: false,
    })
  })
})
