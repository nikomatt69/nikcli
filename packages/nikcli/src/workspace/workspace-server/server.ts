import { Effect } from "effect"
import { InstanceBootstrap } from "@/project/bootstrap"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "@/effect"
import { Session } from "@/session"
import { HttpApiBridge } from "@/server/httpapi/bridge"
import { WorkspaceContext } from "../workspace-context"
import { workspaceEventResponse } from "./routes"

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

export namespace WorkspaceServer {
  export async function fetch(request: Request) {
    const url = new URL(request.url)
    if (request.method === "GET") {
      if (url.pathname === "/event") return workspaceEventResponse(request)
      return new Response("Not Found", { status: 404 })
    }
    let directory = url.searchParams.get("directory") || request.headers.get("x-nikcli-directory") || process.cwd()
    try {
      directory = decodeURIComponent(directory)
    } catch {}
    const workspaceID = url.searchParams.get("workspace") || request.headers.get("x-nikcli-workspace") || undefined
    return WorkspaceContext.provide({
      workspaceID,
      fn: () =>
        withInstanceAsync({ directory, workspaceID, init: InstanceBootstrap }, async () => {
          if (request.method === "POST" && url.pathname === "/sync/steal") {
            if (!workspaceID) return new Response("Cannot steal session without workspace context", { status: 400 })
            const body = (await request.json().catch(() => undefined)) as { sessionID?: unknown } | undefined
            if (typeof body?.sessionID !== "string") return new Response("Missing sessionID", { status: 400 })
            await runSession(
              Effect.gen(function* () {
                const session = yield* Session.Service
                yield* session.update(body.sessionID as string, (draft) => {
                  draft.workspaceID = workspaceID
                })
              }),
            )
            return Response.json({ sessionID: body.sessionID })
          }
          return HttpApiBridge.handle(request, { upstreamAuthVerified: true })
        }),
    })
  }

  export function Listen(opts: { hostname: string; port: number }) {
    return Bun.serve({ hostname: opts.hostname, port: opts.port, fetch })
  }
}
