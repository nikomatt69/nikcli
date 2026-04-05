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
  if (!env?.USERS) return json({ error: "Service unavailable" }, 503)

  let body: { username?: string; email?: string; password?: string }
  try {
    body = await context.request.json()
  } catch {
    return json({ error: "Invalid JSON" }, 400)
  }

  const { username, email, password } = body
  if (!username || !email || !password) return json({ error: "Missing required fields" }, 400)
  if (username.length < 2) return json({ error: "Username too short" }, 400)
  if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400)

  const emailLower = email.toLowerCase().trim()
  const existing = await env.USERS.get(`email:${emailLower}`)
  if (existing) return json({ error: "Email already in use" }, 409)

  const id = crypto.randomUUID()
  const passwordHash = await bcrypt.hash(password, 10)
  const user = { id, username, email: emailLower, passwordHash, role: "user" as const, displayName: username }

  await env.USERS.put(`id:${id}`, JSON.stringify(user))
  await env.USERS.put(`email:${emailLower}`, id)

  return json({ success: true }, 201)
}
