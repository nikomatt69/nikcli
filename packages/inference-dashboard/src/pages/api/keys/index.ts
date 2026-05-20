import type { APIRoute } from "astro"
import { z } from "zod"
import { getCurrentUser } from "../../../lib/auth"
import { getEnv } from "../../../lib/env"
import { issueApiKey, listApiKeys } from "../../../lib/keys"

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
}

const createBody = z.object({
  name: z.string().min(1).max(80).optional(),
  tier: z.enum(["free", "starter", "pro", "business"]).optional(),
})

export const GET: APIRoute = async (ctx) => {
  const user = await getCurrentUser(ctx)
  if (!user) return json({ error: "unauthorized" }, 401)
  const env = getEnv(ctx)
  const keys = await listApiKeys(env, user.id)
  return json({ keys })
}

export const POST: APIRoute = async (ctx) => {
  const user = await getCurrentUser(ctx)
  if (!user) return json({ error: "unauthorized" }, 401)
  let parsed
  try {
    parsed = createBody.parse(await ctx.request.json().catch(() => ({})))
  } catch (e) {
    return json({ error: "invalid_request", message: (e as Error).message }, 400)
  }
  const env = getEnv(ctx)
  const issued = await issueApiKey(env, { userId: user.id, name: parsed.name, tier: parsed.tier ?? "free" })
  return json({ key: issued }, 201)
}
