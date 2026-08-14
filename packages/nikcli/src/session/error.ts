/**
 * Session-domain errors.
 *
 * These live in their own module for two reasons:
 *
 * 1. `session/index.ts` imports `session/message-v2.ts`, so the two cannot
 *    share a class declared in either of them without a cycle. Both import
 *    this module instead.
 * 2. Session rows have been SQL since `20260611*`. These errors keep the
 *    domain surface independent from its persistence implementation.
 *
 * Wire compatibility: the HTTP boundary serializes not-found failures as
 * `{ name: "NotFoundError", data: { message } }` and the response schemas
 * declare that exact literal. The `_tag` here is deliberately *not* that
 * literal, so boundaries must emit the literal explicitly rather than
 * forwarding `error._tag`. See `server/httpapi/session.ts`.
 */
import { Schema } from "effect"

export namespace SessionError {
  /** A session, message, or part was addressed by an ID that does not exist. */
  export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("SessionNotFoundError", {
    message: Schema.String,
  }) {}

  /** A session read or write failed for a reason that is not "missing". */
  export class IOError extends Schema.TaggedErrorClass<IOError>()("SessionIOError", {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }) {}

  export type Any = NotFoundError | IOError

  export function isNotFound(error: unknown): error is NotFoundError {
    return error instanceof NotFoundError
  }
}
