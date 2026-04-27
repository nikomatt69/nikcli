import { afterAll, describe, expect, it } from "bun:test"
import z from "zod"
import { InvalidTool } from "../../src/tool/invalid"
import { recordBenchmark, flushBenchmarkRun } from "../benchmarks/runner"

describe("InvalidTool", () => {
  it("rejects args outside schema in parameters.parse", async () => {
    const def = await InvalidTool.init()
    expect(() => def.parameters.parse({ tool: 1, error: "x" } as unknown as z.infer<typeof def.parameters>)).toThrow(
      z.ZodError,
    )
  })

  it("returns formatted error output for a valid call", async () => {
    const def = await InvalidTool.init()
    const result = await def.execute(
      { tool: "read", error: "missing path" },
      {
        sessionID: "ses_test",
        messageID: "msg_test",
        agent: "build",
        abort: new AbortController().signal,
        metadata() {},
        async ask() {},
      },
    )
    expect(result.title).toBe("Invalid Tool")
    expect(result.output).toContain("missing path")
    expect(result.output).toContain("invalid")
  })
})

describe("InvalidTool zod path benchmark", () => {
  it("records parameters.safeParse in a loop", async () => {
    const def = await InvalidTool.init()
    const iterations = 20_000
    const start = performance.now()
    for (let i = 0; i < iterations; i += 1) {
      def.parameters.safeParse({ tool: "grep", error: i % 2 === 0 ? "a" : "b" })
    }
    const elapsed = performance.now() - start
    recordBenchmark({
      suite: "tool",
      module: "invalid",
      scenario: "parameters.safeParse loop",
      iterations,
      value: elapsed,
      unit: "ms",
    })
    expect(elapsed).toBeGreaterThanOrEqual(0)
  })
})

afterAll(() => {
  return flushBenchmarkRun()
})
