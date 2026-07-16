import type { APIRoute } from "astro"
import { DEFAULT_NIKCLI_AUTH_SERVER } from "../../lib/artifact"

export const POST: APIRoute = async (context) => {
  const env = (context.locals as App.Locals).runtime?.env
  const authServer = (env?.NIKCLI_AUTH_SERVER || DEFAULT_NIKCLI_AUTH_SERVER).replace(/\/$/, "")
  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 })
  }

  try {
    const upstream = await fetch(`${authServer}/user/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
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
