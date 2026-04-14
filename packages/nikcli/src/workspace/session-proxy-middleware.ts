import type { MiddlewareHandler } from "hono"
import { Installation } from "../installation"
import { Session } from "../session"
import { Workspace } from "."
import { WorkspaceContext } from "./workspace-context"
import { ServerProxy } from "../server/proxy"

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
  const workspaceID = WorkspaceContext.workspaceID
  if (workspaceID) return workspaceID

  if (req.method === "POST") {
    const body = await req
      .clone()
      .json()
      .catch(() => undefined)
    if (body && typeof body === "object" && "workspaceID" in body && typeof body.workspaceID === "string") {
      return body.workspaceID
    }
  }

  const match = new URL(req.url).pathname.match(/\/session\/(ses_[^/]+)/)
  if (!match) return

  const session = await Session.getAnyProject(match[1]).catch(() => undefined)
  return session?.workspaceID
}

async function proxySessionRequest(req: Request) {
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

export const SessionProxyMiddleware: MiddlewareHandler = async (c, next) => {
  if (!Installation.isLocal()) {
    return next()
  }

  const response = await proxySessionRequest(c.req.raw)
  if (response) {
    return response
  }
  return next()
}
