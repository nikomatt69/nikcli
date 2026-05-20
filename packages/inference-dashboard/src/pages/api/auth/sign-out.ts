import type { APIRoute } from "astro"
import { clearSessionCookie, destroySession, readSessionCookie } from "../../../lib/auth"

export const POST: APIRoute = async (ctx) => {
  const sessionId = readSessionCookie(ctx.cookies)
  if (sessionId) {
    const env = (ctx.locals as any).runtime?.env
    const DB = env?.DB as D1Database | undefined
    if (DB) await destroySession({ DB }, sessionId)
  }
  clearSessionCookie(ctx.cookies)
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } })
}
