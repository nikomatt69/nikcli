import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "../util/log"
import { generateSpecs, validator } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { basicAuth } from "hono/basic-auth"
import z from "zod"
import { Provider } from "../provider/provider"
import { NamedError } from "@nikcli-ai/util/error"
import { TuiRoutes } from "./routes/tui"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { ProjectRoutes } from "./routes/project"
import { SessionRoutes } from "./routes/session"
import { PtyRoutes } from "./routes/pty"
import { McpRoutes } from "./routes/mcp"
import { ConnectorsRoutes } from "./routes/connectors"
import { ChatBotRoutes } from "./routes/chatbot"
import { FileRoutes } from "./routes/file"
import { ConfigRoutes } from "./routes/config"
import { ExperimentalRoutes } from "./routes/experimental"
import { ProviderRoutes } from "./routes/provider"
import { lazy } from "../util/lazy"
import { InstanceBootstrap } from "../project/bootstrap"
import { Storage } from "../storage/storage"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { websocket } from "hono/bun"
import { HTTPException } from "hono/http-exception"
import { QuestionRoutes } from "./routes/question"
import { PermissionRoutes } from "./routes/permission"
import { DBEditRoutes } from "./routes/dbedit"
import { GlobalRoutes } from "./routes/global"
import { MDNS } from "./mdns"
import { CompanionRoutes } from "./routes/companion"
import { MobileRoutes } from "./routes/mobile"
import { WorkspaceContext } from "../workspace/workspace-context"
import { ShareNext } from "@/share/share-next"
import { MobileAuth } from "@/mobile/auth"
import { Installation } from "@/installation"
import { Project } from "@/project/project"
import { Workspace } from "@/workspace"
import { MiscRoutes } from "./routes/misc"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

export namespace Server {
  const log = Log.create({ service: "server" })

  let _url: URL | undefined
  let _corsWhitelist: string[] = []
  let _listenHostname: string | undefined

  function isLoopbackHostname(hostname: string | undefined) {
    if (!hostname) return false
    return hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost"
  }

  function tailscaleUserLogin(c: any): string | undefined {
    const value = c.req.header("Tailscale-User-Login")
    const login = value?.trim()
    return login ? login : undefined
  }

  function isTailscaleLoginAllowed(login: string) {
    const configured = Flag.NIKCLI_SERVER_TAILSCALE_USERS?.trim()
    if (!configured) return true

    const items = configured
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)

    if (items.length === 0) return true
    if (items.some((x) => x === "*" || x.toLowerCase() === "any")) return true

    const normalized = login.toLowerCase()
    return items.some((x) => x.toLowerCase() === normalized)
  }

  export function url(): URL {
    return _url ?? new URL("http://localhost:4096")
  }

  const app = new Hono()
  export const App: () => Hono = lazy(
    () =>
      app
        .onError((err, c) => {
          log.error("failed", {
            error: err,
          })
          if (err instanceof NamedError) {
            let status: ContentfulStatusCode
            if (err instanceof Storage.NotFoundError) status = 404
            else if (err instanceof Provider.ModelNotFoundError) status = 400
            else if (err.name.startsWith("Worktree")) status = 400
            else status = 500
            return c.json(err.toObject(), { status })
          }
          if (err instanceof HTTPException) return err.getResponse()
          const message = err instanceof Error && err.stack ? err.stack : err.toString()
          return c.json(new NamedError.Unknown({ message }).toObject(), {
            status: 500,
          })
        })
        .get("/s/:shareID", validator("param", z.object({ shareID: z.string() })), async (c) => {
          const { shareID } = c.req.valid("param")
          return c.redirect(`/share/${encodeURIComponent(shareID)}`, 308)
        })
        .get("/share/:shareID", validator("param", z.object({ shareID: z.string() })), async (c) => {
          const { shareID } = c.req.valid("param")
          const data = await ShareNext.publicData(shareID)
          if (!data) return c.text("Share not found", 404)
          return c.json(data)
        })
        .get("/api/share/:shareID", validator("param", z.object({ shareID: z.string() })), async (c) => {
          const { shareID } = c.req.valid("param")
          const data = await ShareNext.publicData(shareID)
          if (!data) return c.text("Share not found", 404)
          return c.json(data)
        })
        .get("/api/share/:shareID/data", validator("param", z.object({ shareID: z.string() })), async (c) => {
          const { shareID } = c.req.valid("param")
          const data = await ShareNext.publicData(shareID)
          if (!data) return c.text("Share not found", 404)
          return c.json(data)
        })
        .use(async (c, next) => {
          if (c.req.method === "OPTIONS") return next()

          const password = Flag.NIKCLI_SERVER_PASSWORD
          const username = Flag.NIKCLI_SERVER_USERNAME ?? "nikcli"

          const bearer = MobileAuth.bearer(c.req.raw)
          if (bearer) {
            const token = await MobileAuth.verify(bearer)
            if (!token) return c.text("Unauthorized", 401)
              ; (c as any).set("mobileAuth", token)
            return next()
          }

          const tailscaleAuthEnabled = Flag.NIKCLI_SERVER_TAILSCALE_AUTH && isLoopbackHostname(_listenHostname)
          if (tailscaleAuthEnabled) {
            const login = tailscaleUserLogin(c)
            if (login) {
              if (!isTailscaleLoginAllowed(login)) {
                log.warn("tailscale user not allowed", {
                  login,
                })
                return c.text("Forbidden", 403)
              }
              return next()
            }

            if (!password) {
              return c.text("Unauthorized", 401)
            }
          }

          if (!password) return next()
          return basicAuth({ username, password })(c, next)
        })
        .use(async (c, next) => {
          const skipLogging = c.req.path === "/log"
          if (!skipLogging) {
            log.info("request", {
              method: c.req.method,
              path: c.req.path,
            })
          }
          const timer = log.time("request", {
            method: c.req.method,
            path: c.req.path,
          })
          await next()
          if (!skipLogging) {
            timer.stop()
          }
        })
        .use(
          cors({
            credentials: true,
            allowHeaders: ["Authorization", "Content-Type", "x-nikcli-directory", "x-nikcli-workspace"],
            origin(input) {
              if (input) {
                if (
                  input.startsWith("http://localhost") ||
                  input.startsWith("http://127.0.0.1") ||
                  input.startsWith("http://*.local") ||
                  input === "tauri://localhost" ||
                  input.startsWith("http://tailscale") ||
                  input.startsWith("http://localhost:8081") ||
                  input === "capacitor://localhost" ||
                  input.startsWith("exp://") ||
                  input.startsWith("nikcli://")
                ) {
                  return input
                }
              }

              if (Flag.NIKCLI_SERVER_TAILSCALE_AUTH && isLoopbackHostname(_listenHostname)) {
                if (/^https:\/\/([a-z0-9-]+\.)*ts\.net(?::\d+)?$/.test(input ?? "")) {
                  return input
                }
              }

              if (/^https:\/\/([a-z0-9-]+\.)*nikcli\.store$/.test(input ?? "")) {
                return input
              }

              if (_corsWhitelist.includes(input ?? "")) {
                return input
              }

              if (input?.startsWith("http://localhost") || input?.startsWith("http://127.0.0.1")) {
                return input
              }

              return
            },
          }),
        )
        .route("/global", GlobalRoutes())
        .use(async (c, next) => {
          let directory = c.req.query("directory") || c.req.header("x-nikcli-directory") || process.cwd()
          try {
            directory = decodeURIComponent(directory)
          } catch {
            // fallback to original value
          }
          const workspaceID = c.req.query("workspace") || c.req.header("x-nikcli-workspace")
          const workspace = workspaceID ? await Workspace.get(workspaceID).catch(() => undefined) : undefined

          if (workspace?.config.type === "worktree") {
            directory = workspace.config.directory
          }

          return WorkspaceContext.provide({
            workspaceID,
            async fn() {
              return Instance.provide({
                directory,
                init: InstanceBootstrap,
                async fn() {
                  return next()
                },
              })
            },
          })
        })
        .use(validator("query", z.object({ directory: z.string().optional(), workspace: z.string().optional() })))
        .route("/", MiscRoutes())
        .route("/project", ProjectRoutes())
        .route("/pty", PtyRoutes())
        .route("/config", ConfigRoutes())
        .route("/experimental", ExperimentalRoutes())
        .route("/session", SessionRoutes())
        .route("/permission", PermissionRoutes())
        .route("/dbedit", DBEditRoutes())
        .route("/question", QuestionRoutes())
        .route("/provider", ProviderRoutes())
        .route("/companion", CompanionRoutes())
        .route("/mobile", MobileRoutes())
        .route("/connectors", ConnectorsRoutes())
        .route("/chatbot", ChatBotRoutes())
        .route("/mcp", McpRoutes())
        .route("/tui", TuiRoutes()) as unknown as Hono,
  )

  export async function openapi() {
    // Cast to break excessive type recursion from long route chains
    const result = await generateSpecs(App() as Hono, {
      documentation: {
        info: {
          title: "nikcli",
          version: "1.0.0",
          description: "nikcli api",
        },
        openapi: "3.1.1",
      },
    })
    return result
  }

  export function listen(opts: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    _corsWhitelist = opts.cors ?? []
    _listenHostname = opts.hostname

    if (Flag.NIKCLI_SERVER_TAILSCALE_AUTH && !isLoopbackHostname(opts.hostname)) {
      log.warn("tailscale auth enabled but server is not bound to loopback; refusing to trust identity headers", {
        hostname: opts.hostname,
      })
    }

    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: App().fetch,
      websocket: websocket,
    } as const
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch {
        return undefined
      }
    }
    const server = opts.port === 0 ? (tryServe(4096) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)

    _url = server.url

    const shouldPublishMDNS =
      opts.mdns &&
      server.port &&
      opts.hostname !== "127.0.0.1" &&
      opts.hostname !== "localhost" &&
      opts.hostname !== "::1"
    if (shouldPublishMDNS) {
      MDNS.publish(server.port!)
    } else if (opts.mdns) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    if (Installation.isLocal()) {
      void Project.list()
        .then((projects) => {
          projects.forEach((project) => Workspace.startSyncing(project))
        })
        .catch((error) => {
          log.warn("failed to start workspace syncing", { error })
        })
    }

    const originalStop = server.stop.bind(server)
    server.stop = async (closeActiveConnections?: boolean) => {
      if (shouldPublishMDNS) MDNS.unpublish()
      Workspace.stopAllSyncing()
      return originalStop(closeActiveConnections)
    }

    return server
  }
}
