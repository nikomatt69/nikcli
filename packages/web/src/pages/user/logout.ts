import type { APIRoute } from "astro"

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export const POST: APIRoute = async (context) => {
  const env = (context.locals as App.Locals).runtime?.env
  if (!env?.SESSIONS) return json({ success: true })

  const auth = context.request.headers.get("Authorization")
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null
  if (token) await env.SESSIONS.delete(`token:${token}`)

  return json({ success: true })
}
