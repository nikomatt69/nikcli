import type { APIRoute } from "astro"
export const POST: APIRoute = async () =>
  Response.json({ error: "password_registration_retired", authorize: "/user/authorize" }, { status: 410 })
