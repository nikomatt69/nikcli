import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { MessageV2 } from "@/session/message-v2"
import { SessionRetry } from "@/session/retry"

function apiError(input: ConstructorParameters<typeof MessageV2.APIError>[0]) {
  return new MessageV2.APIError(input)
}

describe("SessionRetry", () => {
  describe("delay", () => {
    let randomSpy: ReturnType<typeof spyOn>
    beforeEach(() => {
      // Pin Math.random for deterministic jitter assertions (10% jitter * 0 = 0)
      randomSpy = spyOn(Math, "random").mockReturnValue(0)
    })
    afterEach(() => {
      randomSpy.mockRestore()
    })

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

    it("adds up to 10% jitter to base delay", () => {
      randomSpy.mockReturnValue(1)
      // attempt 1: base 2000 + (2000 * 1 * 0.1) = 2200
      expect(SessionRetry.delay(1)).toBe(2_200)
      // attempt 2: base 4000 + (4000 * 1 * 0.1) = 4400
      expect(SessionRetry.delay(2)).toBe(4_400)
    })

    it("clamps jittered delay to RETRY_MAX_DELAY_NO_HEADERS", () => {
      randomSpy.mockReturnValue(1)
      // attempt 5 base = 32000 → capped at 30000 even with jitter
      expect(SessionRetry.delay(5)).toBe(30_000)
    })
  })

  describe("retryable", () => {
    it("returns undefined when API error is not retryable", () => {
      const err = apiError({
        message: "nope",
        isRetryable: false,
        statusCode: 400,
      })
      expect(SessionRetry.retryable(err.toObject())).toBeUndefined()
    })

    it("auto-retries 5xx server errors even when not marked retryable", () => {
      const err = apiError({
        message: "server boom",
        isRetryable: false,
        statusCode: 503,
      })
      expect(SessionRetry.retryable(err.toObject())).toBe("server boom")
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
      const plain = {
        name: "UnknownError" as const,
        data: { message: '{"code":"rate_limit_exhausted"}' },
      }
      expect(SessionRetry.retryable(plain as never)).toBe("Provider is overloaded")
    })

    it("retries NVIDIA worker local request limit plain-text errors", () => {
      const err = apiError({
        message: "Worker local total request limit reached (100)",
        isRetryable: true,
        statusCode: 429,
      })
      expect(SessionRetry.retryable(err.toObject())).toBe("Provider is overloaded")
    })

    it("retries ResourceExhausted plain-text saturation", () => {
      const err = apiError({
        message: "ResourceExhausted: too many concurrent requests",
        isRetryable: true,
        statusCode: 429,
      })
      expect(SessionRetry.retryable(err.toObject())).toBe("Provider is overloaded")
    })

    it("retries OpenAI server_is_overloaded stream errors", () => {
      const err = apiError({
        message: '{"type":"error","error":{"type":"server_is_overloaded","message":"The server is overloaded"}}',
        isRetryable: true,
        statusCode: 503,
      })
      expect(SessionRetry.retryable(err.toObject())).toBe("Provider is overloaded")
    })

    it("classifies overload markers in responseBody when message is generic", () => {
      const err = apiError({
        message: "request failed",
        isRetryable: true,
        statusCode: 503,
        responseBody: "service_unavailable_error: try again later",
      })
      expect(SessionRetry.retryable(err.toObject())).toBe("Provider is overloaded")
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
