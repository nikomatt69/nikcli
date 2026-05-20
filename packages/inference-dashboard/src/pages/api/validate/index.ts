import type { APIRoute } from "astro"
import { lookupKeyByPlaintext } from "../../../lib/keys"

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
  const env = (ctx.locals as any).runtime?.env
  const DB = env?.DB as D1Database | undefined
  const GATEWAY_SHARED_SECRET = env?.GATEWAY_SHARED_SECRET as string | undefined

  if (!GATEWAY_SHARED_SECRET) {
    return json({ valid: false, error: "gateway_secret_not_configured" }, 500)
  }

  const auth = ctx.request.headers.get("Authorization") ?? ""
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== GATEWAY_SHARED_SECRET) {
    return json({ valid: false, error: "forbidden" }, 403)
  }

  if (!DB) {
    return json({ valid: false, error: "database_unavailable" }, 500)
  }

  const body = (await ctx.request.json().catch(() => ({}))) as { key?: string }
  if (!body.key) return json({ valid: false, error: "missing_key" }, 400)

  const row = await lookupKeyByPlaintext({ DB }, body.key)
  if (!row) return json({ valid: false })

  return json({
    valid: true,
    tier: row.tier,
    userId: row.user_id,
    keyId: row.id,
  })
}
