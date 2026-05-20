import type { APIContext } from "astro"

export interface RuntimeEnv {
  DB: D1Database
  ASSETS: Fetcher
  INFERENCE_API_BASE?: string
  SITE_URL?: string
  SESSION_SECRET?: string
}

export function getEnv(ctx: APIContext | { locals: App.Locals }): RuntimeEnv {
  const runtime = (ctx.locals as App.Locals).runtime
  if (!runtime?.env) throw new Error("Cloudflare runtime env not available")
  return runtime.env as unknown as RuntimeEnv
}
