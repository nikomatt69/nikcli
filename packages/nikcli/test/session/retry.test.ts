import { describe, expect, it } from "bun:test"
import { MessageV2 } from "@/session/message-v2"
import { SessionRetry } from "@/session/retry"

function apiError(input: ConstructorParameters<typeof MessageV2.APIError>[0]) {
  return new MessageV2.APIError(input, { cause: new Error(String(input.message)) })
}

describe("SessionRetry", () => {
  describe("delay", () => {
    it("caps exponential backoff without headers", () => {
      expect(SessionRetry.delay(1)).toBe(2_000)
      expect(SessionRetry.delay(5)).toBe(30_000)
      expect(SessionRetry.delay(10)).toBe(30_000)
    })

    it("uses retry-after-ms when headers exist", () => {
      const err = apiError({
        message: "x",
        isRetryable: true,
        statusCode: 429,
        responseHeaders: { "retry-after-ms": "750" },
      })
      expect(SessionRetry.delay(9, err)).toBe(750)
    })

    it("falls back to exponential backoff when headers exist but retry-after is invalid", () => {
      const err = apiError({
        message: "x",
        isRetryable: true,
        statusCode: 429,
        responseHeaders: { "retry-after": "not-a-number" },
      })
      expect(SessionRetry.delay(2, err)).toBe(4_000)
    })
  })

  describe("retryable", () => {
    it("returns undefined when API error is not retryable", () => {
      const err = apiError({ message: "nope", isRetryable: false, statusCode: 500 })
      expect(SessionRetry.retryable(err.toObject())).toBeUndefined()
    })

    it("classifies JSON rate limit inside API error message", () => {
      const err = apiError({
        message: '{"type":"error","error":{"type":"too_many_requests"}}',
        isRetryable: true,
        statusCode: 429,
      })
      expect(SessionRetry.retryable(err.toObject())).toBe("Too Many Requests")
    })

    it("maps unknown-shaped errors with string data.message via JSON path", () => {
      const plain = { name: "UnknownError" as const, data: { message: '{"code":"rate_limit_exhausted"}' } }
      expect(SessionRetry.retryable(plain as never)).toBe("Provider is overloaded")
    })
  })

  describe("sleep", () => {
    it("rejects immediately when already aborted", async () => {
      const ac = new AbortController()
      ac.abort()
      await expect(SessionRetry.sleep(10_000, ac.signal)).rejects.toMatchObject({ name: "AbortError" })
    })

    it("resolves after delay when not aborted", async () => {
      const ac = new AbortController()
      const t0 = performance.now()
      await SessionRetry.sleep(15, ac.signal)
      expect(performance.now() - t0).toBeGreaterThanOrEqual(10)
    })
  })
})
