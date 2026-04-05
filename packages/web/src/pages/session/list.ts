import type { APIRoute } from "astro"

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export const GET: APIRoute = async (context) => {
  const env = (context.locals as App.Locals).runtime?.env
  if (!env?.USERS || !env?.SESSIONS) return json({ error: "Service unavailable" }, 503)

  const auth = context.request.headers.get("Authorization")
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null
  if (!token) return json({ error: "Unauthorized" }, 401)

  const sessionRaw = await env.SESSIONS.get(`token:${token}`)
  if (!sessionRaw) return json({ error: "Unauthorized" }, 401)

  const session = JSON.parse(sessionRaw) as { userId: string; expiresAt: number }
  if (Date.now() > session.expiresAt) {
    await env.SESSIONS.delete(`token:${token}`)
    return json({ error: "Token expired" }, 401)
  }

  const listRaw = await env.SESSIONS.get(`sessions:${session.userId}`)
  const sessions = listRaw ? JSON.parse(listRaw) : []

  return json(sessions)
}
