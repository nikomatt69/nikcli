import type { APIRoute } from "astro"
import { ARTIFACT_TOKEN_COOKIE } from "../../lib/artifact"

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

export const POST: APIRoute = async () =>
  json({ error: "password_login_retired", authorize: "/user/authorize" }, 410, {
    "Set-Cookie": `${ARTIFACT_TOKEN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
  })
