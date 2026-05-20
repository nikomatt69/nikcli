import type { APIRoute } from "astro"
import { z } from "zod"
import { AuthError, createSession, setSessionCookie, verifyCredentials } from "../../../lib/auth"
import { getEnv } from "../../../lib/env"

const body = z.object({ email: z.email(), password: z.string().min(1) })

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
}

export const POST: APIRoute = async (ctx) => {
  let parsed
  try {
    parsed = body.parse(await ctx.request.json())
  } catch (e) {
    return json({ error: "invalid_request", message: (e as Error).message }, 400)
  }
  const env = getEnv(ctx)
  try {
    const user = await verifyCredentials(env, parsed)
    const sessionId = await createSession(env, user.id, {
      userAgent: ctx.request.headers.get("user-agent"),
      ip: ctx.request.headers.get("cf-connecting-ip"),
    })
    setSessionCookie(ctx.cookies, sessionId)
    return json({ user })
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message }, e.status)
    return json({ error: "internal_error", message: (e as Error).message }, 500)
  }
}
