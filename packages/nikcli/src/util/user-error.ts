/**
 * Error class for errors that have a user-friendly presentation. Throw
 * `UserFacingError` from anywhere a regular `Error` would be thrown when the
 * message is meant to be shown directly to the end user (CLI, TUI toast,
 * install/upgrade failure).
 *
 * The CLI's FormatError and the TUI toast pipeline recognize this class and
 * render its `title`, `what`, and `try` fields separately instead of dumping
 * a stack trace.
 */
export class UserFacingError extends Error {
  readonly title: string
  readonly what: string
  readonly trySuggestion: string
  readonly docs?: string

  constructor(init: { title: string; what: string; try: string; docs?: string; cause?: unknown }) {
    super(init.title)
    this.name = "UserFacingError"
    this.title = init.title
    this.what = init.what
    this.trySuggestion = init.try
    this.docs = init.docs
    if (init.cause !== undefined) this.cause = init.cause
  }

  /** Render a one-shot user-facing string (for CLI output). */
  format(): string {
    const lines = [`${this.title}`, `  What: ${this.what}`, `  Try:  ${this.trySuggestion}`]
    if (this.docs) lines.push(`  Docs: ${this.docs}`)
    return lines.join("\n")
  }
}

/**
 * Render a UserFacingError as a structured object suitable for the TUI toast
 * system. Returns null when the error is not a UserFacingError.
 */
export function userFacingParts(error: unknown): {
  title: string
  what: string
  try: string
  docs?: string
} | null {
  if (error instanceof UserFacingError) {
    return {
      title: error.title,
      what: error.what,
      try: error.trySuggestion,
      ...(error.docs ? { docs: error.docs } : {}),
    }
  }
  return null
}
