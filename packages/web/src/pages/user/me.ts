import type { APIRoute } from "astro"
import { ARTIFACT_TOKEN_COOKIE, DEFAULT_NIKCLI_AUTH_SERVER } from "../../lib/artifact"

function cookieToken(request: Request) {
  const match = request.headers.get("Cookie")?.match(new RegExp(`(?:^|;\\s*)${ARTIFACT_TOKEN_COOKIE}=([^;]+)`))
  return match?.[1]
}

export const GET: APIRoute = async (context) => {
  const env = (context.locals as App.Locals).runtime?.env
  const authServer = (env?.NIKCLI_AUTH_SERVER || DEFAULT_NIKCLI_AUTH_SERVER).replace(/\/$/, "")
  const authorization = context.request.headers.get("Authorization")
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : cookieToken(context.request)
  if (!token?.startsWith("nku_")) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })

  try {
    const upstream = await fetch(`${authServer}/user/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    })
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json" },
    })
  } catch {
    return new Response(JSON.stringify({ error: "Account server unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })
  }
}
