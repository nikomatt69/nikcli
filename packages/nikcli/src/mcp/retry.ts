const TRANSIENT_ERRORS = [
  "load failed",
  "network connection was lost",
  "network request failed",
  "failed to fetch",
  "econnreset",
  "econnrefused",
  "etimedout",
  "socket hang up",
  "timeout",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "ENETUNREACH",
]

export interface RetryConfig {
  maxAttempts: number
  initialDelay: number
  maxDelay: number
  backoffFactor: number
  jitter: number
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
  jitter: 0.1,
}

export function calculateRetryDelay(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  const baseDelay = Math.min(config.initialDelay * Math.pow(config.backoffFactor, attempt), config.maxDelay)
  const jitter = baseDelay * config.jitter * (Math.random() * 2 - 1)
  return Math.floor(baseDelay + jitter)
}

export function isRetryableError(error: unknown): boolean {
  if (!error) return false
  const message = String(error instanceof Error ? error.message : error).toLowerCase()
  return TRANSIENT_ERRORS.some((m) => message.includes(m.toLowerCase()))
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number
    serverName: string
    onRetry?: (attempt: number, delay: number, error: Error) => void
    retryConfig?: RetryConfig
  },
): Promise<T> {
  const config = { ...DEFAULT_RETRY_CONFIG, ...options.retryConfig }
  const maxAttempts = options.maxAttempts ?? config.maxAttempts
  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (!isRetryableError(error)) {
        throw lastError
      }

      if (attempt === maxAttempts - 1) {
        break
      }

      const delay = calculateRetryDelay(attempt, config)
      options.onRetry?.(attempt + 1, delay, lastError)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}
