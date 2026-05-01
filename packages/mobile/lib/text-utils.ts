/**
 * Shared text utilities for the mobile app.
 */

/**
 * Truncates text to a specified limit, normalizing whitespace.
 * Used for activity summaries, notification bodies, etc.
 */
export function compactActivityText(value: string | null | undefined, limit = 72): string {
  if (!value) return ""
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

/**
 * Formats a timestamp as a human-readable relative time string.
 * e.g., "5m ago", "2h ago", "3d ago"
 */
export function relativeTime(value: number): string {
  const diffMs = Date.now() - value
  const diffSeconds = Math.max(1, Math.round(diffMs / 1000))

  if (diffSeconds < 60) return `${diffSeconds}s ago`

  const diffMinutes = Math.round(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m ago`

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.round(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`

  const diffWeeks = Math.round(diffDays / 7)
  if (diffWeeks < 5) return `${diffWeeks}w ago`

  const diffMonths = Math.round(diffDays / 30)
  if (diffMonths < 12) return `${diffMonths}mo ago`

  const diffYears = Math.round(diffDays / 365)
  return `${diffYears}y ago`
}
