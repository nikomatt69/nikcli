import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import z from "zod"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { MessageV2 } from "@/session/message-v2"
import { PermissionNext } from "@/permission/next"
import { GlobalBus } from "@/bus/global"
import { Snapshot } from "@/snapshot"
import { Worktree } from "@/worktree"
import { GithubApi } from "@/connectors/api/github"
import { ConnectorAuth } from "@/connectors/auth"
import { Connectors } from "@/connectors"
import { Installation } from "@/installation"
import { MobileAuth } from "@/mobile/auth"
import { MobileGithubRepo } from "@/mobile/github-repo"
import { Storage } from "@/storage/storage"
import { errors } from "../error"
import { lazy } from "@/util/lazy"
import { Log } from "@/util/log"

const log = Log.create({ service: "mobile-routes" })

const MobileProject = Project.Info.extend({ current: z.boolean() }).meta({ ref: "MobileProject" })
const MobileBootstrap = z
  .object({
    version: z.string(),
    auth: z.object({
      bearerEnabled: z.boolean(),
      currentToken: MobileAuth.PublicToken.optional(),
    }),
    currentProject: MobileProject,
    projects: MobileProject.array(),
    github: z.object({
      connected: z.boolean(),
      user: z
        .object({
          login: z.string(),
          name: z.string().nullable().optional(),
          avatar_url: z.string().optional(),
        })
        .optional(),
    }),
  })
  .meta({ ref: "MobileBootstrap" })

const MobileSessionSummary = z
  .object({
    info: Session.Info,
    status: SessionStatus.Info.optional(),
  })
  .meta({ ref: "MobileSessionSummary" })

const MobileSessionDetail = z
  .object({
    info: Session.Info,
    status: SessionStatus.Info.optional(),
    messages: MessageV2.WithParts.array(),
    permissions: PermissionNext.Request.array(),
  })
  .meta({ ref: "MobileSessionDetail" })

const GithubAuthInput = z.object({ token: z.string().min(1) })

const MobileGithubRepoInfo = z
  .object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    description: z.string().nullable(),
    private: z.boolean(),
    html_url: z.string(),
    clone_url: z.string(),
    default_branch: z.string(),
    updated_at: z.string(),
    stargazers_count: z.number(),
    language: z.string().nullable(),
    topics: z.string().array(),
    imported: z.boolean().optional(),
    imported_directory: z.string().optional(),
    imported_project_id: z.string().optional(),
  })
  .meta({ ref: "MobileGithubRepoInfo" })

function currentToken(c: any) {
  return (c.get("mobileAuth") as MobileAuth.PublicToken | undefined) ?? undefined
}

async function getSessionAnyProject(sessionID: string): Promise<Session.Info> {
  try {
    return await Session.get(sessionID)
  } catch (e) {
    if (!(e instanceof Storage.NotFoundError)) throw e
  }
  // Fallback: session was created in a different project context — scan all projects
  const allKeys = await Storage.list(["session"])
  for (const key of allKeys) {
    if (key.length === 3 && key[2] === sessionID) {
      try {
        return await Storage.read<Session.Info>(key)
      } catch {
        continue
      }
    }
  }
  throw new Storage.NotFoundError({ message: `Session not found: ${sessionID}` })
}

function extractSessionIDs(value: unknown): string[] {
  if (!value || typeof value !== "object") return []
  const result = new Set<string>()
  const visit = (input: unknown) => {
    if (!input || typeof input !== "object") return
    if (Array.isArray(input)) {
      for (const item of input) visit(item)
      return
    }
    for (const [key, current] of Object.entries(input)) {
      if ((key === "sessionID" || key === "id") && typeof current === "string" && current.startsWith("ses_")) {
        result.add(current)
      }
      if (current && typeof current === "object") visit(current)
    }
  }
  visit(value)
  return [...result]
}

async function githubToken() {
  const auth = await ConnectorAuth.get("github")
  return auth?.token
}

async function githubUser() {
  const token = await githubToken()
  if (!token) return
  return GithubApi.getUser(token).catch(() => undefined)
}

async function githubImports() {
  const imports = await MobileGithubRepo.list()
  return new Map(imports.map((item) => [item.fullName.toLowerCase(), item] as const))
}

export const MobileRoutes = lazy(() =>
  new Hono()
    .post(
      "/auth/token",
      describeRoute({
        summary: "Create mobile auth token",
        description: "Exchange valid Basic auth credentials for a long-lived mobile Bearer token.",
        operationId: "mobile.auth.token.create",
        responses: {
          200: {
            description: "Mobile token",
            content: {
              "application/json": {
                schema: resolver(z.object({ token: z.string(), info: MobileAuth.PublicToken })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z
          .object({
            name: z.string().optional(),
            expiresInDays: z.number().optional(),
          })
          .optional(),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const result = await MobileAuth.create(body ?? undefined)
        return c.json(result)
      },
    )
    .delete(
      "/auth/token/:id",
      describeRoute({
        summary: "Revoke mobile auth token",
        description: "Revoke a previously issued mobile Bearer token.",
        operationId: "mobile.auth.token.revoke",
        responses: {
          200: {
            description: "Token revoked",
            content: { "application/json": { schema: resolver(z.object({ revoked: z.boolean() })) } },
          },
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const removed = await MobileAuth.remove(c.req.valid("param").id)
        return c.json({ revoked: removed })
      },
    )
    .get(
      "/auth/token",
      describeRoute({
        summary: "List mobile auth tokens",
        description: "List all active mobile Bearer tokens.",
        operationId: "mobile.auth.token.list",
        responses: {
          200: {
            description: "Token list",
            content: { "application/json": { schema: resolver(MobileAuth.PublicToken.array()) } },
          },
        },
      }),
      async (c) => {
        return c.json(await MobileAuth.list())
      },
    )
    .get(
      "/bootstrap",
      describeRoute({
        summary: "Get mobile bootstrap payload",
        description: "Return the current mobile bootstrap state for the connected host.",
        operationId: "mobile.bootstrap",
        responses: {
          200: {
            description: "Bootstrap payload",
            content: { "application/json": { schema: resolver(MobileBootstrap) } },
          },
        },
      }),
      async (c) => {
        const projects = await Project.list()
        const token = currentToken(c)
        const user = await githubUser()
        return c.json({
          version: Installation.VERSION,
          auth: {
            bearerEnabled: true,
            currentToken: token,
          },
          currentProject: {
            ...Instance.project,
            current: true,
          },
          projects: projects.map((project) => ({
            ...project,
            current: project.id === Instance.project.id,
          })),
          github: {
            connected: Boolean(user),
            user: user
              ? {
                  login: user.login,
                  name: user.name,
                  avatar_url: user.avatar_url,
                }
              : undefined,
          },
        })
      },
    )
    .get(
      "/project",
      describeRoute({
        summary: "List local projects for mobile",
        description: "Return local projects and sandboxes visible to the connected Nikcli host.",
        operationId: "mobile.project.list",
        responses: {
          200: {
            description: "Projects",
            content: { "application/json": { schema: resolver(MobileProject.array()) } },
          },
        },
      }),
      async (c) => {
        const projects = await Project.list()
        return c.json(
          projects.map((project) => ({
            ...project,
            current: project.id === Instance.project.id,
          })),
        )
      },
    )
    .get(
      "/github/repos",
      describeRoute({
        summary: "List GitHub repositories for mobile",
        description: "List repositories available to the stored GitHub connector token.",
        operationId: "mobile.github.repos",
        responses: {
          200: {
            description: "GitHub repositories",
            content: { "application/json": { schema: resolver(z.array(z.any())) } },
          },
          ...errors(401),
        },
      }),
      async (c) => {
        const token = await githubToken()
        if (!token) return c.json({ error: "GitHub token not configured" }, 401)
        const [repos, imports] = await Promise.all([GithubApi.listRepos(token, "all", "updated"), githubImports()])
        return c.json(
          repos.map((repo: any) => {
            const existing = imports.get(String(repo.full_name).toLowerCase())
            return {
              ...repo,
              imported: Boolean(existing),
              imported_directory: existing?.directory,
              imported_project_id: existing?.projectID,
            }
          }),
        )
      },
    )
    .get(
      "/github/imports",
      describeRoute({
        summary: "List imported GitHub repos for mobile",
        description: "List GitHub repositories that have already been cloned into the Nikcli host cache.",
        operationId: "mobile.github.imports",
        responses: {
          200: {
            description: "Imported repos",
            content: { "application/json": { schema: resolver(MobileGithubRepo.Import.array()) } },
          },
        },
      }),
      async (c) => {
        return c.json(await MobileGithubRepo.list())
      },
    )
    .post(
      "/github/auth",
      describeRoute({
        summary: "Store GitHub token for mobile",
        description: "Persist a GitHub token on the Nikcli host for mobile repo access.",
        operationId: "mobile.github.auth.set",
        responses: {
          200: {
            description: "GitHub auth status",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
          ...errors(400),
        },
      }),
      validator("json", GithubAuthInput),
      async (c) => {
        const payload = c.req.valid("json")
        await ConnectorAuth.set("github", { token: payload.token })
        Connectors.invalidateConnector("github")
        return c.json({ success: true as const })
      },
    )
    .delete(
      "/github/auth",
      describeRoute({
        summary: "Remove stored GitHub token for mobile",
        description: "Delete the mobile GitHub token from the Nikcli host.",
        operationId: "mobile.github.auth.remove",
        responses: {
          200: {
            description: "GitHub auth removed",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
        },
      }),
      async (c) => {
        await ConnectorAuth.remove("github")
        Connectors.invalidateConnector("github")
        return c.json({ success: true as const })
      },
    )
    .post(
      "/github/import",
      describeRoute({
        summary: "Import GitHub repo into Nikcli host",
        description: "Clone or refresh a repository from the connected GitHub account into the managed host cache.",
        operationId: "mobile.github.import",
        responses: {
          200: {
            description: "Imported repository",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    import: MobileGithubRepo.Import,
                    project: Project.Info,
                  }),
                ),
              },
            },
          },
          ...errors(400, 401),
        },
      }),
      validator("json", MobileGithubRepo.ImportRequest),
      async (c) => {
        const token = await githubToken()
        if (!token) return c.json({ error: "GitHub token not configured" }, 401)
        const result = await MobileGithubRepo.importRepo(c.req.valid("json"), token)
        return c.json(result)
      },
    )
    .get(
      "/session",
      describeRoute({
        summary: "List mobile sessions",
        description: "Return mobile-friendly session summaries with current status.",
        operationId: "mobile.session.list",
        responses: {
          200: {
            description: "Sessions",
            content: { "application/json": { schema: resolver(MobileSessionSummary.array()) } },
          },
        },
      }),
      validator(
        "query",
        z.object({
          limit: z.coerce.number().optional(),
          search: z.string().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const term = query.search?.toLowerCase()
        const statuses = SessionStatus.list()
        const sessions: z.infer<typeof MobileSessionSummary>[] = []
        // List sessions across all projects for mobile (cross-project view)
        const allKeys = await Storage.list(["session"])
        const seen = new Set<string>()
        for (const key of allKeys) {
          if (key.length !== 3) continue
          const sessionID = key[2]
          if (seen.has(sessionID)) continue
          seen.add(sessionID)
          try {
            const session = await Storage.read<Session.Info>(key)
            if (term && !session.title.toLowerCase().includes(term)) continue
            sessions.push({ info: session, status: statuses[session.id] })
          } catch {
            continue
          }
        }
        // Sort by most recently updated, then apply limit
        sessions.sort((a, b) => b.info.time.updated - a.info.time.updated)
        return c.json(query.limit ? sessions.slice(0, query.limit) : sessions)
      },
    )
    .post(
      "/session",
      describeRoute({
        summary: "Create mobile session",
        description: "Create a new session for the mobile app.",
        operationId: "mobile.session.create",
        responses: {
          200: {
            description: "Created session",
            content: { "application/json": { schema: resolver(Session.Info) } },
          },
          ...errors(400),
        },
      }),
      validator("json", Session.create.schema.optional()),
      async (c) => {
        const body = c.req.valid("json") ?? {}
        const session = await Session.create(body)
        return c.json(session)
      },
    )
    .get(
      "/session/:sessionID",
      describeRoute({
        summary: "Get mobile session detail",
        description: "Return a session, its messages, status, and pending permissions.",
        operationId: "mobile.session.detail",
        responses: {
          200: {
            description: "Session detail",
            content: { "application/json": { schema: resolver(MobileSessionDetail) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const [info, messages, permissions] = await Promise.all([
          getSessionAnyProject(sessionID),
          Session.messages({ sessionID }),
          PermissionNext.list().then((items) => items.filter((item) => item.sessionID === sessionID)),
        ])
        return c.json({
          info,
          status: SessionStatus.list()[sessionID],
          messages,
          permissions,
        })
      },
    )
    .get(
      "/session/:sessionID/diff/:messageID",
      describeRoute({
        summary: "Get session diff for mobile",
        description: "Return file diffs for a specific message in a session.",
        operationId: "mobile.session.diff",
        responses: {
          200: {
            description: "Message diff",
            content: { "application/json": { schema: resolver(Snapshot.FileDiff.array()) } },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string(), messageID: z.string() })),
      async (c) => {
        const params = c.req.valid("param")
        const result = await SessionSummary.diff({ sessionID: params.sessionID, messageID: params.messageID })
        return c.json(result)
      },
    )
    .post(
      "/session/:sessionID/message",
      describeRoute({
        summary: "Send mobile session message",
        description: "Queue a message for a session and rely on the session stream for realtime updates.",
        operationId: "mobile.session.message",
        responses: {
          202: {
            description: "Message accepted",
            content: { "application/json": { schema: resolver(z.object({ accepted: z.literal(true) })) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        void SessionPrompt.prompt({ ...body, sessionID }).catch((error) => {
          log.error("mobile session prompt failed", {
            sessionID,
            error: error instanceof Error ? error.message : String(error),
          })
        })
        return c.json({ accepted: true as const }, 202)
      },
    )
    .post(
      "/session/:sessionID/abort",
      describeRoute({
        summary: "Abort mobile session",
        description: "Abort the active run for a session.",
        operationId: "mobile.session.abort",
        responses: {
          200: {
            description: "Session aborted",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        SessionPrompt.cancel(c.req.valid("param").sessionID)
        return c.json({ success: true as const })
      },
    )
    .post(
      "/session/:sessionID/permissions/:permissionID",
      describeRoute({
        summary: "Respond to permission from mobile",
        description: "Approve, always approve, or reject a pending permission request.",
        operationId: "mobile.permission.respond",
        responses: {
          200: {
            description: "Permission processed",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string(), permissionID: z.string() })),
      validator("json", z.object({ response: PermissionNext.Reply })),
      async (c) => {
        const params = c.req.valid("param")
        PermissionNext.reply({ requestID: params.permissionID, reply: c.req.valid("json").response })
        return c.json({ success: true as const })
      },
    )
    .get(
      "/session/:sessionID/stream",
      describeRoute({
        summary: "Stream mobile session events",
        description: "Subscribe to session-scoped realtime events for the mobile chat UI.",
        operationId: "mobile.session.stream",
        responses: {
          200: {
            description: "Session event stream",
            content: { "text/event-stream": { schema: resolver(z.any()) } },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        return streamSSE(c, async (stream) => {
          await stream.writeSSE({
            data: JSON.stringify({ type: "server.connected", properties: { sessionID } }),
          })

          const onEvent = async (event: any) => {
            const payload = event?.payload
            if (!payload?.type) return
            const ids = extractSessionIDs(payload.properties)
            if (!ids.includes(sessionID)) return
            await stream.writeSSE({
              data: JSON.stringify(payload),
            })
          }

          GlobalBus.on("event", onEvent)

          const heartbeat = setInterval(() => {
            void stream.writeSSE({
              data: JSON.stringify({ type: "server.heartbeat", properties: { sessionID } }),
            })
          }, 30000)

          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              clearInterval(heartbeat)
              GlobalBus.off("event", onEvent)
              resolve()
            })
          })
        })
      },
    )
    .post(
      "/worktree",
      describeRoute({
        summary: "Create mobile worktree",
        description: "Create a git worktree for sandboxed mobile work.",
        operationId: "mobile.worktree.create",
        responses: {
          200: {
            description: "Worktree created",
            content: { "application/json": { schema: resolver(Worktree.Info) } },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.CreateInput.optional()),
      async (c) => {
        const worktree = await Worktree.create(c.req.valid("json") ?? undefined)
        return c.json(worktree)
      },
    )
    .post(
      "/worktree/reset",
      describeRoute({
        summary: "Reset mobile worktree",
        description: "Reset a worktree back to the default branch state.",
        operationId: "mobile.worktree.reset",
        responses: {
          200: {
            description: "Worktree reset",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
        },
      }),
      validator("json", Worktree.ResetInput),
      async (c) => {
        await Worktree.reset(c.req.valid("json"))
        return c.json({ success: true as const })
      },
    )
    .delete(
      "/worktree",
      describeRoute({
        summary: "Remove mobile worktree",
        description: "Remove an existing worktree sandbox.",
        operationId: "mobile.worktree.remove",
        responses: {
          200: {
            description: "Worktree removed",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
        },
      }),
      validator("json", Worktree.RemoveInput),
      async (c) => {
        const input = c.req.valid("json")
        await Worktree.remove(input)
        await Project.removeSandbox(Instance.project.id, input.directory).catch(() => undefined)
        return c.json({ success: true as const })
      },
    ),
)
