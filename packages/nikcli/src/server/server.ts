import { AnalyticsShare } from "@/analytics/share"
import { runPromiseWithLayer } from "@/effect"
import { Flag } from "@nikcli-ai/util/flag"
import { Installation } from "@/installation"
import { Project } from "@/project/project"
import { Workspace } from "@/workspace"
import { BunHttpServer } from "@effect/platform-bun"
import { Effect, Layer, ManagedRuntime } from "effect"
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { OpenApi } from "effect/unstable/httpapi"
import { Log } from "@nikcli-ai/util/log"
import { HttpApiBridge } from "./httpapi/bridge"
import { PublicApi } from "./httpapi/public"
import { MDNS } from "./mdns"
import { PublicRoutes } from "./public"
import { ServerRouter } from "./server-router"
import { ServerWebSocket, type WebSocketData } from "./websocket"

// @ts-ignore This global prevents ai-sdk warnings from corrupting stdout.
globalThis.AI_SDK_LOG_WARNINGS = false

export namespace Server {
  const log = Log.create({ service: "server" })
  const STOP_DRAIN_MS = 3000

  let _url: URL | undefined
  let _corsWhitelist: string[] = []
  let _listenHostname: string | undefined
  let _mobileAuthRequired = false
  let requestHandler: ServerRouter.Fetch | undefined

  function isLoopbackHostname(hostname: string | undefined) {
    if (!hostname) return false
    return hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost"
  }

  export function url(): URL {
    return _url ?? new URL("http://localhost:4096")
  }

  async function fallback(request: Request) {
    const pathname = new URL(request.url).pathname
    const response =
      pathname.startsWith("/global/") || pathname.startsWith("/user/")
        ? await HttpApiBridge.handleGlobal(request, { upstreamAuthVerified: true })
        : await HttpApiBridge.handle(request, { upstreamAuthVerified: true })
    if (response.status !== 404) return response
    if (pathname.startsWith("/mobile/") || pathname === "/mobile") return response
    return PublicRoutes.proxy(request)
  }

  function pipeline() {
    return (requestHandler ??= ServerRouter.make({
      fallback,
      corsWhitelist: _corsWhitelist,
      listenHostname: _listenHostname,
      mobileAuthRequired: _mobileAuthRequired,
    }))
  }

  export function fetch(request: Request): Promise<Response> {
    return pipeline()(request)
  }

  export function openapi() {
    return Promise.resolve(OpenApi.fromApi(PublicApi))
  }

  export function listen(opts: {
    port: number
    hostname: string
    mdns?: boolean
    cors?: string[]
    mobileAuthRequired?: boolean
  }) {
    const envCors = process.env.NIKCLI_SERVER_CORS_ORIGINS
      ? process.env.NIKCLI_SERVER_CORS_ORIGINS.split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : []
    _corsWhitelist = [...(opts.cors ?? []), ...envCors]
    _listenHostname = opts.hostname
    _mobileAuthRequired = opts.mobileAuthRequired ?? false
    requestHandler = undefined

    if (Flag.NIKCLI_SERVER_TAILSCALE_AUTH && !isLoopbackHostname(opts.hostname)) {
      log.warn("tailscale auth enabled but server is not bound to loopback; refusing to trust identity headers", {
        hostname: opts.hostname,
      })
    }

    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      maxRequestBodySize: Flag.NIKCLI_SERVER_MAX_BODY ?? 2 * 1024 * 1024 * 1024,
      fetch: (request: Request, server: Bun.Server<WebSocketData>) => pipeline()(request, server),
      websocket: ServerWebSocket.handlers,
    }
    const tryServe = (port: number) => {
      try {
        return Bun.serve<WebSocketData>({ ...args, port })
      } catch {
        return undefined
      }
    }

    let server: ReturnType<typeof Bun.serve> | undefined
    if (opts.port === 0) {
      server = tryServe(4096) ?? tryServe(0)
    } else {
      server = tryServe(opts.port)
      if (!server) {
        log.warn(`port ${opts.port} is in use; falling back to an ephemeral port`, { hostname: opts.hostname })
        server = tryServe(0)
      }
    }
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)

    _url = server.url
    AnalyticsShare.start()

    const port = server.port
    const shouldPublishMDNS = Boolean(opts.mdns && port && !isLoopbackHostname(opts.hostname))
    if (shouldPublishMDNS && port) MDNS.publish(port)
    else if (opts.mdns) log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")

    if (Installation.isLocal()) {
      void runPromiseWithLayer(
        Project.defaultLayer,
        Effect.gen(function* () {
          const project = yield* Project.Service
          return yield* project.list()
        }),
      )
        .then((projects) => projects.forEach((project) => Workspace.startSyncing(project)))
        .catch((error) => log.warn("failed to start workspace syncing", { error }))
    }

    const originalStop = server.stop.bind(server)
    server.stop = async (closeActiveConnections?: boolean) => {
      if (shouldPublishMDNS) MDNS.unpublish()
      Workspace.stopAllSyncing()
      if (closeActiveConnections) return originalStop(true)

      let drained = false
      const drain = Promise.resolve(originalStop())
        .then(() => {
          drained = true
        })
        .catch(() => {
          drained = true
        })
      await Promise.race([drain, Bun.sleep(STOP_DRAIN_MS)])
      if (drained) return
      log.warn("graceful shutdown timed out; closing active connections", { ms: STOP_DRAIN_MS })
      await originalStop(true).catch(() => undefined)
    }

    return server
  }

  export async function listenEffect(opts: {
    port: number
    hostname: string
    cors?: string[]
    mobileAuthRequired?: boolean
  }) {
    _corsWhitelist = opts.cors ?? []
    _listenHostname = opts.hostname
    _mobileAuthRequired = opts.mobileAuthRequired ?? false
    requestHandler = undefined

    const serverLayer = BunHttpServer.layer({
      hostname: opts.hostname,
      port: opts.port,
      idleTimeout: 0,
      maxRequestBodySize: Flag.NIKCLI_SERVER_MAX_BODY ?? 2 * 1024 * 1024 * 1024,
      gracefulShutdownTimeout: STOP_DRAIN_MS,
    })
    const app = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      return HttpServerResponse.fromWeb(yield* Effect.promise(() => fetch(request.source as Request)))
    })
    const runtime = ManagedRuntime.make(HttpServer.serve(app).pipe(Layer.provideMerge(serverLayer)))
    const server = await runtime.runPromise(
      Effect.gen(function* () {
        return yield* HttpServer.HttpServer
      }),
    )
    if (server.address._tag !== "TcpAddress") throw new Error("BunHttpServer did not bind a TCP address")
    _url = new URL(`http://${server.address.hostname}:${server.address.port}`)
    return {
      hostname: server.address.hostname,
      port: server.address.port,
      url: _url,
      stop: async () => runtime.dispose(),
    }
  }

  export async function ready(server: ReturnType<typeof listen>, timeoutMs = 5000) {
    const bound = server.hostname ?? "127.0.0.1"
    const host = bound === "0.0.0.0" || bound === "::" ? "127.0.0.1" : bound
    const authority = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host
    const target = `http://${authority}:${server.port}/global/health`
    const password = Flag.NIKCLI_SERVER_PASSWORD?.trim()
    const username = Flag.NIKCLI_SERVER_USERNAME?.trim() || "nikcli"
    const headers = password
      ? { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` }
      : undefined

    const deadline = Date.now() + timeoutMs
    let last: unknown
    for (;;) {
      try {
        const response = await globalThis.fetch(target, { headers, signal: AbortSignal.timeout(1000) })
        if (response.ok) return
        last = new Error(`health check returned ${response.status}`)
      } catch (error) {
        last = error
      }
      if (Date.now() >= deadline) break
      await Bun.sleep(50)
    }
    throw new Error(`server did not become ready within ${timeoutMs}ms`, { cause: last })
  }
}
