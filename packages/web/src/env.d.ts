/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type KVNamespace = import("@cloudflare/workers-types").KVNamespace
type R2Bucket = import("@cloudflare/workers-types").R2Bucket

interface CloudflareEnv {
  USERS: KVNamespace
  SESSIONS: KVNamespace
  ARTIFACTS: R2Bucket
  /** Nikcli server that owns the canonical UserDB accounts. */
  NIKCLI_AUTH_SERVER?: string
  AUTH_ISSUER?: string
  AUTH_AUDIENCE?: string
  AUTH_JWKS_URL?: string
  ASSETS: { fetch(req: Request): Promise<Response> }
}

declare namespace App {
  interface Locals {
    runtime: {
      env: CloudflareEnv
    }
  }
}

interface Window {
  posthog?: {
    capture(event: string, properties?: Record<string, unknown>): void
    identify(distinctId: string, properties?: Record<string, unknown>): void
    reset(): void
    captureException(error: unknown, properties?: Record<string, unknown>): void
  }
}
