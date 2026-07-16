import type { APIRoute } from "astro"
import {
  artifactJson,
  listArtifactsByOwner,
  parseArtifactPayload,
  resolveViewerUserId,
  writeArtifact,
  type ArtifactPayload,
} from "../../../lib/artifact"

export const prerender = false

/**
 * Create a published artifact. Returns { id, url, secret, viewKey }: the
 * secret authorizes updates, the viewKey grants read access without a login
 * (capability link, used by the CLI and for mobile previews).
 *
 * Auth is optional so the CLI can always publish without a password. When a
 * verifiable nikcli token is present (Bearer + optional X-Nikcli-Server), the
 * artifact is owned by that account and appears in its listings; otherwise it
 * is anonymous and reachable only through its viewKey capability link.
 */
export const POST: APIRoute = async (context) => {
  const env = (context.locals as App.Locals).runtime?.env
  if (!env?.ARTIFACTS) return artifactJson({ error: "Artifact storage unavailable" }, 503)

  const userId = await resolveViewerUserId(env, context.request)

  let body: ArtifactPayload
  try {
    body = (await context.request.json()) as ArtifactPayload
  } catch {
    return artifactJson({ error: "Invalid JSON body" }, 400)
  }

  const parsed = parseArtifactPayload(body)
  if ("error" in parsed) return artifactJson({ error: parsed.error }, 400)

  const id = crypto.randomUUID()
  const secret = crypto.randomUUID()
  const viewKey = crypto.randomUUID().replace(/-/g, "")
  const now = Date.now()

  await writeArtifact(
    env.ARTIFACTS,
    {
      id,
      secret,
      viewKey,
      title: parsed.title,
      description: parsed.description,
      filename: parsed.filename,
      contentType: parsed.contentType,
      kind: parsed.kind,
      size: parsed.content.byteLength,
      version: 1,
      sessionID: parsed.sessionID,
      owner: userId ?? "",
      author: parsed.author,
      time: { created: now, updated: now },
    },
    parsed.content,
  )

  const url = new URL(`/artifact/${id}`, context.url)
  url.search = ""
  return artifactJson({ id, url: url.toString(), secret, viewKey, version: 1 }, 201)
}

/** List the logged-in user's artifacts (newest first). */
export const GET: APIRoute = async (context) => {
  const env = (context.locals as App.Locals).runtime?.env
  if (!env?.ARTIFACTS) return artifactJson({ error: "Artifact storage unavailable" }, 503)

  const userId = await resolveViewerUserId(env, context.request)
  if (!userId) return artifactJson({ error: "Unauthorized" }, 401)

  const artifacts = await listArtifactsByOwner(env.ARTIFACTS, userId)
  return artifactJson(artifacts)
}

export const OPTIONS: APIRoute = () =>
  new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Nikcli-Server",
    },
  })
