/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type KVNamespace = import("@cloudflare/workers-types").KVNamespace

interface CloudflareEnv {
  USERS: KVNamespace
  SESSIONS: KVNamespace
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
