import type { APIRoute } from "astro"
import { getCurrentUser } from "../../../lib/auth"
import { getEnv } from "../../../lib/env"
import { revokeApiKey } from "../../../lib/keys"

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
}

export const DELETE: APIRoute = async (ctx) => {
  const user = await getCurrentUser(ctx)
  if (!user) return json({ error: "unauthorized" }, 401)
  const id = ctx.params.id
  if (!id) return json({ error: "missing_id" }, 400)
  const ok = await revokeApiKey(getEnv(ctx), id, user.id)
  if (!ok) return json({ error: "not_found" }, 404)
  return json({ ok: true })
}
