import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "../util/log"
import { describeRoute, generateSpecs, validator, resolver, openAPIRouteHandler } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { streamSSE } from "hono/streaming"
import { proxy } from "hono/proxy"
import { basicAuth } from "hono/basic-auth"
import z from "zod"
import { Provider } from "../provider/provider"
import { LSP } from "../lsp"
import { Format } from "../format"
import { TuiRoutes } from "./routes/tui"
import { Instance } from "../project/instance"
import { Vcs } from "../project/vcs"
import { Agent } from "../agent/agent"
import { Skill } from "../skill/skill"
import { Auth } from "../auth"
import { Flag } from "../flag/flag"
import { Command } from "../command"
import { Global } from "../global"
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
import { Session } from "@/session"
import { websocket } from "hono/bun"
import { HTTPException } from "hono/http-exception"
import { errors } from "./error"
import { runPromiseWithLayer, withCurrentInstance, withInstanceAsync } from "@/effect"
import { Effect } from "effect"
import { QuestionRoutes } from "./routes/question"
import { PermissionRoutes } from "./routes/permission"
import { GlobalRoutes } from "./routes/global"
import { MDNS } from "./mdns"
import { CompanionRoutes } from "./routes/companion"
import { MobileRoutes } from "./routes/mobile"
import { UserRoutes, userAuthMiddleware } from "./routes/users"
import { WorkspaceContext } from "../workspace/workspace-context"
import { ShareNext } from "@/share/share-next"
import { MobileAuth } from "@/mobile/auth"
import { Installation } from "@/installation"
import { Project } from "@/project/project"
import { Workspace } from "@/workspace"
import { ServerProxy } from "./proxy"
import { HttpApiBridge } from "./httpapi/bridge"
import { AnalyticsRoutes } from "./routes/analytics"

function runSkill<A, E>(effect: Effect.Effect<A, E, Skill.Service>) {
  return runPromiseWithLayer(Skill.defaultLayer, withCurrentInstance(effect))
}

function runCommand<A, E>(effect: Effect.Effect<A, E, Command.Service>) {
  return runPromiseWithLayer(Command.defaultLayer, withCurrentInstance(effect))
}

function runAgent<A, E>(effect: Effect.Effect<A, E, Agent.Service>) {
  return runPromiseWithLayer(Agent.defaultLayer, withCurrentInstance(effect))
}

function runLSP<A, E>(effect: Effect.Effect<A, E, LSP.Service>) {
  return runPromiseWithLayer(LSP.defaultLayer, withCurrentInstance(effect))
}

function runAuth<A, E>(effect: Effect.Effect<A, E, Auth.Service>) {
  return runPromiseWithLayer(Auth.defaultLayer, effect)
}

function runShareNext<A, E>(effect: Effect.Effect<A, E, ShareNext.Service>) {
  return runPromiseWithLayer(ShareNext.defaultLayer, effect)
}

function runProject<A, E>(effect: Effect.Effect<A, E, Project.Service>) {
  return runPromiseWithLayer(Project.defaultLayer, effect)
}

function runProvider<A, E>(effect: Effect.Effect<A, E, Provider.Service>) {
  return runPromiseWithLayer(Provider.defaultLayer, withCurrentInstance(effect))
}

async function invalidateProviderCache() {
  try {
    await runProvider(
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        yield* provider.refresh()
      }),
    )
  } catch (error) {
    Log.create({ service: "server" }).warn("failed to refresh provider cache", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

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

  function tailscaleUserLogin(c: { req: { header(name: string): string | undefined } }): string | undefined {
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
          if (err instanceof Session.BusyError)
            return c.json({ name: err._tag, data: { sessionID: err.sessionID, message: err.message } }, { status: 409 })
          if (err instanceof Storage.NotFoundError)
            return c.json({ name: err._tag, data: { message: err.message } }, { status: 404 })
          if (err instanceof Provider.ModelNotFoundError)
            return c.json(
              {
                name: err._tag,
                data: { providerID: err.providerID, modelID: err.modelID, suggestions: err.suggestions },
              },
              { status: 400 },
            )
          if (err instanceof Error && err.name.startsWith("Worktree"))
            return c.json({ name: err.name, data: { message: err.message } }, { status: 400 })
          if (err instanceof HTTPException) return err.getResponse()
          const message = err instanceof Error && err.stack ? err.stack : err.toString()
          return c.json(
            { name: "Unknown" as const, data: { message } },
            {
              status: 500,
            },
          )
        })
        .get("/s/:shareID", validator("param", z.object({ shareID: z.string() })), async (c) => {
          const { shareID } = c.req.valid("param")
          return c.redirect(`/share/${encodeURIComponent(shareID)}`, 308)
        })
        .get("/share/:shareID", validator("param", z.object({ shareID: z.string() })), async (c) => {
          const { shareID } = c.req.valid("param")
          const data = await runShareNext(
            Effect.gen(function* () {
              const shareNext = yield* ShareNext.Service
              return yield* shareNext.publicData(shareID)
            }),
          )
          if (!data) return c.text("Share not found", 404)
          return c.json(data)
        })
        .get("/api/share/:shareID", validator("param", z.object({ shareID: z.string() })), async (c) => {
          const { shareID } = c.req.valid("param")
          const data = await runShareNext(
            Effect.gen(function* () {
              const shareNext = yield* ShareNext.Service
              return yield* shareNext.publicData(shareID)
            }),
          )
          if (!data) return c.text("Share not found", 404)
          return c.json(data)
        })
        .get("/api/share/:shareID/data", validator("param", z.object({ shareID: z.string() })), async (c) => {
          const { shareID } = c.req.valid("param")
          const data = await runShareNext(
            Effect.gen(function* () {
              const shareNext = yield* ShareNext.Service
              return yield* shareNext.publicData(shareID)
            }),
          )
          if (!data) return c.text("Share not found", 404)
          return c.json(data)
        })
        .use(userAuthMiddleware())
        .use(async (c, next) => {
          // Public user endpoints — bypass server-level auth
          const path = c.req.path
          if (path === "/user/login" || path === "/user/register" || path === "/user/status") {
            return next()
          }

          if (c.req.method === "GET" && c.req.path === "/global/health") {
            return next()
          }

          // Always allow CORS preflight to reach the CORS middleware.
          if (c.req.method === "OPTIONS") return next()

          const password = Flag.NIKCLI_SERVER_PASSWORD
          const username = Flag.NIKCLI_SERVER_USERNAME ?? "nikcli"

          // Check bearer token in Authorization header OR query parameter (for WebSocket connections)
          const bearer = MobileAuth.bearer(c.req.raw) || c.req.query("token")
          if (bearer) {
            const userSession = (c as any).get?.("userSession")
            if (userSession) {
              return next()
            }

            const token = await MobileAuth.verify(bearer)
            if (!token) return c.text("Unauthorized", 401)
            ;(c as any).set("mobileAuth", token)
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

            // If Tailscale auth is enabled, require identity headers. Optionally allow falling back to Basic Auth.
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
              // Allow all origins for local development
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

              // Allow Tailscale Serve origins when Tailscale auth is enabled.
              if (Flag.NIKCLI_SERVER_TAILSCALE_AUTH && isLoopbackHostname(_listenHostname)) {
                if (/^https:\/\/([a-z0-9-]+\.)*ts\.net(?::\d+)?$/.test(input ?? "")) {
                  return input
                }
              }

              // *.nikcli.store (https only)
              if (/^https:\/\/([a-z0-9-]+\.)*nikcli\.store$/.test(input ?? "")) {
                return input
              }

              // Allow whitelisted origins
              if (_corsWhitelist.includes(input ?? "")) {
                return input
              }

              // For local development, allow all (bypass CORS)
              if (input?.startsWith("http://localhost") || input?.startsWith("http://127.0.0.1")) {
                return input
              }

              return
            },
          }),
        )
        .route("/global", GlobalRoutes())
        .use(async (c, next) => {
          // Skip instance/workspace context for user auth endpoints
          if (c.req.path.startsWith("/user/")) {
            return next()
          }

          let directory = c.req.query("directory") || c.req.header("x-nikcli-directory") || process.cwd()
          try {
            directory = decodeURIComponent(directory)
          } catch {
            // fallback to original value
          }
          const workspaceID = c.req.query("workspace") || c.req.header("x-nikcli-workspace")
          const workspace = workspaceID ? await Workspace.get(workspaceID).catch(() => undefined) : undefined

          if (workspace) {
            const target = await Workspace.target(workspace.id)
            if (!target) {
              return c.text(`Workspace not found: ${workspace.id}`, 404)
            }

            if (target.type === "remote") {
              if (c.req.header("upgrade")?.toLowerCase() === "websocket") {
                return ServerProxy.websocket(target, c.req.raw, c.env)
              }
              return ServerProxy.http(target, c.req.raw)
            }

            directory = target.directory
          }

          return WorkspaceContext.provide({
            workspaceID,
            fn: () => withInstanceAsync({ directory, workspaceID, init: InstanceBootstrap }, async () => next()),
          })
        })
        .get(
          "/doc",
          openAPIRouteHandler(app, {
            documentation: {
              info: {
                title: "nikcli",
                version: "0.0.4",
                description: "nikcli api",
              },
              openapi: "3.1.1",
            },
          }),
        )
        .use(validator("query", z.object({ directory: z.string().optional(), workspace: z.string().optional() })))
        .use(async (c, next) => {
          if (!Flag.NIKCLI_EXPERIMENTAL_HTTPAPI || !HttpApiBridge.supports(c.req.path, c.req.method)) {
            return next()
          }
          return HttpApiBridge.handle(c.req.raw)
        })
        .route("/project", ProjectRoutes())
        .route("/pty", PtyRoutes())
        .route("/config", ConfigRoutes())
        .route("/experimental", ExperimentalRoutes())
        .route("/session", SessionRoutes())
        .route("/permission", PermissionRoutes())
        .route("/question", QuestionRoutes())
        .route("/provider", ProviderRoutes())
        .route("/companion", CompanionRoutes())
        .route("/user", UserRoutes())
        .route("/mobile", MobileRoutes())
        .route("/", FileRoutes())
        .route("/connectors", ConnectorsRoutes())
        .route("/chatbot", ChatBotRoutes())
        .route("/mcp", McpRoutes())
        .route("/tui", TuiRoutes())
        .route("/analytics", AnalyticsRoutes())
        .post(
          "/instance/dispose",
          describeRoute({
            summary: "Dispose instance",
            description: "Clean up and dispose the current Nikcli instance, releasing all resources.",
            operationId: "instance.dispose",
            responses: {
              200: {
                description: "Instance disposed",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
            },
          }),
          async (c) => {
            await Instance.dispose()
            return c.json(true)
          },
        )
        .get(
          "/path",
          describeRoute({
            summary: "Get paths",
            description: "Retrieve the current working directory and related path information for the Nikcli instance.",
            operationId: "path.get",
            responses: {
              200: {
                description: "Path",
                content: {
                  "application/json": {
                    schema: resolver(
                      z
                        .object({
                          home: z.string(),
                          state: z.string(),
                          config: z.string(),
                          worktree: z.string(),
                          directory: z.string(),
                        })
                        .meta({
                          ref: "Path",
                        }),
                    ),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json({
              home: Global.Path.home,
              state: Global.Path.state,
              config: Global.Path.config,
              worktree: Instance.worktree,
              directory: Instance.directory,
            })
          },
        )
        .get(
          "/vcs",
          describeRoute({
            summary: "Get VCS info",
            description:
              "Retrieve version control system (VCS) information for the current project, such as git branch.",
            operationId: "vcs.get",
            responses: {
              200: {
                description: "VCS info",
                content: {
                  "application/json": {
                    schema: resolver(Vcs.Info),
                  },
                },
              },
            },
          }),
          async (c) => {
            const branch = await runPromiseWithLayer(
              Vcs.defaultLayer,
              withCurrentInstance(
                Effect.gen(function* () {
                  const vcs = yield* Vcs.Service
                  return yield* vcs.branch()
                }),
              ),
            )
            return c.json({
              branch,
            })
          },
        )
        .get(
          "/command",
          describeRoute({
            summary: "List commands",
            description: "Get a list of all available commands in the Nikcli system.",
            operationId: "command.list",
            responses: {
              200: {
                description: "List of commands",
                content: {
                  "application/json": {
                    schema: resolver(Command.Info.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const commands = await runCommand(
              Effect.gen(function* () {
                const command = yield* Command.Service
                return yield* command.list()
              }),
            )
            return c.json(commands)
          },
        )
        .post(
          "/log",
          describeRoute({
            summary: "Write log",
            description: "Write a log entry to the server logs with specified level and metadata.",
            operationId: "app.log",
            responses: {
              200: {
                description: "Log entry written successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator(
            "json",
            z.object({
              service: z.string().meta({ description: "Service name for the log entry" }),
              level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
              message: z.string().meta({ description: "Log message" }),
              extra: z
                .record(z.string(), z.any())
                .optional()
                .meta({ description: "Additional metadata for the log entry" }),
            }),
          ),
          async (c) => {
            const { service, level, message, extra } = c.req.valid("json")
            const logger = Log.create({ service })

            switch (level) {
              case "debug":
                logger.debug(message, extra)
                break
              case "info":
                logger.info(message, extra)
                break
              case "error":
                logger.error(message, extra)
                break
              case "warn":
                logger.warn(message, extra)
                break
            }

            return c.json(true)
          },
        )
        .get(
          "/agent",
          describeRoute({
            summary: "List agents",
            description: "Get a list of all available AI agents in the Nikcli system.",
            operationId: "app.agents",
            responses: {
              200: {
                description: "List of agents",
                content: {
                  "application/json": {
                    schema: resolver(Agent.Info.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const modes = await runAgent(
              Effect.gen(function* () {
                const agent = yield* Agent.Service
                return yield* agent.list()
              }),
            )
            return c.json(modes)
          },
        )
        .get(
          "/skill",
          describeRoute({
            summary: "List skills",
            description: "Get a list of all available skills in the Nikcli system.",
            operationId: "app.skills",
            responses: {
              200: {
                description: "List of skills",
                content: {
                  "application/json": {
                    schema: resolver(Skill.Info.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const skills = await runSkill(
              Effect.gen(function* () {
                const skill = yield* Skill.Service
                return yield* skill.all()
              }),
            )
            return c.json(skills)
          },
        )
        .post(
          "/skill",
          describeRoute({
            summary: "Create skill",
            description: "Create a new skill with a SKILL.md file.",
            operationId: "app.skill.create",
            responses: {
              200: {
                description: "Created skill",
                content: {
                  "application/json": {
                    schema: resolver(Skill.Info),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator(
            "json",
            z.object({
              name: z.string().meta({ description: "Skill name" }),
              description: z.string().meta({ description: "Skill description" }),
              category: z.string().optional().meta({ description: "Optional category" }),
              tags: z.array(z.string()).optional().meta({ description: "Optional tags" }),
              content: z.string().optional().meta({ description: "Optional markdown content" }),
              scope: z
                .enum(["workspace", "global"])
                .optional()
                .meta({ description: "Where to create (default: workspace)" }),
            }),
          ),
          async (c) => {
            const input = c.req.valid("json")
            const skill = await runSkill(
              Effect.gen(function* () {
                const service = yield* Skill.Service
                return yield* service.create(input)
              }),
            )
            return c.json(skill)
          },
        )
        .delete(
          "/skill/:name",
          describeRoute({
            summary: "Delete skill",
            description: "Delete a skill by name.",
            operationId: "app.skill.delete",
            responses: {
              200: {
                description: "Deleted",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator(
            "param",
            z.object({
              name: z.string(),
            }),
          ),
          async (c) => {
            const { name } = c.req.valid("param")
            await runSkill(
              Effect.gen(function* () {
                const skill = yield* Skill.Service
                return yield* skill.remove(name)
              }),
            )
            return c.json(true)
          },
        )
        .get(
          "/lsp",
          describeRoute({
            summary: "Get LSP status",
            description: "Get LSP server status",
            operationId: "lsp.status",
            responses: {
              200: {
                description: "LSP server status",
                content: {
                  "application/json": {
                    schema: resolver(LSP.Status.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const status = await runLSP(
              Effect.gen(function* () {
                const lsp = yield* LSP.Service
                return yield* lsp.status()
              }),
            )
            return c.json(status)
          },
        )
        .get(
          "/formatter",
          describeRoute({
            summary: "Get formatter status",
            description: "Get formatter status",
            operationId: "formatter.status",
            responses: {
              200: {
                description: "Formatter status",
                content: {
                  "application/json": {
                    schema: resolver(Format.Status.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const status = await runPromiseWithLayer(
              Format.defaultLayer,
              withCurrentInstance(
                Effect.gen(function* () {
                  const format = yield* Format.Service
                  return yield* format.status()
                }),
              ),
            )
            return c.json(status)
          },
        )
        .put(
          "/auth/:providerID",
          describeRoute({
            summary: "Set auth credentials",
            description: "Set authentication credentials",
            operationId: "auth.set",
            responses: {
              200: {
                description: "Successfully set authentication credentials",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator(
            "param",
            z.object({
              providerID: z.string(),
            }),
          ),
          validator("json", Auth.Info),
          async (c) => {
            const providerID = c.req.valid("param").providerID
            const info = c.req.valid("json")
            await runAuth(
              Effect.gen(function* () {
                const auth = yield* Auth.Service
                yield* auth.set(providerID, info)
              }),
            )
            await invalidateProviderCache()
            return c.json(true)
          },
        )
        .delete(
          "/auth/:providerID",
          describeRoute({
            summary: "Remove auth credentials",
            description: "Remove stored authentication credentials for a provider",
            operationId: "auth.remove",
            responses: {
              200: {
                description: "Successfully removed authentication credentials",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator(
            "param",
            z.object({
              providerID: z.string(),
            }),
          ),
          async (c) => {
            const providerID = c.req.valid("param").providerID
            await runAuth(
              Effect.gen(function* () {
                const auth = yield* Auth.Service
                yield* auth.remove(providerID)
              }),
            )
            await invalidateProviderCache()
            return c.json(true)
          },
        )
        .get(
          "/event",
          describeRoute({
            summary: "Subscribe to events",
            description: "Get events",
            operationId: "event.subscribe",
            responses: {
              200: {
                description: "Event stream",
                content: {
                  "text/event-stream": {
                    schema: resolver(BusEvent.payloads()),
                  },
                },
              },
            },
          }),
          async (c) => {
            log.info("event connected")
            return streamSSE(c, async (stream) => {
              stream.writeSSE({
                data: JSON.stringify({
                  type: "server.connected",
                  properties: {},
                }),
              })
              const unsub = Bus.subscribeAll(async (event) => {
                await stream.writeSSE({
                  data: JSON.stringify(event),
                })
                if (event.type === Bus.InstanceDisposed.type) {
                  stream.close()
                }
              })

              // Send heartbeat every 30s to prevent WKWebView timeout (60s default)
              const heartbeat = setInterval(() => {
                stream.writeSSE({
                  data: JSON.stringify({
                    type: "server.heartbeat",
                    properties: {},
                  }),
                })
              }, 30000)

              await new Promise<void>((resolve) => {
                stream.onAbort(() => {
                  clearInterval(heartbeat)
                  unsub()
                  resolve()
                  log.info("event disconnected")
                })
              })
            })
          },
        )
        .all("/*", async (c) => {
          const path = c.req.path

          const response = await proxy(`https://app.nikcli.store${path}`, {
            ...c.req,
            headers: {
              ...c.req.raw.headers,
              host: "app.nikcli.store",
            },
          })
          response.headers.set(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' ws: wss: https: blob: data:",
          )
          return response
        }) as unknown as Hono,
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
    const envCors = process.env.NIKCLI_SERVER_CORS_ORIGINS
      ? process.env.NIKCLI_SERVER_CORS_ORIGINS.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : []
    _corsWhitelist = [...(opts.cors ?? []), ...envCors]
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
      void runProject(
        Effect.gen(function* () {
          const project = yield* Project.Service
          return yield* project.list()
        }),
      )
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
