import type { APIRoute } from "astro"
import { getCurrentUser } from "../../../lib/auth"

export const GET: APIRoute = async (ctx) => {
  // getCurrentUser reads the full runtime env (issuer config + DB) and also
  // transparently refreshes an expired access token via the refresh cookie.
  const user = await getCurrentUser(ctx).catch(() => null)
  return new Response(JSON.stringify({ user }), { headers: { "Content-Type": "application/json" } })
}
