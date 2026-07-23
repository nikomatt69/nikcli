/**
 * Centralized log redaction and safe serialization.
 *
 * The `Log` namespace calls into this module before writing any value to
 * a persistent log file. The aim is to keep three classes of secret out
 * of the log:
 *   1. Specific keys known to carry credentials (`token`, `secret`,
 *      `password`, `authorization`, `cookie`, `code`, `state`,
 *      `apiKey`, `apikey`, `session`, `bearer`, `x-api-key`).
 *   2. Query-string credentials embedded in URLs (?token=…, ?code=…).
 *   3. Suspected secret-shaped substrings (sk-…, ghp_…, JWT-shape).
 *
 * `safeStringify` is also a defensive serializer: it breaks cycles with a
 * `WeakSet`, caps depth at 4, and caps each leaf at 4096 characters so a
 * single log line never balloons.
 */

const REDACTED = "[REDACTED]"

const REDACT_KEYS = new Set([
  "token",
  "secret",
  "password",
  "authorization",
  "auth",
  "cookie",
  "code",
  "state",
  "apikey",
  "api_key",
  "session",
  "bearer",
  "x-api-key",
  "x_api_key",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "client_secret",
  "clientSecret",
  "private_key",
  "privateKey",
  "credential",
  "credentials",
])

const REDACT_PATTERNS: RegExp[] = [
  // OpenAI / Anthropic style API keys
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  // GitHub PATs (classic and fine-grained)
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bghs_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // Slack tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  // JWT shape (three dot-separated base64url segments)
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
]

const URL_CREDENTIAL_RE =
  /([?&])(token|code|access_token|refresh_token|api_key|apikey|state|session|password|secret)=([^&\s#]+)/gi

const MAX_DEPTH = 4
const MAX_LEAF = 4096

/**
 * Redact a value recursively. Walks objects and arrays, replacing values
 * whose key matches `REDACT_KEYS` with `[REDACTED]`. Strings are scanned
 * for token-shaped substrings and URL query credentials.
 */
export function redactValue(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (depth > MAX_DEPTH) return "[max-depth]"
  if (value === null || value === undefined) return value
  if (typeof value === "string") {
    return redactString(value)
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value
  }
  if (typeof value === "function" || typeof value === "symbol") {
    return undefined
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    }
  }
  if (typeof value === "object") {
    if (seen.has(value as object)) return "[circular]"
    seen.add(value as object)
    if (Array.isArray(value)) {
      return value.map((v) => redactValue(v, depth + 1, seen))
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Match both the original key and the lowercase form so we
      // catch `clientSecret`, `ClientSecret`, and `client_secret` with
      // a single entry in REDACT_KEYS.
      if (REDACT_KEYS.has(k) || REDACT_KEYS.has(k.toLowerCase())) {
        out[k] = REDACTED
      } else {
        out[k] = redactValue(v, depth + 1, seen)
      }
    }
    return out
  }
  return String(value)
}

/**
 * Redact token-shaped substrings and URL query credentials in a string.
 * Preserves the rest of the string verbatim so logs stay readable.
 */
export function redactString(input: string): string {
  if (input.length > MAX_LEAF) {
    input = input.slice(0, MAX_LEAF) + "...[truncated]"
  }
  let out = input
  // URL query credentials first, so the resulting "key=…" becomes
  // "key=[REDACTED]" instead of triggering the generic pattern below.
  out = out.replace(URL_CREDENTIAL_RE, (_match, prefix, key) => `${prefix}${key}=${REDACTED}`)
  for (const pattern of REDACT_PATTERNS) {
    out = out.replace(pattern, REDACTED)
  }
  return out
}

/**
 * Safely stringify a value for logging. Combines `redactValue` with a
 * depth and leaf cap. Use this anywhere a JSON-shaped value is written
 * to a log buffer.
 */
export function safeStringify(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): string {
  if (value === undefined) return "undefined"
  const redacted = redactValue(value, depth, seen)
  try {
    return JSON.stringify(redacted)
  } catch {
    return "[unserializable]"
  }
}

/**
 * Discover suspected secret-shaped substrings in a value. Useful for the
 * TUI toast pipeline, where a presenter might want to warn the user
 * before pasting a "secret" into chat.
 */
export function discover(value: unknown): string[] {
  const findings: string[] = []
  const seen = new WeakSet<object>()
  const walk = (v: unknown, depth: number) => {
    if (depth > MAX_DEPTH) return
    if (typeof v === "string") {
      for (const pattern of REDACT_PATTERNS) {
        pattern.lastIndex = 0
        const match = pattern.exec(v)
        if (match) findings.push(match[0])
      }
      URL_CREDENTIAL_RE.lastIndex = 0
      while (true) {
        const match = URL_CREDENTIAL_RE.exec(v)
        if (!match) break
        findings.push(match[0])
      }
      return
    }
    if (v && typeof v === "object") {
      if (seen.has(v as object)) return
      seen.add(v as object)
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        if (REDACT_KEYS.has(k) || REDACT_KEYS.has(k.toLowerCase())) {
          findings.push(`${k}=${REDACTED}`)
        } else {
          walk(child, depth + 1)
        }
      }
    }
  }
  walk(value, 0)
  return findings
}
