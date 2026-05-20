import type { APIRoute } from "astro"
import { getCurrentUser } from "../../../lib/auth"

export const GET: APIRoute = async (ctx) => {
  const user = await getCurrentUser(ctx).catch(() => null)
  if (!user) return new Response(JSON.stringify({ user: null }), { headers: { "Content-Type": "application/json" } })
  return new Response(JSON.stringify({ user }), { headers: { "Content-Type": "application/json" } })
}
