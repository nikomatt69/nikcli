/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

type RuntimeEnv = import("./lib/env").RuntimeEnv

declare namespace App {
  interface Locals {
    runtime: {
      env: RuntimeEnv
      ctx: ExecutionContext
    }
    user?: import("./lib/auth").AuthUser | null
  }
}
