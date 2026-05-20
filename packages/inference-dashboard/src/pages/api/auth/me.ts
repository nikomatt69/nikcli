import type { APIRoute } from "astro"
import { getSessionUser, readSessionCookie } from "../../../lib/auth"

export const GET: APIRoute = async (ctx) => {
  const env = (ctx.locals as any).runtime?.env
  const DB = env?.DB as D1Database | undefined
  if (!DB) return new Response(JSON.stringify({ user: null }), { headers: { "Content-Type": "application/json" } })

  const sessionId = readSessionCookie(ctx.cookies)
  const user = await getSessionUser({ DB }, sessionId)

  return new Response(JSON.stringify({ user }), { headers: { "Content-Type": "application/json" } })
}
