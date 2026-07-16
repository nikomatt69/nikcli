import type { APIRoute } from "astro"
import { z } from "zod"
import { clearSessionCookie, getSessionUser, readSessionCookie } from "../../../lib/auth"
import { getEnv } from "../../../lib/env"

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const updateBody = z.object({
  name: z.string().min(1).max(80).optional(),
  currentPassword: z.string().min(1).optional(),
  nextPassword: z.string().min(8).optional(),
})

async function getUser(ctx: any) {
  const sessionId = readSessionCookie(ctx.cookies)
  return getSessionUser(getEnv(ctx), sessionId)
}

export const PATCH: APIRoute = async (ctx) => {
  const user = await getUser(ctx)
  if (!user) return json({ error: "unauthorized" }, 401)

  let parsed
  try {
    parsed = updateBody.parse(await ctx.request.json().catch(() => ({})))
  } catch (e) {
    return json({ error: "invalid_request", message: (e as Error).message }, 400)
  }

  const env = (ctx.locals as any).runtime?.env
  const DB = env?.DB as D1Database
  if (!DB) return json({ error: "database_unavailable" }, 500)
  const now = Math.floor(Date.now() / 1000)

  if (parsed.name !== undefined) {
    await DB.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?")
      .bind(parsed.name.trim() || null, now, user.id)
      .run()
  }

  if (parsed.currentPassword !== undefined || parsed.nextPassword !== undefined) {
    return json({ error: "Password management has moved to the identity issuer" }, 410)
  }

  return json({ ok: true })
}

export const DELETE: APIRoute = async (ctx) => {
  const user = await getUser(ctx)
  if (!user) return json({ error: "unauthorized" }, 401)

  const env = (ctx.locals as any).runtime?.env
  const DB = env?.DB as D1Database
  if (!DB) return json({ error: "database_unavailable" }, 500)

  await DB.prepare("DELETE FROM usage_events WHERE user_id = ?").bind(user.id).run()
  await DB.prepare("DELETE FROM api_keys WHERE user_id = ?").bind(user.id).run()
  await DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run()

  clearSessionCookie(ctx.cookies)

  return json({ ok: true })
}
