import { Flag } from "@nikcli-ai/util/flag"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Session } from "@/session"
import { SessionError } from "@/session/error"
import { Log } from "@nikcli-ai/util/log"
import { Vcs } from "@/project/vcs"
import { Workspace } from "@/workspace"
import { WorkspaceContext } from "@/workspace/workspace-context"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "@/effect"
import { Effect } from "effect"
import { Provider } from "@/provider/provider"
import { Auth } from "./httpapi/auth"
import { HttpApiBridge } from "./httpapi/bridge"
import { bodyLimitResponse } from "./middleware/body-limit"
import { ServerProxy } from "./proxy"
import { PublicRoutes } from "./public"
import { isInstanceLessPath } from "./httpapi/instance-less"
import { ServerWebSocket, type WebSocketData } from "./websocket"

export namespace ServerRouter {
  const log = Log.create({ service: "server.router" })

  export type Options = {
    readonly fallback: (request: Request) => Promise<Response>
    readonly corsWhitelist?: readonly string[]
    readonly listenHostname?: string
    readonly mobileAuthRequired?: boolean
  }

  export type Fetch = (request: Request, server?: Bun.Server<WebSocketData>) => Promise<Response>

  export function principal(request: Request): Auth.Principal | undefined {
    return Auth.principal(request)
  }

  function sessionIDFromPath(pathname: string) {
    const match = /^\/session\/([^/?#]+)/.exec(pathname)
    if (!match) return
    let value = match[1]
    try {
      value = decodeURIComponent(value)
    } catch {}
    return Session.ID.safeParse(value).success ? value : undefined
  }

  async function sessionForRequest(sessionID: string, directory: string) {
    return withInstanceAsync({ directory, init: InstanceBootstrap }, async () =>
      runPromiseWithLayer(
        Session.defaultLayer,
        withCurrentInstance(
          Effect.gen(function* () {
            const session = yield* Session.Service
            return yield* session.getAnyProject(sessionID)
          }),
        ),
      ),
    ).catch(() => undefined)
  }

  export async function context(request: Request) {
    const url = new URL(request.url)
    let directory = url.searchParams.get("directory") || request.headers.get("x-nikcli-directory") || process.cwd()
    try {
      directory = decodeURIComponent(directory)
    } catch {}
    const sessionID = sessionIDFromPath(url.pathname)
    const routeSession = sessionID ? await sessionForRequest(sessionID, directory) : undefined
    const workspaceID =
      url.searchParams.get("workspace") || request.headers.get("x-nikcli-workspace") || routeSession?.workspaceID
    const workspace = workspaceID ? await Workspace.get(workspaceID).catch(() => undefined) : undefined
    if (workspace) {
      const target = await Workspace.target(workspace.id)
      if (target?.type === "local") directory = target.directory
      return { directory, workspaceID: workspaceID ?? undefined, target }
    }
    if (routeSession?.directory) directory = routeSession.directory
    return { directory, workspaceID: workspaceID ?? undefined, target: undefined }
  }

  function originAllowed(origin: string, options: Options) {
    if (
      origin.startsWith("http://localhost") ||
      origin.startsWith("http://127.0.0.1") ||
      origin.startsWith("http://*.local") ||
      origin === "tauri://localhost" ||
      origin.startsWith("http://tailscale") ||
      origin === "capacitor://localhost" ||
      origin.startsWith("exp://") ||
      origin.startsWith("nikcli://")
    )
      return true
    if (
      Flag.NIKCLI_SERVER_TAILSCALE_AUTH &&
      Auth.isLoopbackHostname(options.listenHostname) &&
      /^https:\/\/([a-z0-9-]+\.)*ts\.net(?::\d+)?$/.test(origin)
    )
      return true
    if (/^https:\/\/([a-z0-9-]+\.)*nikcli\.store$/.test(origin)) return true
    return options.corsWhitelist?.includes(origin) ?? false
  }

  function corsHeaders(request: Request, options: Options): Headers {
    const headers = new Headers()
    const origin = request.headers.get("origin")
    if (origin && originAllowed(origin, options)) {
      headers.set("access-control-allow-origin", origin)
      headers.set("access-control-allow-credentials", "true")
      headers.append("vary", "Origin")
    }
    return headers
  }

  function withCors(response: Response, request: Request, options: Options) {
    const headers = corsHeaders(request, options)
    for (const [key, value] of headers) response.headers.set(key, value)
    return response
  }

  function preflight(request: Request, options: Options) {
    const headers = corsHeaders(request, options)
    headers.set("access-control-allow-headers", "Authorization,Content-Type,x-nikcli-directory,x-nikcli-workspace")
    headers.set("access-control-allow-methods", "GET,HEAD,PUT,POST,DELETE,PATCH")
    return new Response(null, { status: 204, headers })
  }

  function isPtyNotFound(error: unknown): error is { message: string } {
    return (
      typeof error === "object" &&
      error !== null &&
      "_tag" in error &&
      (error as { _tag: unknown })._tag === "PtyNotFoundError" &&
      "message" in error &&
      typeof (error as { message: unknown }).message === "string"
    )
  }

  export function mapError(error: unknown): Response {
    log.error("failed", { error })
    if (typeof error === "object" && error !== null && "__http" in error) {
      const marker = (error as { __http: { status: number; name: string; data: Record<string, unknown> } }).__http
      return Response.json({ name: marker.name, data: marker.data }, { status: marker.status })
    }
    if (error instanceof Session.BusyError) {
      return Response.json(
        { name: error._tag, data: { sessionID: error.sessionID, message: error.message } },
        { status: 409 },
      )
    }
    // The wire name is the literal "NotFoundError", not the error's `_tag` —
    // `SessionError.NotFoundError` is tagged "SessionNotFoundError" and the
    // declared response schemas pin the literal. Pty and Workspace own the
    // same 404 shape after dropping borrowed `Storage.NotFoundError`.
    if (SessionError.isNotFound(error) || error instanceof Workspace.NotFoundError || isPtyNotFound(error)) {
      return Response.json({ name: "NotFoundError", data: { message: error.message } }, { status: 404 })
    }
    if (error instanceof Provider.ModelNotFoundError) {
      return Response.json(
        {
          name: error._tag,
          data: { providerID: error.providerID, modelID: error.modelID, suggestions: error.suggestions },
        },
        { status: 400 },
      )
    }
    if (error instanceof Vcs.PatchApplyError) {
      return Response.json(
        { name: error._tag, data: { message: error.message, reason: error.reason } },
        { status: 400 },
      )
    }
    if (error instanceof Error && error.name.startsWith("Worktree")) {
      return Response.json({ name: error.name, data: { message: error.message } }, { status: 400 })
    }
    if (typeof error === "object" && error !== null && "getResponse" in error) {
      const getResponse = (error as { getResponse?: unknown }).getResponse
      if (typeof getResponse === "function") return getResponse.call(error) as Response
    }
    const isError = error instanceof Error
    return Response.json(
      {
        name: "Unknown",
        data: {
          message: isError ? error.message : String(error),
          ...(process.env.NIKCLI_DEBUG === "1" && isError ? { stack: error.stack } : {}),
        },
      },
      { status: 500 },
    )
  }

  function isWebSocketUpgrade(request: Request) {
    return request.headers.get("upgrade")?.toLowerCase() === "websocket"
  }

  async function dispatch(request: Request, options: Options, server?: Bun.Server<WebSocketData>): Promise<Response> {
    const url = new URL(request.url)
    // `/sync/stream` is not a root of its own: one SSE path, served instance-less
    // by `PublicRoutes.globalRequest`, with no sibling under `/sync/`.
    const global =
      isInstanceLessPath(url.pathname) || (request.method === "GET" && url.pathname === "/sync/stream")
    if (global) {
      const raw = await PublicRoutes.globalRequest(request)
      if (raw) return raw
      if (HttpApiBridge.supportsGlobal(url.pathname, request.method)) {
        return HttpApiBridge.handleGlobal(request, { upstreamAuthVerified: true })
      }
      return options.fallback(request)
    }

    const resolved = await context(request)
    const { workspaceID } = resolved
    let { directory } = resolved
    if (workspaceID) {
      const target = resolved.target
      if (!target) return new Response(`Workspace not found: ${workspaceID}`, { status: 404 })
      if (target.type === "remote") {
        if (isWebSocketUpgrade(request) && server) {
          const failed = ServerWebSocket.upgrade(server, request, ServerProxy.data(target, request))
          if (failed) return failed
          return new Response(null, { status: 101 })
        }
        return ServerProxy.http(target, request)
      }
    }

    return WorkspaceContext.provide({
      workspaceID: workspaceID ?? undefined,
      fn: () =>
        withInstanceAsync({ directory, workspaceID: workspaceID ?? undefined, init: InstanceBootstrap }, async () => {
          if (isWebSocketUpgrade(request) && server) {
            const match = ServerWebSocket.match(url.pathname)
            if (match) {
              const failed = ServerWebSocket.upgrade(server, request, {
                type: "pty",
                ptyID: match.ptyID,
                directory,
                workspaceID: workspaceID ?? undefined,
              })
              if (failed) return failed
              return new Response(null, { status: 101 })
            }
          }
          const raw = await PublicRoutes.instanceRequest(request)
          if (raw) return raw
          if (HttpApiBridge.supports(url.pathname, request.method)) {
            return HttpApiBridge.handle(request, { upstreamAuthVerified: true })
          }
          return options.fallback(request)
        }),
    })
  }

  export function make(options: Options): Fetch {
    return async (request, server) => {
      const limited = bodyLimitResponse(request)
      if (limited) return withCors(limited, request, options)
      if (request.method === "OPTIONS") return preflight(request, options)
      const started = performance.now()
      const pathname = new URL(request.url).pathname
      if (pathname !== "/log") log.info("request", { method: request.method, path: pathname })
      try {
        const publicResponse = await PublicRoutes.publicRequest(request)
        if (publicResponse) return withCors(publicResponse, request, options)
        const auth = await Auth.authenticate(request, {
          mobileAuthRequired: options.mobileAuthRequired,
          listenHostname: options.listenHostname,
        })
        if (!auth.ok && !Auth.isPublicPath(request.method, pathname)) return withCors(auth.response, request, options)
        if (auth.ok) Auth.remember(request, auth.principal)
        return withCors(await dispatch(request, options, server), request, options)
      } catch (error) {
        return withCors(mapError(error), request, options)
      } finally {
        if (pathname !== "/log")
          log.info("request completed", {
            method: request.method,
            path: pathname,
            duration: performance.now() - started,
          })
      }
    }
  }
}
