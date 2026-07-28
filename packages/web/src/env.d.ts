/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type KVNamespace = import("@cloudflare/workers-types").KVNamespace
type R2Bucket = import("@cloudflare/workers-types").R2Bucket

interface CloudflareEnv {
  USERS: KVNamespace
  SESSIONS: KVNamespace
  ARTIFACTS: R2Bucket
  /**
   * Workers AI, used by the docs support assistant (/api/docs-assistant).
   * Typed loosely on purpose: the model id is configurable at runtime, so it
   * cannot be checked against the generated model-name union.
   */
  AI?: {
    run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>
  }
  /** Workers AI model for the docs assistant. Defaults to a free-tier model. */
  DOCS_ASSISTANT_MODEL?: string
  /** Stronger free-tier model used when the question asks for an artifact. */
  DOCS_ASSISTANT_ARTIFACT_MODEL?: string
  /** Per-IP hourly question cap for the docs assistant. Defaults to 20. */
  DOCS_ASSISTANT_RATE_LIMIT?: string
  /**
   * Canonical origin for artifact share links, so an artifact created from a
   * preview deployment still points at nikcli.store.
   */
  ARTIFACT_PUBLIC_ORIGIN?: string
  /**
   * Optional nikcli server backing the docs assistant. With both the URL and a
   * token set, questions run as a real nikcli session instead of a one-shot
   * Workers AI call; without them the free Workers AI path is used.
   */
  NIKCLI_DOCS_SERVER?: string
  NIKCLI_DOCS_TOKEN?: string
  NIKCLI_DOCS_AGENT?: string
  NIKCLI_DOCS_DIRECTORY?: string
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
