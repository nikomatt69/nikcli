import { APICallError } from "ai"

export namespace ProviderError {
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
    /request entity too large/i,
    /context length is only \d+ tokens/i,
    /input length.*exceeds.*context length/i,
    /prompt too long; exceeded.*context length/i,
    /too large for model with \d+ maximum context length/i,
    /max tokens.*exceeded/i,
    /output length.*exceeds/i,
    /response length.*exceeds/i,
  ]

  function isOverflow(message: string): boolean {
    return OVERFLOW_PATTERNS.some((p) => p.test(message)) || /^4(00|13)\s*\(no body\)/i.test(message)
  }

  export type ParsedAPICallError =
    | { type: "context_overflow"; message: string; responseBody?: string }
    | { type: "api_error"; message: string; statusCode?: number; isRetryable: boolean; responseBody?: string }

  export function parseAPICallError(input: { providerID: string; error: APICallError }): ParsedAPICallError {
    const m = input.error.message || ""

    if (isOverflow(m) || input.error.statusCode === 413) {
      return {
        type: "context_overflow",
        message: m,
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

  export function parseStreamError(input: string): { type: "context_overflow"; message: string } | undefined {
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
          return undefined
      }
    } catch {
      if (isOverflow(input)) {
        return { type: "context_overflow", message: input }
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
