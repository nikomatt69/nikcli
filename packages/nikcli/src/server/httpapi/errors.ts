/**
 * HTTP boundary helpers.
 *
 * The goal is to keep `server.ts`'s `onError` middleware as a thin
 * unknown-defect fallback. Every expected service failure is caught
 * per-route via `Effect.catchTag` and translated to a typed HTTP body
 * with this module's helpers.
 *
 * The body shape mirrors the legacy Hono `onError` chain so the SDK and
 * the public API contract are preserved byte-for-byte:
 *
 *   { name: string, data: Record<string, unknown> }
 *
 * where `name` is the wire literal (e.g. `"NotFoundError"`) and `data`
 * carries the user-facing fields. Domain `_tag` values such as
 * `"SessionNotFoundError"` must not be forwarded.
 */
import { Effect } from "effect"

/** Build a 404 body for domain not-found errors. */
export function notFound(message: string) {
  return Effect.fail({
    __http: { status: 404, name: "NotFound" as const, data: { message } },
  })
}

/** Build a 400 body for the most common validation/bad-input errors. */
export function badRequest(name: string, data: Record<string, unknown>) {
  return Effect.fail({
    __http: { status: 400, name, data },
  })
}

/** Build a 409 body for resource-busy conflicts (e.g. `Session.BusyError`). */
export function conflict(name: string, data: Record<string, unknown>) {
  return Effect.fail({
    __http: { status: 409, name, data },
  })
}

/** Extract a typed HTTP body from an `Effect` failure. Returns null when the
 * failure is not a recognized HTTP-mapped error. */
export function asHttpBody(
  cause: unknown,
): { status: number; body: { name: string; data: Record<string, unknown> } } | null {
  if (typeof cause !== "object" || cause === null) return null
  const marker = (cause as { __http?: unknown }).__http
  if (typeof marker !== "object" || marker === null) return null
  const m = marker as { status: number; name: string; data: Record<string, unknown> }
  if (typeof m.status !== "number" || typeof m.name !== "string" || typeof m.data !== "object" || m.data === null) {
    return null
  }
  return { status: m.status, body: { name: m.name, data: m.data } }
}
