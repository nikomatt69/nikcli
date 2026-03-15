import type { MiddlewareHandler } from "hono"
import { Installation } from "../installation"
import { getAdaptor } from "./adaptors"
import { Workspace } from "."
import { WorkspaceContext } from "./workspace-context"

async function proxySessionRequest(req: Request) {
  if (req.method === "GET") return

  const workspaceID = WorkspaceContext.workspaceID
  if (!workspaceID?.startsWith("wrk_")) return

  const workspace = await Workspace.get(workspaceID)
  if (!workspace) {
    return new Response(`Workspace not found: ${workspaceID}`, {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    })
  }
  if (workspace.config.type === "worktree") return

  const url = new URL(req.url)
  const body = req.method === "HEAD" ? undefined : await req.arrayBuffer()
  return getAdaptor(workspace.config).request(
    workspace.config,
    req.method,
    `${url.pathname}${url.search}`,
    body,
    req.signal,
    req.headers,
  )
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
