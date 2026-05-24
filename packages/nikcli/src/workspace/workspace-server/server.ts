import { Hono } from "hono"
import { InstanceBootstrap } from "@/project/bootstrap"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "@/effect"
import { SessionRoutes } from "@/server/routes/session"
import { WorkspaceContext } from "../workspace-context"
import { WorkspaceServerRoutes } from "./routes"
import { Session } from "@/session"
import { Effect } from "effect"

function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

export namespace WorkspaceServer {
  export function App() {
    const withWorkspace = async (c: any, next: () => Promise<void>) => {
      if (c.req.method === "GET") return c.notFound()

      let directory = c.req.query("directory") || c.req.header("x-nikcli-directory") || process.cwd()
      try {
        directory = decodeURIComponent(directory)
      } catch {
        // fallback to original value
      }
      const workspaceID = c.req.query("workspace") || c.req.header("x-nikcli-workspace")

      return WorkspaceContext.provide({
        workspaceID,
        fn: () => withInstanceAsync({ directory, workspaceID, init: InstanceBootstrap }, async () => next()),
      })
    }

    const session = new Hono().use("*", withWorkspace).route("/", SessionRoutes())

    const sync = new Hono().use("*", withWorkspace).post("/steal", async (c) => {
      const workspaceID = WorkspaceContext.workspaceID
      if (!workspaceID) return c.text("Cannot steal session without workspace context", 400)
      const body = (await c.req.json().catch(() => undefined)) as { sessionID?: unknown } | undefined
      const sessionID = typeof body?.sessionID === "string" ? body.sessionID : undefined
      if (!sessionID) return c.text("Missing sessionID", 400)

      await runSession(
        Effect.gen(function* () {
          const session = yield* Session.Service
          yield* session.update(sessionID, (draft) => {
            draft.workspaceID = workspaceID
          })
        }),
      )

      return c.json({ sessionID })
    })

    return new Hono().route("/session", session).route("/sync", sync).route("/", WorkspaceServerRoutes())
  }

  export function Listen(opts: { hostname: string; port: number }) {
    return Bun.serve({
      hostname: opts.hostname,
      port: opts.port,
      fetch: App().fetch,
    })
  }
}
