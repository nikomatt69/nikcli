import { describe, expect, it } from "bun:test"
import { MessageV2 } from "@/session/message-v2"
import { SessionRetry } from "@/session/retry"
import { recordBenchmark } from "../benchmarks/runner"

function apiError(message: string, responseHeaders?: Record<string, string>) {
  return new MessageV2.APIError(
    { message, isRetryable: true, statusCode: 429, responseHeaders },
    { cause: new Error(message) },
  )
}

describe("SessionRetry benchmark", () => {
  it("records delay hot loop", () => {
    const iterations = 8_000
    const headers = { "retry-after-ms": "100" }
    const err = apiError("x", headers)
    const start = performance.now()
    let acc = 0
    for (let i = 1; i <= iterations; i += 1) {
      acc += SessionRetry.delay((i % 4) + 1, i % 2 === 0 ? err : undefined)
    }
    const elapsed = performance.now() - start
    recordBenchmark({
      suite: "session",
      module: "retry",
      scenario: "delay alternating headers",
      iterations,
      value: elapsed,
      unit: "ms",
      metadata: { acc },
    })
    expect(acc).toBeGreaterThan(0)
  })

  it("records retryable classification loop", () => {
    const payloads = [
      apiError("Overloaded").toObject(),
      apiError('{"type":"error","error":{"type":"too_many_requests"}}').toObject(),
      apiError("FreeUsageLimitError").toObject(),
      { name: "UnknownError" as const, data: { message: '{"code":"exhausted"}' } },
    ] as const
    const iterations = 3_000
    const start = performance.now()
    for (let i = 0; i < iterations; i += 1) {
      SessionRetry.retryable(payloads[i % payloads.length] as never)
    }
    const elapsed = performance.now() - start
    recordBenchmark({
      suite: "session",
      module: "retry",
      scenario: "retryable rotate payloads",
      iterations,
      value: elapsed,
      unit: "ms",
      metadata: { variants: payloads.length },
    })
    expect(elapsed).toBeGreaterThanOrEqual(0)
  })
})
