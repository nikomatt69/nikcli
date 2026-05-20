import type { APIRoute } from "astro"
import { z } from "zod"
import { AuthError, createSession, setSessionCookie, verifyCredentials } from "../../../lib/auth"

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

  // Cloudflare Pages: env bindings are in ctx.locals.runtime.env
  const env = (ctx.locals as any).runtime?.env
  if (!env) {
    return json({ error: "runtime_env_unavailable" }, 500)
  }
  const DB = env.DB as D1Database | undefined
  if (!DB) {
    return json({ error: "database_unavailable" }, 500)
  }
  const runtimeEnv = { DB }

  try {
    const user = await verifyCredentials(runtimeEnv, parsed)
    const sessionId = await createSession(runtimeEnv, user.id, {
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
