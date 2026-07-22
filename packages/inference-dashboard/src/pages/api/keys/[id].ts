import type { APIRoute } from "astro"
import { getCurrentUser } from "../../../lib/auth"
import { revokeApiKey } from "../../../lib/keys"

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
}

async function getUser(ctx: any) {
  return getCurrentUser(ctx).catch(() => null)
}

export const DELETE: APIRoute = async (ctx) => {
  const user = await getUser(ctx)
  if (!user) return json({ error: "unauthorized" }, 401)
  const id = ctx.params.id
  if (!id) return json({ error: "missing_id" }, 400)
  const env = (ctx.locals as any).runtime?.env
  const DB = env?.DB as D1Database
  if (!DB) return json({ error: "database_unavailable" }, 500)
  const ok = await revokeApiKey({ DB }, id, user.id)
  if (!ok) return json({ error: "not_found" }, 404)
  return json({ ok: true })
}
