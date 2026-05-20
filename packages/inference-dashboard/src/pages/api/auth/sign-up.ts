import type { APIRoute } from "astro"
import { z } from "zod"
import { createSession, createUser, setSessionCookie, AuthError } from "../../../lib/auth"
import { getEnv } from "../../../lib/env"
import { issueApiKey } from "../../../lib/keys"

const body = z.object({
  email: z.email(),
  password: z.string().min(8),
  name: z.string().min(1).max(80).optional(),
})

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
    const user = await createUser(env, parsed)
    const sessionId = await createSession(env, user.id, {
      userAgent: ctx.request.headers.get("user-agent"),
      ip: ctx.request.headers.get("cf-connecting-ip"),
    })
    setSessionCookie(ctx.cookies, sessionId)

    // Create first API key automatically
    const apiKey = await issueApiKey(env, { userId: user.id, name: "default" })

    return json({ user, apiKey })
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message }, e.status)
    return json({ error: "internal_error", message: (e as Error).message }, 500)
  }
}
