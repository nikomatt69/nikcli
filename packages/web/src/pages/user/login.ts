import type { APIRoute } from "astro"
import bcrypt from "bcryptjs"

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export const POST: APIRoute = async (context) => {
  const env = (context.locals as App.Locals).runtime?.env
  if (!env?.USERS || !env?.SESSIONS) return json({ error: "Service unavailable" }, 503)

  let body: { email?: string; password?: string }
  try {
    body = await context.request.json()
  } catch {
    return json({ error: "Invalid JSON" }, 400)
  }

  const { email, password } = body
  if (!email || !password) return json({ error: "Missing email or password" }, 400)

  const emailLower = email.toLowerCase().trim()
  const userId = await env.USERS.get(`email:${emailLower}`)
  if (!userId) return json({ error: "Invalid credentials" }, 401)

  const raw = await env.USERS.get(`id:${userId}`)
  if (!raw) return json({ error: "Invalid credentials" }, 401)

  const stored = JSON.parse(raw) as { id: string; username: string; email: string; passwordHash: string; role: string; displayName?: string }
  const valid = await bcrypt.compare(password, stored.passwordHash)
  if (!valid) return json({ error: "Invalid credentials" }, 401)

  const token = crypto.randomUUID()
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days

  await env.SESSIONS.put(`token:${token}`, JSON.stringify({ userId: stored.id, expiresAt }), {
    expirationTtl: 7 * 24 * 60 * 60,
  })

  const { passwordHash: _, ...user } = stored
  return json({ user, token })
}
