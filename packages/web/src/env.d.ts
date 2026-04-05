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
