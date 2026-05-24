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
    // Calculate base delay with exponential backoff
    const baseDelay = RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1)

    if (error) {
      const headers = error.responseHeaders
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

        // Add 10% jitter to prevent thundering herd
        const jitter = baseDelay * Math.random() * 0.1
        return Math.min(baseDelay + jitter, RETRY_MAX_DELAY_NO_HEADERS)
      }
    }

    // Add 10% jitter to prevent thundering herd
    const jitter = baseDelay * Math.random() * 0.1
    return Math.min(baseDelay + jitter, RETRY_MAX_DELAY_NO_HEADERS)
  }

  function mapJsonRetryMessage(message: string): string | undefined {
    try {
      const json = JSON.parse(message)
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
      // Not JSON
    }
    return undefined
  }

  export function retryable(error: { name: string; data?: Record<string, unknown> }) {
    if (MessageV2.APIError.isInstance(error)) {
      const status = error.data.statusCode
      // 5xx errors are transient server failures - always retry them even if not marked retryable
      if (!error.data.isRetryable && !(status !== undefined && status >= 500)) return undefined
      if (
        error.data.responseBody?.includes("FreeUsageLimitError") ||
        error.data.message.includes("FreeUsageLimitError")
      ) {
        return `Free usage exceeded, add credits https://nikcli.store/zen`
      }
      if (error.data.message.includes("Overloaded")) return "Provider is overloaded"
      return mapJsonRetryMessage(error.data.message) ?? error.data.message
    }

    if (typeof error.data?.message === "string") {
      return mapJsonRetryMessage(error.data.message)
    }

    return undefined
  }
}
