import type { APIRoute } from "astro"

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export const POST: APIRoute = async () => {
  return json({ error: "password_sign_in_retired", authorize: "/api/auth/authorize" }, 410)
}
