import { Installation } from "../installation"
import { Session } from "../session"
import { Workspace } from "."
import { WorkspaceContext } from "./workspace-context"
import { ServerProxy } from "../server/proxy"
import { Log } from "@/util/log"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"

const log = Log.create({ service: "workspace.proxy" })

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

export async function proxyWorkspaceRequest(input: {
  workspaceID: string
  method: string
  url: string
  body?: BodyInit
  headers?: HeadersInit
  signal?: AbortSignal
}) {
  const workspace = await Workspace.get(input.workspaceID)
  if (!workspace) {
    return new Response(`Workspace not found: ${input.workspaceID}`, {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    })
  }

  const target = await Workspace.target(workspace.id)
  if (!target || target.type === "local") return

  return ServerProxy.http(
    target,
    new Request(input.url, {
      method: input.method,
      body: input.body,
      headers: input.headers,
      signal: input.signal,
    }),
  )
}

async function resolveWorkspaceID(req: Request) {
  // First check WorkspaceContext (set by middleware or prior handler)
  const contextWorkspaceID = WorkspaceContext.workspaceID
  if (contextWorkspaceID) {
    log.debug("resolveWorkspaceID: from context", { workspaceID: contextWorkspaceID })
    return contextWorkspaceID
  }

  // Try to get from request body for POST requests
  if (req.method === "POST") {
    try {
      const body = await req.clone().json()
      if (body && typeof body === "object" && "workspaceID" in body && typeof body.workspaceID === "string") {
        log.debug("resolveWorkspaceID: from body", { workspaceID: body.workspaceID })
        return body.workspaceID
      }
    } catch {
      // JSON parsing failed, continue to session-based resolution
    }
  }

  // Extract session ID from URL path
  const url = new URL(req.url)
  const sessionMatch = url.pathname.match(/\/session\/(ses_[^/]+)/)
  if (sessionMatch) {
    try {
      const session = await runSession(
        Effect.gen(function* () {
          const sessionService = yield* Session.Service
          return yield* sessionService.getAnyProject(sessionMatch[1])
        }),
      )
      if (session?.workspaceID) {
        log.debug("resolveWorkspaceID: from session", { sessionID: sessionMatch[1], workspaceID: session.workspaceID })
        return session.workspaceID
      }
    } catch (err) {
      log.warn("failed to resolve session for workspaceID", { sessionID: sessionMatch[1], error: String(err) })
    }
  }

  return undefined
}

export async function proxySessionRequest(req: Request) {
  if (req.method === "GET") return

  const workspaceID = await resolveWorkspaceID(req)
  if (!workspaceID?.startsWith("wrk_")) return

  const workspace = await Workspace.get(workspaceID)
  if (!workspace) {
    return new Response(`Workspace not found: ${workspaceID}`, {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    })
  }

  const target = await Workspace.target(workspace.id)
  if (!target || target.type === "local") return

  return ServerProxy.http(target, req)
}

export async function withSessionProxy(request: Request, next: () => Promise<Response>) {
  if (!Installation.isLocal()) return next()
  return (await proxySessionRequest(request)) ?? next()
}
