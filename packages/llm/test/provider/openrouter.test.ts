import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/route"
import * as OpenRouter from "../../src/providers/openrouter"
import { LLMError } from "../../src/schema"
import { it } from "../lib/effect"

const initial = OpenRouter.protocol.stream.initial()
const decodeFrame = Schema.decodeUnknownEffect(OpenRouter.protocol.stream.event)

// Drive one raw SSE `data:` payload through the OpenRouter stream parser and
// return the resulting LLMError reason tag (or "ok" if it parsed cleanly).
const reasonFor = (frame: string) =>
  decodeFrame(frame).pipe(
    Effect.flatMap((event) => OpenRouter.protocol.stream.step(initial, event)),
    Effect.match({
      onFailure: (error) => (error instanceof LLMError ? error.reason : error),
      onSuccess: () => "ok" as const,
    }),
  )

describe("OpenRouter", () => {
  it.effect("prepares OpenRouter models through the OpenAI-compatible Chat route", () =>
    Effect.gen(function* () {
      const model = OpenRouter.model("openai/gpt-4o-mini", { apiKey: "test-key" })

      expect(model).toMatchObject({
        id: "openai/gpt-4o-mini",
        provider: "openrouter",
        route: "openrouter",
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: "test-key",
      })

      const prepared = yield* LLMClient.prepare(LLM.request({ model, prompt: "Say hello." }))

      expect(prepared.route).toBe("openrouter")
      expect(prepared.body).toMatchObject({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "Say hello." }],
        stream: true,
      })
    }),
  )

  it.effect("applies OpenRouter payload options from the model helper", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: OpenRouter.model("anthropic/claude-3.7-sonnet:thinking", {
            providerOptions: {
              openrouter: {
                usage: true,
                reasoning: { effort: "high" },
                promptCacheKey: "session_123",
              },
            },
          }),
          prompt: "Think briefly.",
        }),
      )

      expect(prepared.body).toMatchObject({
        usage: { include: true },
        reasoning: { effort: "high" },
        prompt_cache_key: "session_123",
      })
    }),
  )

  it.effect("classifies an in-band 429 error frame as a retryable rate limit", () =>
    Effect.gen(function* () {
      const reason = yield* reasonFor(
        JSON.stringify({
          error: { code: 429, message: "Provider returned error", metadata: { headers: { "retry-after": "12" } } },
        }),
      )
      expect(reason).toMatchObject({ _tag: "RateLimit", retryAfterMs: 12_000 })
      expect((reason as { retryable: boolean }).retryable).toBe(true)
    }),
  )

  it.effect("classifies exhausted free credits (402) as a quota error", () =>
    Effect.gen(function* () {
      const reason = yield* reasonFor(
        JSON.stringify({ error: { code: 402, message: "Insufficient credits" } }),
      )
      expect(reason).toMatchObject({ _tag: "QuotaExceeded", message: "Insufficient credits" })
    }),
  )

  it.effect("maps a string rate-limit code to a rate limit error", () =>
    Effect.gen(function* () {
      const reason = yield* reasonFor(
        JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Too many requests" } }),
      )
      expect(reason).toMatchObject({ _tag: "RateLimit" })
    }),
  )

  it.effect("classifies a 5xx upstream failure as a retryable provider error", () =>
    Effect.gen(function* () {
      const reason = yield* reasonFor(JSON.stringify({ error: { code: 503, message: "upstream down" } }))
      expect(reason).toMatchObject({ _tag: "ProviderInternal", status: 503 })
      expect((reason as { retryable: boolean }).retryable).toBe(true)
    }),
  )

  it.effect("still parses a normal chat delta frame", () =>
    Effect.gen(function* () {
      const reason = yield* reasonFor(
        JSON.stringify({ choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] }),
      )
      expect(reason).toBe("ok")
    }),
  )
})
