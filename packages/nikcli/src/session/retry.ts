import type { NamedError } from "@nikcli-ai/util/error"
import { MessageV2 } from "./message-v2"

export namespace SessionRetry {
  export const RETRY_INITIAL_DELAY = 2000
  export const RETRY_BACKOFF_FACTOR = 2
  export const RETRY_MAX_DELAY_NO_HEADERS = 30_000
  export const RETRY_MAX_DELAY = 2_147_483_647
  export const RETRY_MAX_ATTEMPTS = 5

  export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError")
    }

    return new Promise((resolve, reject) => {
      let settled = false
      const abortHandler = () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        signal.removeEventListener("abort", abortHandler)
        reject(new DOMException("Aborted", "AbortError"))
      }
      const timeout = setTimeout(
        () => {
          settled = true
          signal.removeEventListener("abort", abortHandler)
          resolve()
        },
        Math.min(ms, RETRY_MAX_DELAY),
      )
      signal.addEventListener("abort", abortHandler, { once: true })
    })
  }

  export function delay(attempt: number, error?: MessageV2.APIError) {
    if (error) {
      const headers = error.data.responseHeaders
      if (headers) {
        const retryAfterMs = headers["retry-after-ms"]
        if (retryAfterMs) {
          const parsedMs = Number.parseFloat(retryAfterMs)
          if (!Number.isNaN(parsedMs)) {
            return parsedMs
          }
        }

        const retryAfter = headers["retry-after"]
        if (retryAfter) {
          const parsedSeconds = Number.parseFloat(retryAfter)
          if (!Number.isNaN(parsedSeconds)) {
            return Math.ceil(parsedSeconds * 1000)
          }
          const parsed = Date.parse(retryAfter) - Date.now()
          if (!Number.isNaN(parsed) && parsed > 0) {
            return Math.ceil(parsed)
          }
        }

        return RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1)
      }
    }

    return Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), RETRY_MAX_DELAY_NO_HEADERS)
  }

  export function retryable(error: ReturnType<NamedError["toObject"]>) {
    if (MessageV2.APIError.isInstance(error)) {
      if (!error.data.isRetryable) return undefined
      if (error.data.responseBody?.includes("FreeUsageLimitError"))
        return `Free usage exceeded, add credits https://opencode.ai/zen`
      return error.data.message.includes("Overloaded") ? "Provider is overloaded" : error.data.message
    }

    if (typeof error.data?.message === "string") {
      try {
        const json = JSON.parse(error.data.message)
        if (json.type === "error" && json.error?.type === "too_many_requests") {
          return "Too Many Requests"
        }
        if (json.code?.includes("exhausted") || json.code?.includes("unavailable")) {
          return "Provider is overloaded"
        }
        if (json.type === "error" && json.error?.code?.includes("rate_limit")) {
          return "Rate Limited"
        }
        if (
          json.error?.message?.includes("no_kv_space") ||
          (json.type === "error" && json.error?.type === "server_error") ||
          !!json.error
        ) {
          return "Provider Server Error"
        }
      } catch {
        // Not JSON, fall through
      }
    }

    return undefined
  }
}
