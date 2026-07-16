import type { APIRoute } from "astro"
import {
  artifactJson,
  canViewArtifact,
  parseArtifactPayload,
  publicMeta,
  readArtifact,
  resolveViewerUserId,
  writeArtifact,
  type ArtifactPayload,
} from "../../../lib/artifact"

export const prerender = false

/** Artifact metadata for the owner (Bearer/cookie) or a valid ?key= capability. */
export const GET: APIRoute = async (context) => {
  const env = (context.locals as App.Locals).runtime?.env
  if (!env?.ARTIFACTS) return artifactJson({ error: "Artifact storage unavailable" }, 503)

  const id = context.params.id
  if (!id) return artifactJson({ error: "Missing artifact id" }, 400)

  const stored = await readArtifact(env.ARTIFACTS, id)
  if (!stored) return artifactJson({ error: "Artifact not found" }, 404)

  const userId = await resolveViewerUserId(env, context.request)
  const key = context.url.searchParams.get("key")
  if (!canViewArtifact(stored, { userId, key })) {
    return artifactJson({ error: "Unauthorized" }, userId ? 403 : 401)
  }

  return artifactJson(publicMeta(stored))
}

/** Publish a new version of an existing artifact (requires the creation secret). */
export const PUT: APIRoute = async (context) => {
  const env = (context.locals as App.Locals).runtime?.env
  if (!env?.ARTIFACTS) return artifactJson({ error: "Artifact storage unavailable" }, 503)

  const id = context.params.id
  if (!id) return artifactJson({ error: "Missing artifact id" }, 400)

  let body: ArtifactPayload & { secret?: unknown }
  try {
    body = (await context.request.json()) as ArtifactPayload & { secret?: unknown }
  } catch {
    return artifactJson({ error: "Invalid JSON body" }, 400)
  }

  const stored = await readArtifact(env.ARTIFACTS, id)
  if (!stored) return artifactJson({ error: "Artifact not found" }, 404)
  if (typeof body.secret !== "string" || body.secret !== stored.secret) {
    return artifactJson({ error: "Invalid secret" }, 403)
  }

  const parsed = parseArtifactPayload({
    ...body,
    // Updates may omit descriptive fields to keep the existing ones.
    title: body.title ?? stored.title,
    filename: body.filename ?? stored.filename,
    contentType: body.contentType ?? stored.contentType,
  })
  if ("error" in parsed) return artifactJson({ error: parsed.error }, 400)

  const next = {
    ...stored,
    title: parsed.title,
    description: parsed.description ?? stored.description,
    filename: parsed.filename,
    contentType: parsed.contentType,
    kind: parsed.kind,
    size: parsed.content.byteLength,
    version: stored.version + 1,
    time: { ...stored.time, updated: Date.now() },
  }
  await writeArtifact(env.ARTIFACTS, next, parsed.content)

  const url = new URL(`/artifact/${id}`, context.url)
  url.search = ""
  return artifactJson({ id, url: url.toString(), version: next.version })
}

export const OPTIONS: APIRoute = () =>
  new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Nikcli-Server",
    },
  })
