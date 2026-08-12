import { Flag } from "@/flag/flag"

/**
 * Per-route body-size middleware.
 *
 * Bun's `maxRequestBodySize` (`NIKCLI_SERVER_MAX_BODY`, default 2 GB) is a
 * server-wide ceiling that allows large teleport uploads. That ceiling is too
 * generous for everyday API endpoints: a probe could otherwise declare a huge
 * `Content-Length` and force the server to allocate/buffer up to the ceiling.
 *
 * This middleware rejects requests whose `Content-Length` exceeds the per-route
 * limit. Routes that legitimately need the full ceiling — mobile teleport
 * chunk uploads under `/mobile/teleport/upload*` — are allowlisted.
 *
 * Behaviour:
 * - If `Content-Length` is missing, we accept (chunked uploads without CL fall
 *   through and remain bounded by Bun's server-wide ceiling).
 * - On rejection we return `413 Payload Too Large` with a plain-text body.
 * - Mounted before auth so oversized probes do not pay JWT/auth cost.
 */
const DEFAULT_LIMIT_BYTES = 256 * 1024 * 1024 // 256 MB
const LARGE_BODY_LIMIT_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB (matches Bun default ceiling)

const LARGE_BODY_PATTERNS: RegExp[] = [
  // Chunked working-tree uploads — begin + per-chunk append.
  /^\/mobile\/teleport\/upload(?:\/|$)/,
]

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

/** Server-wide ceiling — keep large-route limit aligned with Bun.serve. */
export function largeBodyLimit(): number {
  return Flag.NIKCLI_SERVER_MAX_BODY ?? LARGE_BODY_LIMIT_BYTES
}

export function limitFor(path: string): number {
  const ceiling = largeBodyLimit()
  for (const pattern of LARGE_BODY_PATTERNS) {
    if (pattern.test(path)) return ceiling
  }
  const configured = parsePositiveInt(process.env["NIKCLI_DEFAULT_BODY_MAX"]) ?? DEFAULT_LIMIT_BYTES
  return Math.min(configured, ceiling)
}

export function bodyLimitResponse(request: Request): Response | undefined {
  const header = request.headers.get("content-length")
  if (header) {
    const n = Number(header)
    const limit = limitFor(new URL(request.url).pathname)
    if (Number.isFinite(n) && n > limit) {
      return new Response(`Payload too large (limit ${limit} bytes)`, {
        status: 413,
        headers: { "Content-Type": "text/plain" },
      })
    }
  }
}
