import type { APIRoute } from "astro"
import { ARTIFACT_TOKEN_COOKIE, DEFAULT_NIKCLI_AUTH_SERVER } from "../../lib/artifact"

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

/** Proxy login to the canonical nikcli server UserDB. */
export const POST: APIRoute = async (context) => {
  const env = (context.locals as App.Locals).runtime?.env
  const authServer = (env?.NIKCLI_AUTH_SERVER || DEFAULT_NIKCLI_AUTH_SERVER).replace(/\/$/, "")

  let body: { email?: string; password?: string }
  try {
    body = await context.request.json()
  } catch {
    return json({ error: "Invalid JSON" }, 400)
  }
  if (!body.email || !body.password) return json({ error: "Missing email or password" }, 400)

  let upstream: Response
  try {
    upstream = await fetch(`${authServer}/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: body.email, password: body.password }),
    })
  } catch {
    return json({ error: "Account server unavailable" }, 503)
  }

  const payload = (await upstream.json().catch(() => ({}))) as { token?: string; error?: string; user?: unknown }
  if (!upstream.ok || !payload.token) return json(payload, upstream.status)

  const ttlSeconds = 30 * 24 * 60 * 60
  const secure = context.url.protocol === "https:" ? "; Secure" : ""
  return json(payload, 200, {
    "Set-Cookie": `${ARTIFACT_TOKEN_COOKIE}=${payload.token}; Path=/; Max-Age=${ttlSeconds}; HttpOnly; SameSite=Lax${secure}`,
  })
}
