import path from "path"
import z from "zod"
import { Project } from "@/project/project"
import { Pty } from "@/pty"
import { PluginPtyEnvironment } from "@/plugin/pty-environment"
import { Session } from "@/session"
import { SessionRepo } from "@/session/repo"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { MessageV2 } from "@/session/message-v2"
import { Agent } from "@/agent/agent"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { Provider } from "@/provider/provider"
import { Worktree } from "@/worktree"
import { GithubApi } from "@/connectors/api/github"
import { ConnectorAuth } from "@/connectors/auth"
import { Connectors } from "@/connectors"
import { resolveCredential } from "@/connectors/credentials"
import { Global } from "@/global"
import { MobileAuth } from "@/mobile/auth"
import { MobileGithubRepo } from "@/mobile/github-repo"
import { Routine } from "@/mobile/routine"
import { LoopDefinitionSchema, LoopRunSchema } from "@/loop/schema"
import { Storage } from "@/storage/storage"
import { Flag } from "@/flag/flag"
import { Config } from "@/config/config"
import { Command } from "@/command"
import { Workspace } from "@/workspace"
import { getContainerRuntimeInfo } from "@/workspace/adaptors"
import { PromptStashStore } from "@/prompt/stash-store"
import { Artifact } from "@/artifact"
import { Log } from "@/util/log"
import { Effect } from "effect"
import { runPromiseWithLayer, withCurrentInstance, withInstance, withInstanceAsync } from "@/effect"

export const log = Log.create({ service: "mobile-routes" })

export function runPermission<A, E>(effect: Effect.Effect<A, E, PermissionNext.Service>) {
  return runPromiseWithLayer(PermissionNext.defaultLayer, withCurrentInstance(effect))
}

export function runQuestion<A, E>(effect: Effect.Effect<A, E, Question.Service>) {
  return runPromiseWithLayer(Question.defaultLayer, withCurrentInstance(effect))
}

export function runCommand<A, E>(effect: Effect.Effect<A, E, Command.Service>) {
  return runPromiseWithLayer(Command.defaultLayer, withCurrentInstance(effect))
}

export function runPty<A, E>(effect: Effect.Effect<A, E, Pty.Service>) {
  return runPromiseWithLayer(PluginPtyEnvironment.ptyLayer, withCurrentInstance(effect))
}

export function runCommandForSession<A, E>(
  session: Pick<Session.Info, "directory" | "workspaceID">,
  effect: Effect.Effect<A, E, Command.Service>,
) {
  return withInstance(
    { directory: session.directory, workspaceID: session.workspaceID },
    Effect.provide(effect, Command.defaultLayer),
  )
}

export function runStatus<A, E>(effect: Effect.Effect<A, E, SessionStatus.Service>) {
  return runPromiseWithLayer(SessionStatus.defaultLayer, withCurrentInstance(effect))
}

export function runStatusForSession<A, E>(
  session: Pick<Session.Info, "directory" | "workspaceID">,
  effect: Effect.Effect<A, E, SessionStatus.Service>,
) {
  return withInstance(
    { directory: session.directory, workspaceID: session.workspaceID },
    Effect.provide(effect, SessionStatus.defaultLayer),
  )
}

export function runSessionPromptForSession<A, E>(
  session: Pick<Session.Info, "directory" | "workspaceID">,
  effect: Effect.Effect<A, E, SessionPrompt.Service>,
) {
  return withInstance(
    { directory: session.directory, workspaceID: session.workspaceID },
    Effect.provide(effect, SessionPrompt.defaultLayer),
  )
}

export function runSession<A, E>(effect: Effect.Effect<A, E, Session.Service>) {
  return runPromiseWithLayer(Session.defaultLayer, withCurrentInstance(effect))
}

export function runSessionForSession<A, E>(
  session: Pick<Session.Info, "directory" | "workspaceID">,
  effect: Effect.Effect<A, E, Session.Service>,
) {
  return withInstance(
    { directory: session.directory, workspaceID: session.workspaceID },
    Effect.provide(effect, Session.defaultLayer),
  )
}

export function runSummary<A, E>(effect: Effect.Effect<A, E, SessionSummary.Service>) {
  return runPromiseWithLayer(SessionSummary.defaultLayer, withCurrentInstance(effect))
}

export function runAgent<A, E>(effect: Effect.Effect<A, E, Agent.Service>) {
  return runPromiseWithLayer(Agent.defaultLayer, withCurrentInstance(effect))
}

export function runProvider<A, E>(effect: Effect.Effect<A, E, Provider.Service>) {
  return runPromiseWithLayer(Provider.defaultLayer, withCurrentInstance(effect))
}

export function runWorktree<A, E>(effect: Effect.Effect<A, E, Worktree.Service>) {
  return runPromiseWithLayer(Worktree.defaultLayer, withCurrentInstance(effect))
}

export function runWorktreeForDirectory<A, E>(directory: string, effect: Effect.Effect<A, E, Worktree.Service>) {
  return withInstance({ directory }, Effect.provide(effect, Worktree.defaultLayer))
}

export function runConnectorAuth<A, E>(effect: Effect.Effect<A, E, ConnectorAuth.Service>) {
  return runPromiseWithLayer(ConnectorAuth.defaultLayer, effect)
}

export function runProject<A, E>(effect: Effect.Effect<A, E, Project.Service>) {
  return runPromiseWithLayer(Project.defaultLayer, effect)
}

export function runStorage<A, E>(effect: Effect.Effect<A, E, Storage.Service>) {
  return runPromiseWithLayer(Storage.defaultLayer, effect)
}

export function runConfig<A, E>(effect: Effect.Effect<A, E, Config.Service>) {
  return runPromiseWithLayer(Config.defaultLayer, withCurrentInstance(effect))
}

export function runGlobalConfig<A, E>(effect: Effect.Effect<A, E, Config.Service>) {
  return runPromiseWithLayer(Config.defaultLayer, effect)
}

export function configGet() {
  return runConfig(
    Effect.gen(function* () {
      const config = yield* Config.Service
      return yield* config.get()
    }),
  )
}

export function configGetGlobal() {
  return runGlobalConfig(
    Effect.gen(function* () {
      const config = yield* Config.Service
      return yield* config.getGlobal()
    }),
  )
}

export function configUpdateGlobal(info: Config.Info) {
  return runGlobalConfig(
    Effect.gen(function* () {
      const config = yield* Config.Service
      yield* config.updateGlobal(info)
    }),
  )
}

export function storageRead<T>(key: string[]) {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.read<T>(key)
    }),
  )
}

export function storageList(prefix: string[]) {
  return runStorage(
    Effect.gen(function* () {
      const storage = yield* Storage.Service
      return yield* storage.list(prefix)
    }),
  )
}

export const MobileProject = Project.Info.extend({ current: z.boolean() }).meta({ ref: "MobileProject" })
export const MobileExecutionTarget = z.enum(["local", "container"]).meta({ ref: "MobileExecutionTarget" })

export const MobileProjectType = z
  .object({
    detected: z.boolean(),
    platforms: z.array(z.string()).optional(),
    primaryPlatform: z.string().optional(),
    method: z.string().optional(),
    root: z.string().optional(),
  })
  .meta({ ref: "MobileProjectType" })

export const MobileBootstrap = z
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
      tokenAvailable: z.boolean().optional(),
      reconnectRequired: z.boolean().optional(),
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
    expo: z.object({
      available: z.boolean(),
      easAvailable: z.boolean(),
      details: z.array(z.string()),
    }),
    mobileProject: MobileProjectType.optional(),
  })
  .meta({ ref: "MobileBootstrap" })

export const MobileSessionSummary = z
  .object({
    info: Session.Info,
    status: SessionStatus.Info.optional(),
  })
  .meta({ ref: "MobileSessionSummary" })

export const MobileArtifact = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    filename: z.string(),
    contentType: z.string(),
    kind: z.enum(["html", "markdown", "image", "video", "text"]),
    url: z.string(),
    viewerUrl: z.string(),
    previewUrl: z.string(),
    version: z.number(),
    sessionID: z.string(),
    size: z.number(),
    time: z.object({ created: z.number(), updated: z.number() }),
  })
  .meta({ ref: "MobileArtifact" })

export function toMobileArtifact(info: Artifact.Info): z.infer<typeof MobileArtifact> {
  return {
    id: info.id,
    title: info.title,
    description: info.description,
    filename: info.filename,
    contentType: info.contentType,
    kind: info.kind,
    url: info.url,
    viewerUrl: Artifact.viewerUrl(info),
    previewUrl: Artifact.previewUrl(info),
    version: info.version,
    sessionID: info.sessionID,
    size: info.size,
    time: info.time,
  }
}

export const MobileSessionDetail = z
  .object({
    info: Session.Info,
    status: SessionStatus.Info.optional(),
    messages: MessageV2.WithParts.array(),
    artifacts: MobileArtifact.array(),
    permissions: PermissionNext.Request.array(),
    questions: Question.Request.array(),
  })
  .meta({ ref: "MobileSessionDetail" })

export const GithubAuthInput = z.object({ token: z.string().min(1) })
export const GithubOAuthClientInput = z.object({ clientId: z.string().min(1) })

export const MobileGithubBranch = z
  .object({
    name: z.string(),
    protected: z.boolean().optional(),
    commit: z.object({
      sha: z.string(),
    }),
  })
  .meta({ ref: "MobileGithubBranch" })

export const MobileGithubSessionCreateInput = z
  .object({
    owner: MobileGithubRepo.Owner,
    repo: MobileGithubRepo.Repository,
    cloneUrl: z.url(),
    htmlUrl: z.url().optional(),
    defaultBranch: z.string().min(1),
    baseBranch: z.string().min(1),
    private: z.boolean().default(false),
    title: z.string().optional(),
    executionTarget: MobileExecutionTarget.default("local"),
  })
  .superRefine((input, ctx) => {
    if (!MobileGithubRepo.isSafeCloneUrl(input)) {
      ctx.addIssue({
        code: "custom",
        path: ["cloneUrl"],
        message: "cloneUrl must be an HTTPS github.com URL matching owner/repo",
      })
    }
  })
  .meta({ ref: "MobileGithubSessionCreateInput" })

export const MobileSessionCreateInput = z
  .object({
    parentID: Session.Info.shape.parentID,
    title: Session.Info.shape.title.optional(),
    permission: Session.Info.shape.permission,
    github: Session.Info.shape.github.optional(),
    executionTarget: MobileExecutionTarget.default("local"),
  })
  .optional()
  .meta({ ref: "MobileSessionCreateInput" })

export const MobileGithubSessionCreateResult = z
  .object({
    session: Session.Info,
    worktree: Worktree.Info,
    project: Project.Info,
    workspace: Workspace.Info.optional(),
  })
  .meta({ ref: "MobileGithubSessionCreateResult" })

export const MobileCommand = z
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

export const MobileSessionCommandInput = z
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
    variant: z.string().optional(),
  })
  .meta({ ref: "MobileSessionCommandInput" })

export const MobileGithubPublishInput = z
  .object({
    title: z.string().optional(),
    body: z.string().optional(),
    commitMessage: z.string().optional(),
  })
  .optional()
  .meta({ ref: "MobileGithubPublishInput" })

export const MobileGithubPublishResult = z
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

export const MobileGithubDeviceAuthStart = z
  .object({
    deviceCode: z.string(),
    userCode: z.string(),
    verificationUri: z.string(),
    verificationUriComplete: z.string().optional(),
    expiresAt: z.number(),
    interval: z.number(),
  })
  .meta({ ref: "MobileGithubDeviceAuthStart" })

export const MobileGithubDeviceAuthPollInput = z
  .object({
    deviceCode: z.string().min(1),
  })
  .meta({ ref: "MobileGithubDeviceAuthPollInput" })

export const MobileGithubDeviceAuthPollResult = z
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

export const MobilePromptHistoryEntry = z
  .object({
    id: z.string(),
    input: z.string(),
    mode: z.enum(["normal", "shell"]).optional(),
    partsCount: z.number(),
  })
  .meta({ ref: "MobilePromptHistoryEntry" })

export const MobilePromptStashEntry = z
  .object({
    id: z.string(),
    input: z.string(),
    timestamp: z.number(),
    partsCount: z.number(),
  })
  .meta({ ref: "MobilePromptStashEntry" })

export const MobilePromptStashCreateInput = z
  .object({
    input: z.string().trim().min(1),
  })
  .meta({ ref: "MobilePromptStashCreateInput" })

export const MobileMemorySearchHit = z
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

export const MobileRoutine = Routine.Record.meta({ ref: "MobileRoutine" })
export const MobileRoutineCreateInput = Routine.CreateInput.meta({
  ref: "MobileRoutineCreateInput",
})
export const MobileRoutineUpdateInput = Routine.UpdateInput.meta({
  ref: "MobileRoutineUpdateInput",
})
export const MobileRoutineRunInput = z.object({ text: z.string().optional() }).meta({ ref: "MobileRoutineRunInput" })
export const MobileRoutineTriggerInput = z
  .object({ text: z.string().optional() })
  .meta({ ref: "MobileRoutineTriggerInput" })

export const MobileLoopRuntime = z
  .object({
    loopID: z.string(),
    status: z.enum(["idle", "running", "paused", "error", "cancelling"]),
    runs: z.number(),
    lastRunAt: z.number().optional(),
    lastError: z.string().optional(),
    sessionID: z.string().optional(),
  })
  .meta({ ref: "MobileLoopRuntime" })
export const MobileLoop = LoopDefinitionSchema.meta({ ref: "MobileLoop" })
export const MobileLoopRun = LoopRunSchema.meta({ ref: "MobileLoopRun" })
export const MobileLoopWriteInput = LoopDefinitionSchema.omit({
  id: true,
  createdAt: true,
}).meta({
  ref: "MobileLoopWriteInput",
})
export const MobileLoopGenerateInput = z
  .object({
    description: z.string().trim().min(1),
    model: z
      .string()
      .regex(/^[^/]+\/[^/]+$/)
      .optional(),
    agent: z.string().trim().min(1).optional(),
  })
  .meta({ ref: "MobileLoopGenerateInput" })
export const MobileLoopTemplate = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    draft: z.object({
      name: z.string().optional(),
      stages: z.array(
        z.object({
          name: z.string().optional(),
          agent: z.string().optional(),
          model: z.string().optional(),
          objective: z.string(),
          tokenBudget: z.number().optional(),
        }),
      ),
      intervalMs: z.number().optional(),
      maxRuns: z.number().optional(),
    }),
  })
  .meta({ ref: "MobileLoopTemplate" })

export type PromptHistoryRecord = {
  input: string
  mode?: "normal" | "shell"
  parts?: unknown[]
}

export async function readJsonLines<T>(filePath: string) {
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

export function historyFilePath() {
  return path.join(Global.Path.state, "prompt-history.jsonl")
}

export async function listPromptHistory() {
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

export async function listPromptStash() {
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

export function messageSearchText(message: MessageV2.WithParts) {
  const text = message.parts
    .filter((part): part is Extract<MessageV2.WithParts["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim()
  if (text) return text
  if (message.info.role === "assistant") {
    // MessageOutputLengthError carries an empty `data`, so the union has no common
    // `message` key; widen through the optional shape instead of narrowing per arm.
    return (message.info.error?.data as { message?: string } | undefined)?.message?.trim() ?? ""
  }
  return ""
}

export function snippetForQuery(text: string, query: string) {
  const lower = text.toLowerCase()
  const index = lower.indexOf(query)
  if (index === -1) return text.slice(0, 180)
  const start = Math.max(0, index - 48)
  const end = Math.min(text.length, index + query.length + 108)
  const prefix = start > 0 ? "..." : ""
  const suffix = end < text.length ? "..." : ""
  return `${prefix}${text.slice(start, end).trim()}${suffix}`
}

export async function searchPromptMemories(query: string) {
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

  // Sessions live in SQL (repo.ts) since the database migration in 50b55f9a4,
  // so we use SessionRepo.listAll() instead of the obsolete file-based
  // storageList(["session"]) walk.
  const allSessions = SessionRepo.listAll()
  for (const session of allSessions) {
    const messages = await runSessionForSession(
      session,
      Effect.gen(function* () {
        const service = yield* Session.Service
        return yield* service.messages({ sessionID: session.id })
      }),
    ).catch(() => [])
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

export async function latestPromptDefaults(sessionID: string) {
  const messages = await runSession(
    Effect.gen(function* () {
      const service = yield* Session.Service
      return yield* service.messages({ sessionID, limit: 24 })
    }),
  ).catch(() => [])
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

export async function resolveMobilePromptDefaults(session: Session.Info) {
  return withInstanceAsync({ directory: session.directory }, async () => {
    const current = await latestPromptDefaults(session.id)
    if (current.agent && current.model) return current

    // Sibling candidates come from the SQL store (SessionRepo), sorted
    // newest-updated first. We filter to the same project because prompt
    // defaults only make sense within the same context.
    const sessions = SessionRepo.listAll()
      .filter((c) => c.id !== session.id && c.projectID === session.projectID)
      .sort((a, b) => b.time.updated - a.time.updated)

    for (const candidate of sessions) {
      const fallback = await latestPromptDefaults(candidate.id)
      if (!fallback.agent || !fallback.model) continue
      return {
        agent: current.agent ?? fallback.agent,
        model: current.model ?? fallback.model,
      }
    }

    return {
      agent:
        current.agent ??
        (await runAgent(
          Effect.gen(function* () {
            const agent = yield* Agent.Service
            return yield* agent.defaultAgent()
          }),
        )),
      model:
        current.model ??
        (await runProvider(
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            return yield* provider.defaultModel()
          }),
        )),
    }
  })
}

export function extractSessionIDs(value: unknown): string[] {
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

export type GithubConnectorEntry = {
  key: string
  connector: Config.ConnectorGithub
}

export function isGithubConnector(value: unknown): value is Config.ConnectorGithub {
  return typeof value === "object" && value !== null && "type" in value && value.type === "github"
}

export function githubConnectorEntry(config?: Config.Info): GithubConnectorEntry {
  for (const [key, connector] of Object.entries(config?.connectors ?? {})) {
    if (isGithubConnector(connector)) {
      return { key, connector: connector as Config.ConnectorGithub }
    }
  }

  return { key: "github", connector: { type: "github", enabled: true } }
}

export async function ensureGlobalGithubConnector(input?: Partial<Config.ConnectorGithub>) {
  const globalConfig = await configGetGlobal().catch(() => ({}) as Config.Info)
  const currentConfig = await configGet().catch(() => undefined)
  const globalEntry = githubConnectorEntry(globalConfig)
  const currentEntry = githubConnectorEntry(currentConfig)
  const key = globalConfig.connectors?.[globalEntry.key] ? globalEntry.key : currentEntry.key
  const existing = (
    globalConfig.connectors?.[key] && isGithubConnector(globalConfig.connectors[key])
      ? globalConfig.connectors[key]
      : currentEntry.connector
  ) as Config.ConnectorGithub
  const connectors = { ...globalConfig.connectors }

  connectors[key] = {
    ...existing,
    ...input,
    type: "github",
    enabled: input?.enabled ?? existing.enabled ?? true,
  }

  await configUpdateGlobal({ connectors })
  return { key, connector: connectors[key] as Config.ConnectorGithub }
}

export type GithubTokenGrant = {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  refreshTokenExpiresAt?: number
}

export async function storeGithubToken(tokenOrGrant: string | GithubTokenGrant) {
  const grant: GithubTokenGrant = typeof tokenOrGrant === "string" ? { accessToken: tokenOrGrant } : tokenOrGrant
  const { key } = await ensureGlobalGithubConnector({ enabled: true })
  const entryUpdate = {
    token: grant.accessToken,
    expiresAt: grant.expiresAt,
    refreshToken: grant.refreshToken,
    refreshTokenExpiresAt: grant.refreshTokenExpiresAt,
  }
  await runConnectorAuth(
    Effect.gen(function* () {
      const auth = yield* ConnectorAuth.Service
      const existing = yield* auth.get(key)
      yield* auth.set(key, { ...existing, ...entryUpdate })
    }),
  )

  if (key !== "github") {
    await runConnectorAuth(
      Effect.gen(function* () {
        const auth = yield* ConnectorAuth.Service
        const canonical = yield* auth.get("github")
        yield* auth.set("github", { ...canonical, ...entryUpdate })
      }),
    )
  }

  Connectors.invalidateConnector(key)
  Connectors.invalidateConnector("github")
}

async function refreshGithubToken(key: string): Promise<string | null> {
  const entry = await runConnectorAuth(
    Effect.gen(function* () {
      const auth = yield* ConnectorAuth.Service
      return yield* auth.get(key)
    }),
  ).catch(() => undefined)
  if (!entry?.refreshToken) return null
  if (entry.refreshTokenExpiresAt && entry.refreshTokenExpiresAt < Date.now()) return null

  const { clientID } = await githubOAuthClientID()
  if (!clientID) return null

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "nikcli-mobile",
    },
    body: JSON.stringify({
      client_id: clientID,
      refresh_token: entry.refreshToken,
      grant_type: "refresh_token",
    }),
  })
  if (!response.ok) return null
  const payload = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    refresh_token_expires_in?: number
    error?: string
  }
  if (!payload.access_token) return null

  await storeGithubToken({
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? entry.refreshToken,
    expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : undefined,
    refreshTokenExpiresAt: payload.refresh_token_expires_in
      ? Date.now() + payload.refresh_token_expires_in * 1000
      : entry.refreshTokenExpiresAt,
  })
  return payload.access_token
}

export async function githubToken() {
  const config = await configGet().catch(() => undefined)
  const { key, connector } = githubConnectorEntry(config)

  const expired = await runConnectorAuth(
    Effect.gen(function* () {
      const auth = yield* ConnectorAuth.Service
      return yield* auth.isTokenExpired(key)
    }),
  ).catch(() => null)
  if (expired) {
    const refreshed = await refreshGithubToken(key)
    if (refreshed) return refreshed
  }

  const credential = await resolveCredential(key, connector)
  if (credential) return credential

  if (key !== "github") {
    return resolveCredential("github", connector)
  }

  return null
}

export async function githubOAuthClientID() {
  const config = await configGet().catch(() => undefined)
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

export async function startGithubDeviceAuth() {
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

export async function pollGithubDeviceAuth(deviceCode: string) {
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
    refresh_token?: string
    expires_in?: number
    refresh_token_expires_in?: number
    error?: string
    interval?: number
  }
  if (payload.access_token) {
    const user = await GithubApi.getUser(payload.access_token)
    await storeGithubToken({
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : undefined,
      refreshTokenExpiresAt: payload.refresh_token_expires_in
        ? Date.now() + payload.refresh_token_expires_in * 1000
        : undefined,
    })

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

export async function githubUser() {
  const token = (await githubToken()) ?? undefined
  if (!token) return
  return GithubApi.getUser(token).catch(() => undefined)
}

export async function githubImports() {
  const imports = await MobileGithubRepo.list()
  return new Map(imports.map((item) => [item.fullName.toLowerCase(), item] as const))
}

export function slug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}

export function sessionSeed() {
  return Math.random().toString(36).slice(2, 8)
}

/**
 * Parse a git remote URL (HTTPS or SSH form) into a GitHub owner/repo pair.
 * Returns undefined for non-GitHub remotes or unparsable URLs.
 */
export function parseGithubRemoteUrl(remoteUrl: string): { owner: string; repo: string } | undefined {
  const value = remoteUrl.trim()
  if (!value) return undefined

  const ssh = value.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i)
  if (ssh) return { owner: ssh[1], repo: ssh[2] }

  try {
    const url = new URL(value.replace(/^git\+/, ""))
    if (url.hostname.toLowerCase() !== "github.com") return undefined
    const parts = url.pathname.split("/").filter(Boolean)
    if (parts.length < 2) return undefined
    const [owner, rawRepo] = parts
    const repo = rawRepo.endsWith(".git") ? rawRepo.slice(0, -4) : rawRepo
    if (!owner || !repo) return undefined
    return { owner, repo }
  } catch {
    return undefined
  }
}

/**
 * Create an isolated git worktree for a plain (non-import) mobile session so
 * every session gets its own branch instead of sharing the host's checked-out
 * directory. Mirrors the isolation the /github/session import flow already
 * gets, but derived from whatever the host directory already has checked out
 * (no clone step). Falls back to `undefined` (caller keeps using the host
 * directory directly) whenever the directory isn't a git project or the
 * worktree can't be created for any reason -- session creation must never be
 * blocked by this.
 *
 * When the host directory's `origin` remote points at github.com, this also
 * returns ready-to-store `Session.Info["github"]` metadata so the existing
 * publish/PR flow (built for imported repos) works the same way here, without
 * requiring the user to go through the explicit "import repo" flow first.
 */
export async function createSessionWorktreeContext(hostDirectory: string): Promise<
  | {
      directory: string
      /** Set for every isolated session; mirrors `github.worktree` when github is set. */
      worktree: Session.Info["worktree"]
      github?: Session.Info["github"]
    }
  | undefined
> {
  let worktree: Worktree.Info
  try {
    worktree = await runWorktreeForDirectory(
      hostDirectory,
      Effect.gen(function* () {
        const service = yield* Worktree.Service
        return yield* service.create({ branchPrefix: "nikcli/session" })
      }),
    )
  } catch (error) {
    if (!(error instanceof Worktree.NotGitError)) {
      log.warn("failed to create session worktree, falling back to host directory", {
        directory: hostDirectory,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return undefined
  }

  if (!worktree.branch) return { directory: worktree.directory, worktree: undefined }

  const worktreeMeta = {
    name: worktree.name,
    branch: worktree.branch,
    directory: worktree.directory,
    repositoryDirectory: hostDirectory,
  }

  const remoteUrl = await MobileGithubRepo.runGit(["remote", "get-url", "origin"], { cwd: hostDirectory }).catch(
    () => "",
  )
  const parsed = parseGithubRemoteUrl(remoteUrl)
  if (!parsed) return { directory: worktree.directory, worktree: worktreeMeta }

  const baseBranch = await MobileGithubRepo.runGit(["branch", "--show-current"], { cwd: hostDirectory }).catch(() => "")

  return {
    directory: worktree.directory,
    // Nested under `github` (which doubles as PR/publish metadata) instead
    // of duplicated at the top level too.
    worktree: undefined,
    github: {
      owner: parsed.owner,
      repo: parsed.repo,
      fullName: `${parsed.owner}/${parsed.repo}`,
      baseBranch: baseBranch.trim() || "main",
      headBranch: worktree.branch,
      repositoryDirectory: hostDirectory,
      worktree: worktreeMeta,
    },
  }
}

export function defaultPullRequestBody(session: Session.Info) {
  return [
    `Generated from mobile session \`${session.id}\`.`,
    session.share?.url ? `Session share: ${session.share.url}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
}

export function toHeadersObject(headers: Headers) {
  return Object.fromEntries(headers.entries())
}

export async function createExecutionWorkspace(input: {
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
  const project = await runProject(
    Effect.gen(function* () {
      const project = yield* Project.Service
      return yield* project.fromDirectory(input.directory)
    }),
  )
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

export async function statusForSession(session: Session.Info) {
  return runStatusForSession(
    session,
    Effect.gen(function* () {
      const status = yield* SessionStatus.Service
      return yield* status.get(session.id)
    }),
  )
}
