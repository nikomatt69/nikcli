/**
 * Pure Effect backend runtime — B4 proof-of-concept.
 *
 * Mounts `HttpApiBridge.layer` on a `BunHttpServer.layer` (Bun.serve). This
 * does **not** replace the Hono production path; it serves as a tested
 * scaffold so the future full Effect backend can reuse the same wiring
 * without scattering `Layer.mergeAll(BunHttpServer.layerHttpServices, ...)`
 * across the codebase.
 *
 * Specials (SSE, WebSocket, chatbot webhooks, user HTML) still require the
 * Hono path; `ServerBackend` keeps routing to Hono for those.
 */
import { BunHttpServer } from "@effect/platform-bun"
import { Layer } from "effect"
import { HttpApiBridge } from "./httpapi/bridge"

export namespace BackendRuntime {
  /** Build a Bun HTTP server layer that serves the Public HttpApi over a dedicated port. */
  export function serverLayer(port: number, hostname = "127.0.0.1") {
    return HttpApiBridge.layer.pipe(Layer.provide(BunHttpServer.layer({ port, hostname, idleTimeout: 0 })))
  }
}
