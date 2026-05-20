import { MODELS, MARKUP } from "../types"

export { validateKey, tierFor, recordUsage, getRateLimiter, resetRateLimiterForTests, modelInfoFor } from "./ratelimit"
export type { AuthenticatedKey, RateLimitResult, UsageEvent } from "./ratelimit"
export { validateChatBody, chatCompletionsSchema } from "./validation"
export type { ChatCompletionsBody } from "./validation"
export { getLogger, requestId } from "./logger"
export type { LogFields } from "./logger"

export function upstreamCostUsd(model: string, inputTokens: number, outputTokens: number) {
  const m = MODELS[model as keyof typeof MODELS]
  if (!m) return 0
  return (inputTokens / 1_000_000) * m.input + (outputTokens / 1_000_000) * m.output
}

export function calcCost(model: string, inputTokens: number, outputTokens: number) {
  return upstreamCostUsd(model, inputTokens, outputTokens) * (1 + MARKUP)
}

/** Compute actual cost paid to a specific upstream route. */
export function routedCostUsd(input: number, output: number, inputTokens: number, outputTokens: number) {
  return (inputTokens / 1_000_000) * input + (outputTokens / 1_000_000) * output
}

/** @deprecated use getRateLimiter().check(). Kept for the old sync API. */
export function checkLimit(key: string, _model: string, _tokens: number): { ok: boolean; error?: string } {
  // Legacy callers can keep working but should switch to the async limiter.
  // We synchronously accept; the async limiter is the source of truth in server.ts.
  if (!key.startsWith("nik-")) return { ok: false, error: "Invalid API key" }
  return { ok: true }
}
