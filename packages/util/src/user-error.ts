import { Schema } from "effect"

/**
 * Error class for errors that have a user-friendly presentation. Throw
 * `UserFacingError` from anywhere a regular `Error` would be thrown when the
 * message is meant to be shown directly to the end user (CLI, TUI toast,
 * install/upgrade failure).
 *
 * The CLI's FormatError and the TUI toast pipeline recognize this class and
 * render its `title`, `what`, and `try` fields separately instead of dumping
 * a stack trace.
 *
 * Implemented as a `Schema.TaggedErrorClass` so it integrates with the Effect
 * error channel: the instance carries `_tag === "UserFacingError"`,
 * `instanceof UserFacingError` continues to work for plain `try/catch` paths,
 * and `Effect.catchTag("UserFacingError", ...)` works on the Effect side.
 */
export class UserFacingError extends Schema.TaggedErrorClass<UserFacingError>()("UserFacingError", {
  title: Schema.String,
  what: Schema.String,
  try: Schema.String,
  docs: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Unknown),
}) {
  /** Alias for `try` so existing call sites can read `err.trySuggestion`. */
  get trySuggestion(): string {
    return this.try
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
