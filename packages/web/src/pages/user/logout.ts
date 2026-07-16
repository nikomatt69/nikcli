import type { APIRoute } from "astro"
import { ARTIFACT_TOKEN_COOKIE, DEFAULT_NIKCLI_AUTH_SERVER } from "../../lib/artifact"

export const POST: APIRoute = async (context) => {
  const env = (context.locals as App.Locals).runtime?.env
  const authServer = (env?.NIKCLI_AUTH_SERVER || DEFAULT_NIKCLI_AUTH_SERVER).replace(/\/$/, "")
  const authorization = context.request.headers.get("Authorization")
  const cookie = context.request.headers.get("Cookie")?.match(
    new RegExp(`(?:^|;\\s*)${ARTIFACT_TOKEN_COOKIE}=([^;]+)`),
  )?.[1]
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : cookie

  if (token?.startsWith("nku_")) {
    await fetch(`${authServer}/user/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    }).catch(() => undefined)
  }

  const secure = context.url.protocol === "https:" ? "; Secure" : ""
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${ARTIFACT_TOKEN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`,
    },
  })
}
