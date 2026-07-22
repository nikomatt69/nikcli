import type { APIRoute } from "astro"
import { z } from "zod"

/**
 * Receives a usage event from the inference gateway. Shared-secret auth.
 * One row per /v1/chat/completions call.
 */
const body = z.object({
  // Null for OAuth (identity-token) calls that have no API key.
  keyId: z.string().nullable().optional(),
  userId: z.string(),
  model: z.string(),
  resolvedModel: z.string(),
  provider: z.string().nullable().optional(),
  upstreamModel: z.string().nullable().optional(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  billedUsd: z.number().nonnegative(),
  upstreamUsd: z.number().nonnegative(),
  savedUsd: z.number().nonnegative(),
  cache: z.string().nullable().optional(),
  rid: z.string().nullable().optional(),
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
}

function id(byteLen = 16): string {
  const buf = new Uint8Array(byteLen)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")
}

export const POST: APIRoute = async (ctx) => {
  const env = (ctx.locals as any).runtime?.env
  const DB = env?.DB as D1Database | undefined
  const GATEWAY_SHARED_SECRET = env?.GATEWAY_SHARED_SECRET as string | undefined

  if (!GATEWAY_SHARED_SECRET) {
    return json({ error: "gateway_secret_not_configured" }, 500)
  }

  const auth = ctx.request.headers.get("Authorization") ?? ""
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== GATEWAY_SHARED_SECRET) {
    return json({ error: "forbidden" }, 403)
  }

  let parsed
  try {
    parsed = body.parse(await ctx.request.json())
  } catch (e) {
    return json({ error: "invalid_request", message: (e as Error).message }, 400)
  }

  if (!DB) {
    return json({ error: "database_unavailable" }, 500)
  }

  await DB.prepare(
    `INSERT INTO usage_events
     (id, api_key_id, user_id, model, resolved_model, provider, upstream_model,
      prompt_tokens, completion_tokens, billed_usd, upstream_usd, saved_usd, cache, rid, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, unixepoch())`,
  )
    .bind(
      id(),
      parsed.keyId ?? null,
      parsed.userId,
      parsed.model,
      parsed.resolvedModel,
      parsed.provider ?? null,
      parsed.upstreamModel ?? null,
      parsed.promptTokens,
      parsed.completionTokens,
      parsed.billedUsd,
      parsed.upstreamUsd,
      parsed.savedUsd,
      parsed.cache ?? null,
      parsed.rid ?? null,
    )
    .run()

  return json({ ok: true })
}
