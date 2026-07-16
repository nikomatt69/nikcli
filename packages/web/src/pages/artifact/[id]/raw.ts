import type { APIRoute } from "astro"
import {
  canViewArtifact,
  headArtifactContent,
  parseByteRange,
  readArtifact,
  readArtifactContent,
  readArtifactContentRange,
  resolveViewerUserId,
} from "../../../lib/artifact"

export const prerender = false

// Self-contained pages only: no external scripts/styles/fetch, media from
// this origin or data: URIs. Mirrors the sandboxing of hosted artifacts.
const HTML_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src data:",
].join("; ")

/**
 * Serve the artifact's current (or ?v=N) content bytes. Access requires the
 * owner's login (cookie/Bearer) or the artifact's ?key= capability.
 */
export const GET: APIRoute = async (context) => {
  const env = (context.locals as App.Locals).runtime?.env
  if (!env?.ARTIFACTS) return new Response("Artifact storage unavailable", { status: 503 })

  const id = context.params.id
  if (!id) return new Response("Missing artifact id", { status: 400 })

  const stored = await readArtifact(env.ARTIFACTS, id)
  if (!stored) return new Response("Artifact not found", { status: 404 })

  const userId = await resolveViewerUserId(env, context.request)
  const key = context.url.searchParams.get("key")
  if (!canViewArtifact(stored, { userId, key })) {
    return new Response("Unauthorized", { status: userId ? 403 : 401 })
  }

  const requested = Number(context.url.searchParams.get("v"))
  const version =
    Number.isInteger(requested) && requested >= 1 && requested <= stored.version ? requested : stored.version

  const rangeHeader = context.request.headers.get("Range")
  const head = rangeHeader ? await headArtifactContent(env.ARTIFACTS, id, version) : null
  if (rangeHeader && !head) return new Response("Artifact content missing", { status: 404 })

  const range = rangeHeader && head ? parseByteRange(rangeHeader, head.size) : null
  if (rangeHeader && !range) {
    return new Response("Requested range not satisfiable", {
      status: 416,
      headers: { "Content-Range": `bytes */${head!.size}`, "Accept-Ranges": "bytes" },
    })
  }

  const object = range
    ? await readArtifactContentRange(env.ARTIFACTS, id, version, range)
    : await readArtifactContent(env.ARTIFACTS, id, version)
  if (!object) return new Response("Artifact content missing", { status: 404 })

  const headers: Record<string, string> = {
    "Content-Type": stored.contentType,
    // Private per-user content: never let shared caches hold it.
    "Cache-Control": "private, max-age=60",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    ETag: object.httpEtag,
  }
  if (range && head) {
    headers["Content-Length"] = String(range.length)
    headers["Content-Range"] = `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`
  } else {
    headers["Content-Length"] = String(object.size)
  }
  if (stored.kind === "html") {
    headers["Content-Security-Policy"] = HTML_CSP
  }
  if (stored.contentType === "image/svg+xml") {
    headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'"
  }
  if (stored.kind === "markdown" || stored.kind === "text") {
    // Never let browsers sniff markdown/plain text into renderable HTML.
    headers["Content-Type"] = "text/plain; charset=utf-8"
  }

  return new Response(object.body as unknown as BodyInit, { status: range ? 206 : 200, headers })
}
