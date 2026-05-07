import { Hono } from "hono"
import { InstanceBootstrap } from "@/project/bootstrap"
import { withInstanceAsync } from "@/effect"
import { SessionRoutes } from "@/server/routes/session"
import { WorkspaceContext } from "../workspace-context"
import { WorkspaceServerRoutes } from "./routes"

export namespace WorkspaceServer {
  export function App() {
    const session = new Hono()
      .use("*", async (c, next) => {
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
          fn: () =>
            withInstanceAsync(
              { directory, workspaceID, init: InstanceBootstrap },
              async () => next(),
            ),
        })
      })
      .route("/", SessionRoutes())

    return new Hono().route("/session", session).route("/", WorkspaceServerRoutes())
  }

  export function Listen(opts: { hostname: string; port: number }) {
    return Bun.serve({
      hostname: opts.hostname,
      port: opts.port,
      fetch: App().fetch,
    })
  }
}
