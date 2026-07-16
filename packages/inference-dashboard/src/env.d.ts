/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

declare namespace App {
  interface Locals {
    [key: string]: unknown
    // Cloudflare Pages bindings
    DB: D1Database
    ASSETS: Fetcher
    INFERENCE_API_BASE?: string
    SITE_URL?: string
    SESSION_SECRET?: string
    AUTH_ISSUER?: string
    AUTH_AUDIENCE?: string
    AUTH_JWKS_URL?: string
    GATEWAY_SHARED_SECRET?: string
    // Auth
    user?: import("./lib/auth").AuthUser | null
  }
}
