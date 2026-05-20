import type { APIRoute } from "astro"
import { getEnv } from "../../../lib/env"
import { lookupKeyByPlaintext, touchKey } from "../../../lib/keys"

/**
 * Internal endpoint called by the inference gateway to validate a customer
 * API key. Authentication is shared-secret via Authorization: Bearer <token>
 * matching env.GATEWAY_SHARED_SECRET (set via `wrangler secret put`).
 *
 * Body: { key: string }
 * Response: { valid: boolean, tier?: string, userId?: string, keyId?: string }
 */
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
}

export const POST: APIRoute = async (ctx) => {
  const env = getEnv(ctx) as unknown as { GATEWAY_SHARED_SECRET?: string; DB: D1Database }
  const auth = ctx.request.headers.get("Authorization") ?? ""
  const expected = env.GATEWAY_SHARED_SECRET
  if (!expected || !auth.startsWith("Bearer ") || auth.slice(7) !== expected) {
    return json({ valid: false, error: "forbidden" }, 403)
  }

  const body = (await ctx.request.json().catch(() => ({}))) as { key?: string }
  if (!body.key) return json({ valid: false, error: "missing_key" }, 400)

  const row = await lookupKeyByPlaintext(env as never, body.key)
  if (!row) return json({ valid: false })

  ctx.locals.runtime.ctx.waitUntil(touchKey(env as never, row.id))

  return json({
    valid: true,
    tier: row.tier,
    userId: row.user_id,
    keyId: row.id,
  })
}
