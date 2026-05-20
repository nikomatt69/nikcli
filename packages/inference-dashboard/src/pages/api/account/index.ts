import type { APIRoute } from "astro"
import { z } from "zod"
import { AuthError, getCurrentUser, updateUserPassword } from "../../../lib/auth"
import { getEnv } from "../../../lib/env"

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
}

const updateBody = z.object({
  name: z.string().min(1).max(80).optional(),
  currentPassword: z.string().min(1).optional(),
  nextPassword: z.string().min(8).optional(),
})

export const PATCH: APIRoute = async (ctx) => {
  const user = await getCurrentUser(ctx)
  if (!user) return json({ error: "unauthorized" }, 401)

  let parsed
  try {
    parsed = updateBody.parse(await ctx.request.json().catch(() => ({})))
  } catch (e) {
    return json({ error: "invalid_request", message: (e as Error).message }, 400)
  }

  const env = getEnv(ctx)
  const now = Math.floor(Date.now() / 1000)

  if (parsed.name !== undefined) {
    await env.DB.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?")
      .bind(parsed.name.trim() || null, now, user.id)
      .run()
  }

  if (parsed.currentPassword !== undefined || parsed.nextPassword !== undefined) {
    if (!parsed.currentPassword || !parsed.nextPassword) {
      return json({ error: "Current password and new password are required" }, 400)
    }
    try {
      await updateUserPassword(env, {
        userId: user.id,
        currentPassword: parsed.currentPassword,
        nextPassword: parsed.nextPassword,
      })
    } catch (e) {
      if (e instanceof AuthError) return json({ error: e.message }, e.status)
      throw e
    }
  }

  return json({ ok: true })
}

export const DELETE: APIRoute = async (ctx) => {
  const user = await getCurrentUser(ctx)
  if (!user) return json({ error: "unauthorized" }, 401)

  const env = getEnv(ctx)

  // Delete cascade manually to avoid FK issues
  await env.DB.prepare("DELETE FROM usage_events WHERE user_id = ?").bind(user.id).run()
  await env.DB.prepare("DELETE FROM api_keys WHERE user_id = ?").bind(user.id).run()
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run()
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run()

  ctx.cookies.delete("nik_session", { path: "/" })

  return json({ ok: true })
}
