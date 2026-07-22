import type { APIContext } from "astro"

export interface RuntimeEnv {
  DB: D1Database
  ASSETS?: Fetcher
  INFERENCE_API_BASE?: string
  SITE_URL?: string
  SESSION_SECRET?: string
  AUTH_ISSUER?: string
  AUTH_AUDIENCE?: string
  AUTH_JWKS_URL?: string
}

export function getEnv(ctx: APIContext | { locals: App.Locals }): RuntimeEnv {
  // The Cloudflare adapter exposes bindings at locals.runtime.env; plain locals
  // is kept as a fallback for tests that stub the env directly.
  const locals = ctx.locals as unknown as { runtime?: { env?: RuntimeEnv } }
  return (locals.runtime?.env ?? locals) as RuntimeEnv
}
