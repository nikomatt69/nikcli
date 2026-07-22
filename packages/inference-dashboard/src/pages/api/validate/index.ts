import type { APIRoute } from "astro"
import { ensureUser } from "../../../lib/auth"
import { lookupKeyByPlaintext, touchKey } from "../../../lib/keys"

/**
 * Internal endpoint called by the inference gateway. Authentication is
 * shared-secret via Authorization: Bearer <token> matching
 * env.GATEWAY_SHARED_SECRET (set via `wrangler secret put`).
 *
 * Two lookup modes:
 *   { key: string }                       — customer API key (nik_live_…)
 *   { accountId: string, email?: string } — identity account (OAuth access
 *     token already verified by the gateway against the issuer JWKS); the
 *     user row is lazily provisioned when an email claim is available so
 *     usage ingest can reference it.
 *
 * Response: { valid: boolean, tier?: string, userId?: string, keyId?: string | null }
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

  const body = (await ctx.request.json().catch(() => ({}))) as {
    key?: string
    accountId?: string
    email?: string
  }

  if (body.key) {
    const row = await lookupKeyByPlaintext({ DB }, body.key)
    if (!row) return json({ valid: false })
    await touchKey({ DB }, row.id).catch(() => {})
    return json({
      valid: true,
      tier: row.tier,
      userId: row.user_id,
      keyId: row.id,
    })
  }

  if (body.accountId) {
    try {
      // Same lazy provisioning + legacy-row adoption as dashboard sign-in.
      const user = await ensureUser({ DB }, body.accountId, body.email)
      return json({ valid: true, tier: user.plan, userId: user.id, keyId: null })
    } catch {
      return json({ valid: false })
    }
  }

  return json({ valid: false, error: "missing_key" }, 400)
}
