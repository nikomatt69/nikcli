const FRIENDLY_BY_NAME: Record<string, string> = {
  MessageAbortedError: "Operation cancelled",
  AbortError: "Operation cancelled",
  TimeoutError: "Request timed out",
}

const FRIENDLY_BY_PATTERN: Array<[RegExp, string]> = [
  [/fetch failed/i, "Network error. Check your connection."],
  [/ECONNREFUSED|ENOTFOUND/i, "Could not connect to the server"],
  [/Unauthorized|401/, "Unauthorized — please sign in again"],
  [/Rate limit|429/, "Rate limited — try again in a moment"],
]

export function friendlyErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (error instanceof Error) {
    const mapped = FRIENDLY_BY_NAME[error.name]
    if (mapped) return mapped
    const message = error.message?.trim()
    if (message) {
      for (const [pattern, friendly] of FRIENDLY_BY_PATTERN) {
        if (pattern.test(message)) return friendly
      }
      return message
    }
  }

  if (error && typeof error === "object") {
    const value = error as Record<string, any>
    const name = typeof value.name === "string" ? FRIENDLY_BY_NAME[value.name] : undefined
    if (name) return name
    const message =
      value?.error?.message ?? value?.data?.message ?? (typeof value.message === "string" ? value.message : undefined)
    if (typeof message === "string" && message.trim()) {
      for (const [pattern, friendly] of FRIENDLY_BY_PATTERN) {
        if (pattern.test(message)) return friendly
      }
      return message.trim()
    }
    // Tagged errors without a message: the tag still beats the generic
    // fallback ("NotFoundError" over "Something went wrong").
    if (typeof value._tag === "string" && value._tag) return value._tag
  }

  return fallback
}
