import path from "path"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { NamedError } from "@nikcli-ai/util/error"
import z from "zod"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { MessageV2 } from "@/session/message-v2"
import { Agent } from "@/agent/agent"
import { PermissionNext } from "@/permission/next"
import { Provider } from "@/provider/provider"
import { GlobalBus } from "@/bus/global"
import { Snapshot } from "@/snapshot"
import { Worktree } from "@/worktree"
import { GithubApi } from "@/connectors/api/github"
import { ConnectorAuth } from "@/connectors/auth"
import { Connectors } from "@/connectors"
import { resolveCredential } from "@/connectors/credentials"
import { Installation } from "@/installation"
import { Global } from "@/global"
import { MobileAuth } from "@/mobile/auth"
import { MobileGithubRepo } from "@/mobile/github-repo"
import { Tophat } from "@/mobile/tophat"
import { Expo } from "@/mobile/expo"
import { Simulator } from "@/mobile/simulator"
import { ReactNative } from "@/mobile/react-native"
import { MobileProjectDetect } from "@/mobile/project-detect"
import { Storage } from "@/storage/storage"
import { Flag } from "@/flag/flag"
import { Config } from "@/config/config"
import { Command } from "@/command"
import { Workspace } from "@/workspace"
import { WorkspaceContext } from "@/workspace/workspace-context"
import { getContainerRuntimeInfo } from "@/workspace/adaptors"
import { proxyWorkspaceRequest } from "@/workspace/session-proxy-middleware"
import { PromptStashStore } from "@/prompt/stash-store"
import { errors } from "../error"
import { lazy } from "@/util/lazy"
import { Log } from "@/util/log"

const log = Log.create({ service: "mobile-routes" })

const MobileProject = Project.Info.extend({ current: z.boolean() }).meta({ ref: "MobileProject" })
const MobileExecutionTarget = z.enum(["local", "container"]).meta({ ref: "MobileExecutionTarget" })

const MobileTophatStatus = z
  .object({
    available: z.boolean(),
    providers: z.array(z.object({ id: z.string() })),
    devices: z.array(z.object({ name: z.string(), platform: z.string() })),
  })
  .meta({ ref: "MobileTophatStatus" })

const MobileProjectType = z
  .object({
    detected: z.boolean(),
    platforms: z.array(z.string()).optional(),
    primaryPlatform: z.string().optional(),
    method: z.string().optional(),
    root: z.string().optional(),
  })
  .meta({ ref: "MobileProjectType" })

const MobileBootstrap = z
  .object({
    version: z.string(),
    auth: z.object({
      bearerEnabled: z.boolean(),
      currentToken: MobileAuth.PublicToken.optional(),
    }),
    currentProject: MobileProject,
    projects: MobileProject.array(),
    execution: z.object({
      container: z.object({
        available: z.boolean(),
        runtime: z.enum(["docker", "podman"]).optional(),
        image: z.string(),
      }),
    }),
    github: z.object({
      connected: z.boolean(),
      oauthDeviceEnabled: z.boolean(),
      oauthDeviceConfigured: z.boolean().optional(),
      oauthClientSource: z.enum(["flag", "config", "env"]).optional(),
      user: z
        .object({
          login: z.string(),
          name: z.string().nullable().optional(),
          avatar_url: z.string().optional(),
        })
        .optional(),
    }),
    tophat: MobileTophatStatus.optional(),
    mobileProject: MobileProjectType.optional(),
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

const MobileGithubBranch = z
  .object({
    name: z.string(),
    protected: z.boolean().optional(),
    commit: z.object({
      sha: z.string(),
    }),
  })
  .meta({ ref: "MobileGithubBranch" })

const MobileGithubSessionCreateInput = z
  .object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    cloneUrl: z.url(),
    htmlUrl: z.url().optional(),
    defaultBranch: z.string().min(1),
    baseBranch: z.string().min(1),
    private: z.boolean().default(false),
    title: z.string().optional(),
    executionTarget: MobileExecutionTarget.default("local"),
  })
  .meta({ ref: "MobileGithubSessionCreateInput" })

const MobileSessionCreateInput = z
  .object({
    parentID: Session.Info.shape.parentID,
    title: Session.Info.shape.title.optional(),
    permission: Session.Info.shape.permission,
    github: Session.Info.shape.github.optional(),
    executionTarget: MobileExecutionTarget.default("local"),
  })
  .optional()
  .meta({ ref: "MobileSessionCreateInput" })

const MobileGithubSessionCreateResult = z
  .object({
    session: Session.Info,
    worktree: Worktree.Info,
    project: Project.Info,
    workspace: Workspace.Info.optional(),
  })
  .meta({ ref: "MobileGithubSessionCreateResult" })

const MobileCommand = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    agent: z.string().optional(),
    model: z.string().optional(),
    mcp: z.boolean().optional(),
    skill: z.boolean().optional(),
    subtask: z.boolean().optional(),
    hints: z.array(z.string()),
  })
  .meta({ ref: "MobileCommand" })

const MobileSessionCommandInput = z
  .object({
    command: z.string().min(1),
    arguments: z.string().default(""),
    agent: z.string().optional(),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
  })
  .meta({ ref: "MobileSessionCommandInput" })

const MobileGithubPublishInput = z
  .object({
    title: z.string().optional(),
    body: z.string().optional(),
    commitMessage: z.string().optional(),
  })
  .optional()
  .meta({ ref: "MobileGithubPublishInput" })

const MobileGithubPublishResult = z
  .object({
    commitSha: z.string(),
    branch: z.string(),
    pullRequest: z.object({
      number: z.number(),
      url: z.string(),
      title: z.string(),
    }),
  })
  .meta({ ref: "MobileGithubPublishResult" })

const MobileGithubDeviceAuthStart = z
  .object({
    deviceCode: z.string(),
    userCode: z.string(),
    verificationUri: z.string(),
    verificationUriComplete: z.string().optional(),
    expiresAt: z.number(),
    interval: z.number(),
  })
  .meta({ ref: "MobileGithubDeviceAuthStart" })

const MobileGithubDeviceAuthPollInput = z
  .object({
    deviceCode: z.string().min(1),
  })
  .meta({ ref: "MobileGithubDeviceAuthPollInput" })

const MobileGithubDeviceAuthPollResult = z
  .object({
    status: z.enum(["pending", "approved", "denied", "expired"]),
    interval: z.number().optional(),
    user: z
      .object({
        login: z.string(),
        name: z.string().nullable().optional(),
        avatar_url: z.string().optional(),
      })
      .optional(),
  })
  .meta({ ref: "MobileGithubDeviceAuthPollResult" })

const MobilePromptHistoryEntry = z
  .object({
    id: z.string(),
    input: z.string(),
    mode: z.enum(["normal", "shell"]).optional(),
    partsCount: z.number(),
  })
  .meta({ ref: "MobilePromptHistoryEntry" })

const MobilePromptStashEntry = z
  .object({
    id: z.string(),
    input: z.string(),
    timestamp: z.number(),
    partsCount: z.number(),
  })
  .meta({ ref: "MobilePromptStashEntry" })

const MobilePromptStashCreateInput = z
  .object({
    input: z.string().trim().min(1),
  })
  .meta({ ref: "MobilePromptStashCreateInput" })

const MobileMemorySearchHit = z
  .object({
    id: z.string(),
    sessionID: z.string(),
    sessionTitle: z.string(),
    messageID: z.string(),
    role: z.enum(["user", "assistant"]),
    createdAt: z.number(),
    preview: z.string(),
  })
  .meta({ ref: "MobileMemorySearchHit" })

function currentToken(c: any) {
  return (c.get("mobileAuth") as MobileAuth.PublicToken | undefined) ?? undefined
}

type PromptHistoryRecord = {
  input: string
  mode?: "normal" | "shell"
  parts?: unknown[]
}

type PromptStashRecord = {
  input: string
  timestamp: number
  parts?: unknown[]
}

async function readJsonLines<T>(filePath: string) {
  const text = await Bun.file(filePath)
    .text()
    .catch(() => "")
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as T
      } catch {
        return null
      }
    })
    .filter((item): item is T => item !== null)
}

function historyFilePath() {
  return path.join(Global.Path.state, "prompt-history.jsonl")
}

function stashFilePath() {
  return path.join(Global.Path.state, "prompt-stash.jsonl")
}

async function listPromptHistory() {
  const entries = await readJsonLines<PromptHistoryRecord>(historyFilePath())
  return entries
    .filter((entry): entry is PromptHistoryRecord => typeof entry.input === "string")
    .slice(-50)
    .reverse()
    .map((entry, index) => ({
      id: `${index}`,
      input: entry.input,
      mode: entry.mode === "shell" ? "shell" : entry.mode === "normal" ? "normal" : undefined,
      partsCount: Array.isArray(entry.parts) ? entry.parts.length : 0,
    }))
}

async function listPromptStash() {
  const entries = await PromptStashStore.list()
  return entries
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((entry) => ({
      id: entry.id,
      input: entry.input,
      timestamp: entry.timestamp,
      partsCount: Array.isArray(entry.parts) ? entry.parts.length : 0,
    }))
}

function messageSearchText(message: MessageV2.WithParts) {
  const text = message.parts
    .filter((part): part is Extract<MessageV2.WithParts["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim()
  if (text) return text
  if (message.info.role === "assistant") {
    return message.info.error?.data?.message?.trim() ?? ""
  }
  return ""
}

function snippetForQuery(text: string, query: string) {
  const lower = text.toLowerCase()
  const index = lower.indexOf(query)
  if (index === -1) return text.slice(0, 180)
  const start = Math.max(0, index - 48)
  const end = Math.min(text.length, index + query.length + 108)
  const prefix = start > 0 ? "..." : ""
  const suffix = end < text.length ? "..." : ""
  return `${prefix}${text.slice(start, end).trim()}${suffix}`
}

async function searchPromptMemories(query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return []
  const hits: Array<{
    id: string
    sessionID: string
    sessionTitle: string
    messageID: string
    role: "user" | "assistant"
    createdAt: number
    preview: string
  }> = []

  const sessionKeys = await Storage.list(["session"])
  for (const key of sessionKeys) {
    if (key.length !== 3) continue
    const session = await Storage.read<Session.Info>(key).catch(() => undefined)
    if (!session) continue
    const messages = await Session.messages({ sessionID: session.id }).catch(() => [])
    for (const message of messages) {
      const text = messageSearchText(message)
      if (!text || !text.toLowerCase().includes(normalized)) continue
      hits.push({
        id: `${session.id}:${message.info.id}`,
        sessionID: session.id,
        sessionTitle: session.title,
        messageID: message.info.id,
        role: message.info.role,
        createdAt: message.info.time.created,
        preview: snippetForQuery(text, normalized),
      })
      if (hits.length >= 40) break
    }
    if (hits.length >= 40) break
  }

  return hits.sort((a, b) => b.createdAt - a.createdAt).slice(0, 24)
}

async function latestPromptDefaults(sessionID: string) {
  const messages = await Session.messages({ sessionID, limit: 24 }).catch(() => [])
  for (let index = messages.length - 1; index >= 0; index--) {
    const info = messages[index]?.info
    if (!info || info.role !== "user") continue
    return {
      agent: info.agent,
      model: info.model,
    }
  }
  return {}
}

async function resolveMobilePromptDefaults(session: Session.Info) {
  return Instance.provide({
    directory: session.directory,
    async fn() {
      const current = await latestPromptDefaults(session.id)
      if (current.agent && current.model) return current

      const allKeys = await Storage.list(["session"])
      const sessions: Session.Info[] = []
      for (const key of allKeys) {
        if (key.length !== 3 || key[2] === session.id) continue
        const candidate = await Storage.read<Session.Info>(key).catch(() => undefined)
        if (!candidate || candidate.projectID !== session.projectID) continue
        sessions.push(candidate)
      }

      sessions.sort((a, b) => b.time.updated - a.time.updated)

      for (const candidate of sessions) {
        const fallback = await latestPromptDefaults(candidate.id)
        if (!fallback.agent || !fallback.model) continue
        return {
          agent: current.agent ?? fallback.agent,
          model: current.model ?? fallback.model,
        }
      }

      return {
        agent: current.agent ?? (await Agent.defaultAgent()),
        model: current.model ?? (await Provider.defaultModel()),
      }
    },
  })
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
  const config = await Config.get().catch(() => undefined)
  const githubConnector = Object.values(config?.connectors ?? {}).find(
    (c): c is Config.ConnectorGithub => typeof c === "object" && c !== null && "type" in c && c.type === "github",
  )
  const connector = githubConnector ?? ({ type: "github" } as Config.ConnectorGithub)
  return resolveCredential("github", connector)
}

async function githubOAuthClientID() {
  const config = await Config.get().catch(() => undefined)
  const githubConnector = Object.values(config?.connectors ?? {}).find(
    (connector): connector is Config.ConnectorGithub =>
      typeof connector === "object" && connector !== null && "type" in connector && connector.type === "github",
  )

  const flagValue = Flag.NIKCLI_GITHUB_OAUTH_CLIENT_ID
  if (flagValue) {
    return {
      clientID: flagValue,
      source: "flag" as const,
    }
  }

  const configValue = githubConnector?.oauthClientId || githubConnector?.clientId
  if (configValue) {
    return {
      clientID: configValue,
      source: "config" as const,
    }
  }

  const envValue =
    process.env.NIKCLI_GITHUB_OAUTH_CLIENT_ID || process.env.GITHUB_CLIENT_ID_CONSOLE || process.env.GITHUB_CLIENT_ID

  if (envValue) {
    return {
      clientID: envValue,
      source: "env" as const,
    }
  }

  return {
    clientID: undefined,
    source: undefined,
  }
}

async function startGithubDeviceAuth() {
  const { clientID } = await githubOAuthClientID()
  if (!clientID) throw new Error("GitHub OAuth client ID is not configured on the host")
  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "nikcli-mobile",
    },
    body: JSON.stringify({
      client_id: clientID,
      scope: "repo read:user user:email",
    }),
  })
  if (!response.ok) {
    throw new Error(`GitHub device auth failed: ${response.status} ${response.statusText}`)
  }
  const payload = (await response.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    verification_uri_complete?: string
    expires_in: number
    interval?: number
  }
  return {
    deviceCode: payload.device_code,
    userCode: payload.user_code,
    verificationUri: payload.verification_uri,
    verificationUriComplete: payload.verification_uri_complete,
    expiresAt: Date.now() + payload.expires_in * 1000,
    interval: payload.interval ?? 5,
  }
}

async function pollGithubDeviceAuth(deviceCode: string) {
  const { clientID } = await githubOAuthClientID()
  if (!clientID) throw new Error("GitHub OAuth client ID is not configured on the host")
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "nikcli-mobile",
    },
    body: JSON.stringify({
      client_id: clientID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  })
  if (!response.ok) {
    throw new Error(`GitHub auth polling failed: ${response.status} ${response.statusText}`)
  }
  const payload = (await response.json()) as {
    access_token?: string
    error?: string
    interval?: number
  }
  if (payload.access_token) {
    const user = await GithubApi.getUser(payload.access_token)
    await ConnectorAuth.set("github", { token: payload.access_token })
    Connectors.invalidateConnector("github")

    const config = await Config.get().catch(() => undefined)
    if (!config?.connectors?.github) {
      await Config.update({ connectors: { github: { type: "github" } } })
    }

    return {
      status: "approved" as const,
      user: {
        login: user.login,
        name: user.name,
        avatar_url: user.avatar_url,
      },
    }
  }
  if (payload.error === "authorization_pending") {
    return {
      status: "pending" as const,
      interval: payload.interval ?? 5,
    }
  }
  if (payload.error === "slow_down") {
    return {
      status: "pending" as const,
      interval: Math.max(payload.interval ?? 5, 10),
    }
  }
  if (payload.error === "access_denied") {
    return { status: "denied" as const }
  }
  if (payload.error === "expired_token") {
    return { status: "expired" as const }
  }
  throw new Error(payload.error || "GitHub auth polling failed")
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

function slug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}

function sessionSeed() {
  return Math.random().toString(36).slice(2, 8)
}

function defaultPullRequestBody(session: Session.Info) {
  return [
    `Generated from mobile session \`${session.id}\`.`,
    session.share?.url ? `Session share: ${session.share.url}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
}

function toHeadersObject(headers: Headers) {
  return Object.fromEntries(headers.entries())
}

async function createExecutionWorkspace(input: {
  directory: string
  branch?: string | null
  target: z.infer<typeof MobileExecutionTarget>
}) {
  if (input.target !== "container") return undefined
  const runtimeInfo = await getContainerRuntimeInfo()
  if (!runtimeInfo.available || !runtimeInfo.runtime) {
    throw new Error(
      "Container sandbox is unavailable. Check Docker or Podman and the Nikcli workspace image on the host.",
    )
  }
  const runtime: "docker" | "podman" = runtimeInfo.runtime
  const project = await Project.fromDirectory(input.directory)
  return Workspace.create({
    projectID: project.project.id,
    branch: input.branch ?? null,
    config: {
      type: "container",
      directory: input.directory,
      runtime,
      image: runtimeInfo.image,
      containerName: "pending",
      port: 1,
      serverUrl: "http://127.0.0.1:1",
    },
  })
}

async function statusForSession(session: Session.Info) {
  return Instance.provide({
    directory: session.directory,
    async fn() {
      return SessionStatus.get(session.id)
    },
  })
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
        const container = await getContainerRuntimeInfo()
        const oauth = await githubOAuthClientID()
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
          execution: {
            container,
          },
          github: {
            connected: Boolean(user),
            oauthDeviceEnabled: true,
            oauthDeviceConfigured: Boolean(oauth.clientID),
            oauthClientSource: oauth.source,
            user: user
              ? {
                  login: user.login,
                  name: user.name,
                  avatar_url: user.avatar_url,
                }
              : undefined,
          },
          tophat: await Tophat.status().then((s) => ({
            available: s.available,
            providers: s.providers.map((p) => ({ id: p.id })),
            devices: s.devices.map((d) => ({ name: d.name, platform: d.platform })),
          })),
          expo: await Expo.doctor().then((r) => ({
            available: r.expoCli,
            easAvailable: r.easCli,
            details: r.details,
          })),
          reactNative: {
            available: (await ReactNative.version()) !== "not available",
            version: await ReactNative.version(),
          },
          mobileProject: await MobileProjectDetect.detect(Instance.directory).then((detected) =>
            detected
              ? {
                  detected: true,
                  platforms: detected.platforms,
                  primaryPlatform: detected.primaryPlatform,
                  method: detected.method,
                  root: detected.root,
                }
              : { detected: false },
          ),
        })
      },
    )
    .get(
      "/tophat/status",
      describeRoute({
        summary: "Get Tophat integration status",
        description: "Return Tophat availability, providers, and connected devices.",
        operationId: "mobile.tophat.status",
        responses: {
          200: {
            description: "Tophat status",
            content: {
              "application/json": {
                schema: resolver(MobileTophatStatus),
              },
            },
          },
        },
      }),
      async (c) => {
        const status = await Tophat.status()
        return c.json({
          available: status.available,
          providers: status.providers.map((p) => ({ id: p.id })),
          devices: status.devices.map((d) => ({ name: d.name, platform: d.platform })),
        })
      },
    )
    .get(
      "/tophat/install-url",
      describeRoute({
        summary: "Generate Tophat install URLs for an artifact",
        description: "Return tophat:// and localhost install URLs for a given artifact URL.",
        operationId: "mobile.tophat.install-url",
        responses: {
          200: {
            description: "Install URLs",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    deepLink: z.string(),
                    localLink: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("query", z.object({ url: z.string().url(), platform: z.enum(["ios", "android"]).optional() })),
      async (c) => {
        const { url, platform } = c.req.valid("query")
        return c.json({
          deepLink: Tophat.installUrl(url, { platform }),
          localLink: Tophat.localInstallUrl(url, { platform }),
        })
      },
    )
    .get(
      "/expo/status",
      describeRoute({
        summary: "Get Expo environment status",
        description: "Return Expo CLI, EAS CLI, and Node.js availability.",
        operationId: "mobile.expo.status",
        responses: {
          200: {
            description: "Expo status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    available: z.boolean(),
                    details: z.array(z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const report = await Expo.doctor()
        return c.json({
          available: report.expoCli,
          details: report.details,
        })
      },
    )
    .get(
      "/simulator/devices",
      describeRoute({
        summary: "List available simulators and emulators",
        description: "Return iOS Simulators and/or Android Emulators with their state.",
        operationId: "mobile.simulator.devices",
        responses: {
          200: {
            description: "Simulator list",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    ios: z.array(
                      z.object({
                        id: z.string(),
                        name: z.string(),
                        state: z.string(),
                        runtime: z.string().optional(),
                      }),
                    ),
                    android: z.array(
                      z.object({
                        id: z.string(),
                        name: z.string(),
                        state: z.string(),
                      }),
                    ),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator("query", z.object({ platform: z.enum(["ios", "android", "all"]).optional() })),
      async (c) => {
        const { platform } = c.req.valid("query")
        if (platform === "ios") {
          const ios = await Simulator.list("ios")
          return c.json({
            ios: ios.map((d) => ({ id: d.id, name: d.name, state: d.state, runtime: d.runtime })),
            android: [],
          })
        }
        if (platform === "android") {
          const android = await Simulator.list("android")
          return c.json({ ios: [], android: android.map((d) => ({ id: d.id, name: d.name, state: d.state })) })
        }
        const [ios, android] = await Promise.all([Simulator.list("ios"), Simulator.list("android")])
        return c.json({
          ios: ios.map((d) => ({ id: d.id, name: d.name, state: d.state, runtime: d.runtime })),
          android: android.map((d) => ({ id: d.id, name: d.name, state: d.state })),
        })
      },
    )
    .get(
      "/react-native/version",
      describeRoute({
        summary: "Get React Native CLI version",
        description: "Return the React Native CLI version if available.",
        operationId: "mobile.react-native.version",
        responses: {
          200: {
            description: "React Native version",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    version: z.string(),
                    available: z.boolean(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const version = await ReactNative.version()
        return c.json({ version, available: version !== "not available" })
      },
    )
    .get(
      "/memory/history",
      describeRoute({
        summary: "List prompt history for mobile",
        description: "Return recent prompt history stored on the Nikcli host.",
        operationId: "mobile.memory.history",
        responses: {
          200: {
            description: "Prompt history",
            content: { "application/json": { schema: resolver(MobilePromptHistoryEntry.array()) } },
          },
        },
      }),
      async (c) => {
        return c.json(await listPromptHistory())
      },
    )
    .get(
      "/memory/search",
      describeRoute({
        summary: "Search prompt memories for mobile",
        description: "Search across stored session messages for memory-like prompt context from mobile.",
        operationId: "mobile.memory.search",
        responses: {
          200: {
            description: "Memory search hits",
            content: { "application/json": { schema: resolver(MobileMemorySearchHit.array()) } },
          },
        },
      }),
      validator("query", z.object({ query: z.string().trim().min(1) })),
      async (c) => {
        const query = c.req.valid("query").query
        return c.json(await searchPromptMemories(query))
      },
    )
    .get(
      "/memory/stash",
      describeRoute({
        summary: "List prompt stash for mobile",
        description: "Return reusable prompt snippets stored on the Nikcli host.",
        operationId: "mobile.memory.stash.list",
        responses: {
          200: {
            description: "Prompt stash",
            content: { "application/json": { schema: resolver(MobilePromptStashEntry.array()) } },
          },
        },
      }),
      async (c) => {
        return c.json(await listPromptStash())
      },
    )
    .post(
      "/memory/stash",
      describeRoute({
        summary: "Create prompt stash entry",
        description: "Save a reusable prompt snippet on the Nikcli host.",
        operationId: "mobile.memory.stash.create",
        responses: {
          200: {
            description: "Created prompt stash entry",
            content: { "application/json": { schema: resolver(MobilePromptStashEntry) } },
          },
          ...errors(400),
        },
      }),
      validator("json", MobilePromptStashCreateInput),
      async (c) => {
        const body = c.req.valid("json")
        const [entry] = (
          await PromptStashStore.push({
            input: body.input.trim(),
            parts: [] as any,
          })
        ).slice(-1)
        return c.json({
          id: entry.id,
          input: entry.input,
          timestamp: entry.timestamp,
          partsCount: 0,
        })
      },
    )
    .delete(
      "/memory/stash/:id",
      describeRoute({
        summary: "Delete prompt stash entry",
        description: "Remove a reusable prompt snippet from the Nikcli host.",
        operationId: "mobile.memory.stash.delete",
        responses: {
          200: {
            description: "Deleted",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const id = c.req.valid("param").id
        const current = await PromptStashStore.list()
        const next = await PromptStashStore.removeByID(id)
        if (next.length === current.length) {
          return c.json({ error: "Prompt snippet not found" }, 404)
        }
        return c.json({ success: true as const })
      },
    )
    .get(
      "/command",
      describeRoute({
        summary: "List mobile commands",
        description: "Return command metadata safe for the mobile command palette and slash autocomplete.",
        operationId: "mobile.command.list",
        responses: {
          200: {
            description: "Commands",
            content: { "application/json": { schema: resolver(MobileCommand.array()) } },
          },
        },
      }),
      async (c) => {
        const commands = await Command.list()
        return c.json(
          commands
            .map((command) => ({
              name: command.name,
              description: command.description,
              agent: command.agent,
              model: command.model,
              mcp: command.mcp,
              skill: command.skill,
              subtask: command.subtask,
              hints: command.hints,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
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
      "/github/repos/:owner/:repo/branches",
      describeRoute({
        summary: "List GitHub branches for mobile",
        description: "List branches for a GitHub repository available to the stored mobile GitHub token.",
        operationId: "mobile.github.branches",
        responses: {
          200: {
            description: "GitHub branches",
            content: { "application/json": { schema: resolver(MobileGithubBranch.array()) } },
          },
          ...errors(401),
        },
      }),
      validator("param", z.object({ owner: z.string(), repo: z.string() })),
      async (c) => {
        const token = await githubToken()
        if (!token) return c.json({ error: "GitHub token not configured" }, 401)
        const params = c.req.valid("param")
        const branches = await GithubApi.listBranches(token, params.owner, params.repo)
        return c.json(branches)
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
      "/github/oauth/device",
      describeRoute({
        summary: "Start GitHub OAuth device flow",
        description: "Start a GitHub device authorization flow and return the verification code for mobile sign-in.",
        operationId: "mobile.github.oauth.device.start",
        responses: {
          200: {
            description: "GitHub device flow started",
            content: { "application/json": { schema: resolver(MobileGithubDeviceAuthStart) } },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        try {
          return c.json(await startGithubDeviceAuth())
        } catch (error) {
          return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
        }
      },
    )
    .post(
      "/github/oauth/device/poll",
      describeRoute({
        summary: "Poll GitHub OAuth device flow",
        description: "Poll GitHub device authorization status and persist the approved token on the host.",
        operationId: "mobile.github.oauth.device.poll",
        responses: {
          200: {
            description: "GitHub device flow status",
            content: { "application/json": { schema: resolver(MobileGithubDeviceAuthPollResult) } },
          },
          ...errors(400),
        },
      }),
      validator("json", MobileGithubDeviceAuthPollInput),
      async (c) => {
        try {
          return c.json(await pollGithubDeviceAuth(c.req.valid("json").deviceCode))
        } catch (error) {
          return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
        }
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
        const config = await Config.get().catch(() => undefined)
        if (!config?.connectors?.github) {
          await Config.update({ connectors: { github: { type: "github" } } })
        }
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
    .post(
      "/github/session",
      describeRoute({
        summary: "Create GitHub-backed mobile session",
        description:
          "Import a GitHub repo if needed, create an isolated worktree from a base branch, and start a session there.",
        operationId: "mobile.github.session.create",
        responses: {
          200: {
            description: "GitHub mobile session",
            content: { "application/json": { schema: resolver(MobileGithubSessionCreateResult) } },
          },
          ...errors(400, 401),
        },
      }),
      validator("json", MobileGithubSessionCreateInput),
      async (c) => {
        const token = await githubToken()
        if (!token) return c.json({ error: "GitHub token not configured" }, 401)

        const body = c.req.valid("json")
        const baseBranch = body.baseBranch.trim() || body.defaultBranch
        const imported = await MobileGithubRepo.importRepo(
          {
            owner: body.owner,
            repo: body.repo,
            cloneUrl: body.cloneUrl,
            defaultBranch: body.defaultBranch,
            private: body.private,
          },
          token,
        )

        const seed = sessionSeed()
        const headBranch = `nikcli/mobile/${slug(body.repo)}/${seed}`
        let workspace: Workspace.Info | undefined
        const worktree = await Instance.provide({
          directory: imported.import.directory,
          async fn() {
            return Worktree.create({
              name: `${slug(body.repo)}-${slug(baseBranch)}-${seed}`,
              branch: headBranch,
              baseBranch,
              remote: "origin",
            })
          },
        })

        try {
          workspace = await createExecutionWorkspace({
            directory: worktree.directory,
            branch: headBranch,
            target: body.executionTarget,
          })

          const session = await Instance.provide({
            directory: worktree.directory,
            async fn() {
              return WorkspaceContext.provide({
                workspaceID: workspace?.id,
                async fn() {
                  return Session.create({
                    title: body.title?.trim() || `${body.owner}/${body.repo} ${baseBranch}`,
                    workspaceID: workspace?.id,
                    github: {
                      owner: body.owner,
                      repo: body.repo,
                      fullName: `${body.owner}/${body.repo}`,
                      baseBranch,
                      headBranch,
                      repositoryDirectory: imported.import.directory,
                      cloneUrl: body.cloneUrl,
                      htmlUrl: body.htmlUrl,
                      private: body.private,
                      worktree,
                    },
                  })
                },
              })
            },
          })

          return c.json({ session, worktree, project: imported.project, workspace })
        } catch (error) {
          if (workspace) {
            await Workspace.remove(workspace.id).catch(() => undefined)
          }
          await Instance.provide({
            directory: imported.import.directory,
            async fn() {
              await Worktree.remove({ directory: worktree.directory }).catch(() => undefined)
            },
          }).catch(() => undefined)
          throw error
        }
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
            if (term) {
              const haystack = [
                session.title,
                session.github?.fullName,
                session.github?.baseBranch,
                session.github?.headBranch,
              ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()
              if (!haystack.includes(term)) continue
            }
            sessions.push({ info: session, status: await statusForSession(session) })
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
      validator("json", MobileSessionCreateInput),
      async (c) => {
        const body = c.req.valid("json") as Record<string, unknown> | undefined
        const executionTarget = body?.executionTarget === "container" ? "container" : "local"
        let workspace: Workspace.Info | undefined
        const sessionInput = body
          ? {
              parentID: typeof body.parentID === "string" ? body.parentID : undefined,
              title: typeof body.title === "string" ? body.title : undefined,
              permission: body.permission as Session.Info["permission"],
              github: body.github as Session.Info["github"],
            }
          : undefined

        try {
          workspace = await createExecutionWorkspace({
            directory: Instance.directory,
            target: executionTarget,
          })
          const session = await WorkspaceContext.provide({
            workspaceID: workspace?.id,
            async fn() {
              return Session.create(
                workspace?.id
                  ? {
                      ...sessionInput,
                      workspaceID: workspace.id,
                    }
                  : sessionInput,
              )
            },
          })
          return c.json(session)
        } catch (error) {
          if (workspace) {
            await Workspace.remove(workspace.id).catch(() => undefined)
          }
          throw error
        }
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
        const info = await Session.getAnyProject(sessionID)
        const { messages, permissions, status } = await Instance.provide({
          directory: info.directory,
          async fn() {
            const [messages, permissions] = await Promise.all([
              Session.messages({ sessionID }),
              PermissionNext.list().then((items) => items.filter((item) => item.sessionID === sessionID)),
            ])
            return { messages, permissions, status: SessionStatus.get(sessionID) }
          },
        })
        return c.json({
          info,
          status,
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
        const session = await Session.getAnyProject(params.sessionID)
        const result = await Instance.provide({
          directory: session.directory,
          async fn() {
            return SessionSummary.diff({ sessionID: params.sessionID, messageID: params.messageID })
          },
        })
        return c.json(result)
      },
    )
    .get(
      "/session/:sessionID/command",
      describeRoute({
        summary: "List session commands for mobile",
        description: "Return command metadata resolved in the current session context for mobile slash autocomplete.",
        operationId: "mobile.session.command.list",
        responses: {
          200: {
            description: "Commands",
            content: { "application/json": { schema: resolver(MobileCommand.array()) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await Session.getAnyProject(sessionID)
        if (session.workspaceID) {
          const response = await proxyWorkspaceRequest({
            workspaceID: session.workspaceID,
            method: "GET",
            url: "/command",
            signal: c.req.raw.signal,
          })

          if (response) {
            if (!response.ok) {
              return new Response(response.body, {
                status: response.status,
                headers: toHeadersObject(response.headers),
              })
            }

            const commands = (await response.json().catch(() => [])) as Array<Record<string, unknown>>
            return c.json(
              commands
                .map((command) => ({
                  name: typeof command.name === "string" ? command.name : "unknown",
                  description: typeof command.description === "string" ? command.description : undefined,
                  agent: typeof command.agent === "string" ? command.agent : undefined,
                  model: typeof command.model === "string" ? command.model : undefined,
                  mcp: typeof command.mcp === "boolean" ? command.mcp : undefined,
                  skill: typeof command.skill === "boolean" ? command.skill : undefined,
                  subtask: typeof command.subtask === "boolean" ? command.subtask : undefined,
                  hints: Array.isArray(command.hints)
                    ? command.hints.filter((hint): hint is string => typeof hint === "string")
                    : [],
                }))
                .filter((command) => command.name !== "unknown")
                .sort((a, b) => a.name.localeCompare(b.name)),
            )
          }
        }

        const commands = await Instance.provide({
          directory: session.directory,
          async fn() {
            return WorkspaceContext.provide({
              workspaceID: session.workspaceID,
              async fn() {
                return Command.list()
              },
            })
          },
        })
        return c.json(
          commands
            .map((command) => ({
              name: command.name,
              description: command.description,
              agent: command.agent,
              model: command.model,
              mcp: command.mcp,
              skill: command.skill,
              subtask: command.subtask,
              hints: command.hints,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
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
        const session = await Session.getAnyProject(sessionID)
        if (session.github?.worktree.cleanedAt) {
          return c.json({ error: "Session worktree has been cleaned up" }, 400)
        }

        const defaults = !body.agent || !body.model ? await resolveMobilePromptDefaults(session) : undefined
        const promptBody = {
          ...body,
          agent: body.agent ?? defaults?.agent,
          model: body.model ?? defaults?.model,
        }

        if (session.workspaceID) {
          const response = await proxyWorkspaceRequest({
            workspaceID: session.workspaceID,
            method: "POST",
            url: `/session/${encodeURIComponent(sessionID)}/prompt_async`,
            body: JSON.stringify(promptBody),
            headers: {
              "content-type": "application/json",
            },
            signal: c.req.raw.signal,
          })

          if (response) {
            if (!response.ok) {
              return new Response(response.body, {
                status: response.status,
                headers: toHeadersObject(response.headers),
              })
            }

            return c.json({ accepted: true as const }, 202)
          }
        }

        void Instance.provide({
          directory: session.directory,
          async fn() {
            return SessionPrompt.prompt({
              ...promptBody,
              sessionID,
            })
          },
        }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          SessionStatus.set(sessionID, { type: "idle" })
          Bus.publish(Session.Event.Error, {
            sessionID,
            error: new NamedError.Unknown({ message }).toObject(),
          })
          log.error("mobile session prompt failed", {
            sessionID,
            error: message,
          })
        })
        return c.json({ accepted: true as const }, 202)
      },
    )
    .post(
      "/session/:sessionID/command",
      describeRoute({
        summary: "Run mobile session command",
        description: "Execute a slash-style command against the current session.",
        operationId: "mobile.session.command",
        responses: {
          200: {
            description: "Command result",
            content: { "application/json": { schema: resolver(MessageV2.WithParts) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator("json", MobileSessionCommandInput),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const session = await Session.getAnyProject(sessionID)
        if (session.github?.worktree.cleanedAt) {
          return c.json({ error: "Session worktree has been cleaned up" }, 400)
        }

        const commandBody = {
          command: body.command,
          arguments: body.arguments,
          agent: body.agent,
          model: body.model ? `${body.model.providerID}/${body.model.modelID}` : undefined,
        }

        if (session.workspaceID) {
          const response = await proxyWorkspaceRequest({
            workspaceID: session.workspaceID,
            method: "POST",
            url: `/session/${encodeURIComponent(sessionID)}/command`,
            body: JSON.stringify(commandBody),
            headers: {
              "content-type": "application/json",
            },
            signal: c.req.raw.signal,
          })

          if (response) {
            return new Response(response.body, {
              status: response.status,
              headers: toHeadersObject(response.headers),
            })
          }
        }

        const result = await Instance.provide({
          directory: session.directory,
          async fn() {
            return SessionPrompt.command({
              ...commandBody,
              sessionID,
            })
          },
        })

        return c.json(result)
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
        const sessionID = c.req.valid("param").sessionID
        const session = await Session.getAnyProject(sessionID)
        if (session.workspaceID) {
          const response = await proxyWorkspaceRequest({
            workspaceID: session.workspaceID,
            method: "POST",
            url: `/session/${encodeURIComponent(sessionID)}/abort`,
            signal: c.req.raw.signal,
          })

          if (response) {
            if (!response.ok) {
              return new Response(response.body, {
                status: response.status,
                headers: toHeadersObject(response.headers),
              })
            }

            return c.json({ success: true as const })
          }
        }
        SessionPrompt.cancel(sessionID)
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
        const session = await Session.getAnyProject(params.sessionID)
        if (session.workspaceID) {
          const response = await proxyWorkspaceRequest({
            workspaceID: session.workspaceID,
            method: "POST",
            url: `/session/${encodeURIComponent(params.sessionID)}/permissions/${encodeURIComponent(params.permissionID)}`,
            body: JSON.stringify({ response: c.req.valid("json").response }),
            headers: {
              "content-type": "application/json",
            },
            signal: c.req.raw.signal,
          })

          if (response) {
            if (!response.ok) {
              return new Response(response.body, {
                status: response.status,
                headers: toHeadersObject(response.headers),
              })
            }

            return c.json({ success: true as const })
          }
        }
        PermissionNext.reply({ requestID: params.permissionID, reply: c.req.valid("json").response })
        return c.json({ success: true as const })
      },
    )
    .post(
      "/session/:sessionID/publish",
      describeRoute({
        summary: "Publish GitHub session",
        description: "Commit the current worktree, push the session branch, and create or reuse a pull request.",
        operationId: "mobile.github.session.publish",
        responses: {
          200: {
            description: "Published pull request",
            content: { "application/json": { schema: resolver(MobileGithubPublishResult) } },
          },
          ...errors(400, 401, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator("json", MobileGithubPublishInput),
      async (c) => {
        const token = await githubToken()
        if (!token) return c.json({ error: "GitHub token not configured" }, 401)

        const body = c.req.valid("json") ?? {}
        const sessionInfo = await Session.getAnyProject(c.req.valid("param").sessionID)
        if (!sessionInfo.github) return c.json({ error: "Session is not linked to GitHub" }, 400)
        if (sessionInfo.github.worktree.cleanedAt)
          return c.json({ error: "Session worktree has already been cleaned" }, 400)

        return Instance.provide({
          directory: sessionInfo.directory,
          async fn() {
            const session = await Session.get(sessionInfo.id)
            const github = session.github
            if (!github) return c.json({ error: "Session is not linked to GitHub" }, 400)
            if (SessionStatus.get(session.id).type !== "idle") {
              return c.json({ error: "Wait for the session to become idle before publishing" }, 400)
            }

            await MobileGithubRepo.runGit(["fetch", "origin", github.baseBranch, "--prune"], {
              cwd: session.directory,
              token,
            })

            const dirty = await MobileGithubRepo.runGit(["status", "--porcelain"], {
              cwd: session.directory,
              token,
            })

            if (dirty.trim()) {
              await MobileGithubRepo.runGit(["add", "-A"], { cwd: session.directory, token })
              await MobileGithubRepo.runGit(
                ["commit", "-m", body.commitMessage?.trim() || session.title.trim() || `Update ${github.fullName}`],
                {
                  cwd: session.directory,
                  token,
                },
              )
            }

            await MobileGithubRepo.runGit(["push", "--set-upstream", "origin", github.headBranch], {
              cwd: session.directory,
              token,
            })

            const ahead = await MobileGithubRepo.runGit(
              ["rev-list", "--left-right", "--count", `origin/${github.baseBranch}...HEAD`],
              {
                cwd: session.directory,
                token,
              },
            )
            const [, aheadCountText = "0"] = ahead.trim().split(/\s+/)
            const aheadCount = Number.parseInt(aheadCountText, 10) || 0

            const commitSha = await MobileGithubRepo.runGit(["rev-parse", "HEAD"], {
              cwd: session.directory,
              token,
            })

            const existingPullRequest =
              github.pullRequest ||
              (await GithubApi.findPullRequestByHead(
                token,
                github.owner,
                github.repo,
                `${github.owner}:${github.headBranch}`,
              )
                .then((value) =>
                  value
                    ? {
                        number: value.number,
                        url: value.html_url,
                        title: value.title,
                      }
                    : undefined,
                )
                .catch(() => undefined))

            const pullRequest =
              existingPullRequest ||
              (aheadCount > 0
                ? await GithubApi.createPullRequest(
                    token,
                    github.owner,
                    github.repo,
                    body.title?.trim() || session.title.trim() || `${github.fullName} changes`,
                    github.headBranch,
                    github.baseBranch,
                    body.body?.trim() || defaultPullRequestBody(session),
                  ).then((value) => ({
                    number: value.number,
                    url: value.html_url,
                    title: value.title,
                  }))
                : undefined)

            if (!pullRequest) {
              return c.json({ error: "Create changes in the worktree before publishing a pull request" }, 400)
            }

            await Session.update(session.id, (draft) => {
              if (!draft.github) return
              draft.github.pullRequest = pullRequest
              draft.github.lastCommitSha = commitSha.trim()
              draft.github.publishedAt = Date.now()
              draft.github.publishError = undefined
            })

            return c.json({
              commitSha: commitSha.trim(),
              branch: github.headBranch,
              pullRequest,
            })
          },
        })
      },
    )
    .post(
      "/session/:sessionID/cleanup",
      describeRoute({
        summary: "Cleanup GitHub session worktree",
        description: "Remove the isolated worktree created for a GitHub-backed mobile session.",
        operationId: "mobile.github.session.cleanup",
        responses: {
          200: {
            description: "Worktree cleaned",
            content: {
              "application/json": { schema: resolver(z.object({ success: z.literal(true) })) },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const sessionInfo = await Session.getAnyProject(c.req.valid("param").sessionID)
        if (!sessionInfo.github) return c.json({ error: "Session is not linked to GitHub" }, 400)
        if (sessionInfo.github.worktree.cleanedAt) return c.json({ success: true as const })

        const repositoryDirectory = sessionInfo.github.repositoryDirectory || sessionInfo.github.worktree.directory
        const idle = await Instance.provide({
          directory: sessionInfo.directory,
          async fn() {
            return SessionStatus.get(sessionInfo.id).type === "idle"
          },
        })
        if (!idle) {
          return c.json({ error: "Wait for the session to become idle before cleaning up the worktree" }, 400)
        }

        await Instance.provide({
          directory: repositoryDirectory,
          async fn() {
            if (sessionInfo.workspaceID) {
              await Workspace.remove(sessionInfo.workspaceID).catch(() => undefined)
            }
            await Worktree.remove({ directory: sessionInfo.github!.worktree.directory })
          },
        })

        await Instance.provide({
          directory: repositoryDirectory,
          async fn() {
            await Session.update(sessionInfo.id, (draft) => {
              if (!draft.github) return
              draft.github.worktree.cleanedAt = Date.now()
            })
          },
        })

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
    .post(
      "/session/:sessionID/rename",
      describeRoute({
        summary: "Rename a session",
        description: "Update the title of an existing session.",
        operationId: "mobile.session.rename",
        responses: {
          200: {
            description: "Session renamed",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator("json", z.object({ title: z.string().min(1) })),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const { title } = c.req.valid("json")
        const session = await Session.get(sessionID)
        if (!session) return c.json({ error: "not found" }, 404)
        await Session.update(sessionID, (draft) => {
          draft.title = title.trim()
        })
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
