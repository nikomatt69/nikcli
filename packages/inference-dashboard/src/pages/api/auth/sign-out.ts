import type { APIRoute } from "astro"
import { clearSessionCookie, destroySession, readSessionCookie } from "../../../lib/auth"
import { getEnv } from "../../../lib/env"

export const POST: APIRoute = async (ctx) => {
  const sessionId = readSessionCookie(ctx.cookies)
  if (sessionId) await destroySession(getEnv(ctx), sessionId)
  clearSessionCookie(ctx.cookies)
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } })
}
