import { APICallError } from "ai"
import { Schema } from "effect"

export namespace ProviderError {
  /**
   * Thrown when a provider's response headers do not arrive within the configured
   * timeout window. Tagged so the call site can use
   * `Effect.catchTag("ProviderHeaderTimeout", ...)` and the existing
   * `instanceof ProviderError.HeaderTimeoutError` continues to work.
   */
  export class HeaderTimeoutError extends Schema.TaggedErrorClass<HeaderTimeoutError>()("ProviderHeaderTimeout", {
    ms: Schema.Number,
  }) {
    override get message() {
      return `Provider response headers timed out after ${this.ms}ms`
    }
  }

  const OVERFLOW_PATTERNS = [
    /prompt is too long/i,
    /input is too long for requested model/i,
    /exceeds the context window/i,
    /input token count.*exceeds.*maximum/i,
    /maximum prompt length is \d+/i,
    /reduce the length of the messages/i,
    /maximum context length is \d+ tokens/i,
    /exceeds the limit of \d+/i,
    /exceeds the available context size/i,
    /greater than the context length/i,
    /context window exceeds limit/i,
    /exceeded model token limit/i,
    /context[ _]?length[ _]?exceeded/i,
    /context length is only \d+ tokens/i,
    /input length.*exceeds.*context length/i,
    /prompt too long; exceeded.*context length/i,
    /too large for model with \d+ maximum context length/i,
    /max tokens.*exceeded/i,
    /output length.*exceeds/i,
    /response length.*exceeds/i,
  ]

  const PAYLOAD_TOO_LARGE_PATTERNS = [
    /request_too_large/i,
    /request entity too large/i,
    /payload too large/i,
    /request too large/i,
  ]

  function isOverflow(message: string): boolean {
    return OVERFLOW_PATTERNS.some((p) => p.test(message)) || /^400\s*(status code)?\s*\(no body\)/i.test(message)
  }

  function isPayloadTooLarge(message: string): boolean {
    return PAYLOAD_TOO_LARGE_PATTERNS.some((p) => p.test(message))
  }

  export type ParsedAPICallError =
    | { type: "context_overflow"; message: string; statusCode?: number; responseBody?: string }
    | { type: "payload_too_large"; message: string; statusCode?: number; responseBody?: string }
    | { type: "api_error"; message: string; statusCode?: number; isRetryable: boolean; responseBody?: string }

  export function parseAPICallError(input: {
    providerID: string
    error: APICallError
    message?: string
  }): ParsedAPICallError {
    const m = input.message ?? input.error.message ?? ""
    const searchable = [m, input.error.responseBody].filter(Boolean).join("\n")

    if (isOverflow(searchable)) {
      return {
        type: "context_overflow",
        message: m,
        statusCode: input.error.statusCode,
        responseBody: input.error.responseBody,
      }
    }

    if (input.error.statusCode === 413 || isPayloadTooLarge(searchable)) {
      return {
        type: "payload_too_large",
        message: m,
        statusCode: input.error.statusCode,
        responseBody: input.error.responseBody,
      }
    }

    return {
      type: "api_error",
      message: m,
      statusCode: input.error.statusCode,
      isRetryable: input.error.isRetryable,
      responseBody: input.error.responseBody,
    }
  }

  export function parseStreamError(
    input: string,
  ): { type: "context_overflow" | "payload_too_large"; message: string } | undefined {
    try {
      const body = JSON.parse(input)
      if (body?.type !== "error") return undefined

      switch (body?.error?.code) {
        case "context_length_exceeded":
        case "token_limit_exceeded":
        case "max_tokens_exceeded":
        case "prompt_too_long":
        case "input_too_long":
          return { type: "context_overflow", message: body.error.message || "Context limit exceeded" }
        case "insufficient_quota":
        case "rate_limit_exceeded":
        case "authentication_error":
          return undefined
        default:
          if (body?.error?.message && isOverflow(body.error.message)) {
            return { type: "context_overflow", message: body.error.message }
          }
          if (
            isPayloadTooLarge(body?.error?.message ?? "") ||
            isPayloadTooLarge(body?.error?.type ?? "") ||
            isPayloadTooLarge(body?.error?.code ?? "")
          ) {
            return { type: "payload_too_large", message: body.error.message || "Payload too large" }
          }
          return undefined
      }
    } catch {
      if (isOverflow(input)) {
        return { type: "context_overflow", message: input }
      }
      if (isPayloadTooLarge(input)) {
        return { type: "payload_too_large", message: input }
      }
      return undefined
    }
  }

  export function isContextOverflowError(error: unknown): boolean {
    if (error instanceof Error) {
      const name = (error as any).name
      if (name === "ContextOverflowError" || name === "MessageContextOverflowError") {
        return true
      }
      return isOverflow(error.message)
    }
    if (typeof error === "string") {
      return isOverflow(error)
    }
    if (error && typeof error === "object") {
      const msg = (error as any).message
      if (typeof msg === "string") {
        return isOverflow(msg)
      }
      const data = (error as any).data
      if (typeof data === "object" && data?.type === "context_overflow") {
        return true
      }
    }
    return false
  }

  export function formatOverflowMessage(providerID: string, modelID?: string): string {
    const parts: string[] = []

    if (providerID) {
      parts.push(`Provider: ${providerID}`)
    }
    if (modelID) {
      parts.push(`Model: ${modelID}`)
    }

    parts.push(
      "The conversation has exceeded the model's context limit.",
      "Consider:",
      "  - Using /compact to summarize previous conversation",
      "  - Starting a new session",
      "  - Using a model with larger context window",
    )

    return parts.join("\n")
  }
}
