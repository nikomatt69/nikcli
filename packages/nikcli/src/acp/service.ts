import path from "node:path"
import { Log } from "@nikcli-ai/util/log"
import { AuthMethodID } from "./types"
import { applyPatch } from "diff"
import { buildConfigOptions, formatCurrentModelId, parseModelSelection, DEFAULT_VARIANT_VALUE } from "./config-option"
import { loadSnapshot, variants, type Snapshot } from "./directory"
import { promptContentToParts, type PromptPart } from "./content"
import { Store, type Info as SessionInfo } from "./session"
import {
  AuthRequiredError,
  InvalidConfigOptionError,
  InvalidEffortError,
  InvalidModeError,
  InvalidModelError,
  SessionNotFoundError,
  UnsupportedOperationError,
  fromUnknownDefect,
  isACPError,
  serviceFailure,
} from "./error"
import { toLocations, toToolKind } from "./tool"
import { sendUsageUpdate, type ContextLimitLoader } from "./usage"
import { Subscription } from "./event"
import { Provider } from "@/provider/provider"
import { Agent as AgentModule } from "@/agent/agent"
import { Command } from "@/command"
import type { NikcliClient, SessionMessageResponse } from "@nikcli-ai/sdk/httpapi"
import type {
  AgentSideConnection,
  AuthMethod,
  AuthenticateRequest,
  AuthenticateResponse,
  CancelNotification,
  CloseSessionRequest,
  CloseSessionResponse,
  ForkSessionRequest,
  ForkSessionResponse,
  InitializeRequest,
  InitializeResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  McpServer,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SessionConfigOption,
  SessionId,
  SessionInfo as ACPSessionInfo,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
  SetSessionModelRequest,
  SetSessionModelResponse,
  StopReason,
} from "@agentclientprotocol/sdk"

/**
 * ACP service layer.
 *
 * Mirrors opencode's `service.ts`: each ACP method maps to a single
 * async function that handles the full request lifecycle. Errors thrown
 * from this layer are translated to `RequestError` at the agent boundary
 * so the JSON-RPC envelope stays consistent.
 *
 * The service holds:
 * - the live `Store` of ACP sessions;
 * - the per-connection `Subscription` that streams events into
 *   `session/update` notifications;
 * - the per-connection `PermissionHandler` that drives
 *   `requestPermission` / `writeTextFile`;
 * - a `contextLimitLoader` that resolves model context windows for the
 *   `usage_update` notification.
 */
const log = Log.create({ service: "acp-service" })

/**
 * Connection subset the service actually exercises. Marked partial so
 * tests can construct one with only the methods they exercise.
 */
type ServiceConnection = Pick<AgentSideConnection, "sessionUpdate"> &
  Partial<Pick<AgentSideConnection, "requestPermission" | "writeTextFile">>

export interface ACPServiceOptions {
  readonly sdk: NikcliClient
  readonly connection?: ServiceConnection
  readonly directory?: string
  readonly contextLimit?: ContextLimitLoader
}

export interface ACPAgentInterface {
  readonly initialize: (params: InitializeRequest) => Promise<InitializeResponse>
  readonly authenticate: (params: AuthenticateRequest) => Promise<AuthenticateResponse>
  readonly newSession: (params: NewSessionRequest) => Promise<NewSessionResponse>
  readonly loadSession: (params: LoadSessionRequest) => Promise<LoadSessionResponse>
  readonly listSessions: (params: ListSessionsRequest) => Promise<ListSessionsResponse>
  readonly resumeSession: (params: ResumeSessionRequest) => Promise<ResumeSessionResponse>
  readonly closeSession: (params: CloseSessionRequest) => Promise<CloseSessionResponse>
  readonly forkSession: (params: ForkSessionRequest) => Promise<ForkSessionResponse>
  readonly setSessionConfigOption: (params: SetSessionConfigOptionRequest) => Promise<SetSessionConfigOptionResponse>
  readonly setSessionMode: (params: SetSessionModeRequest) => Promise<SetSessionModeResponse>
  readonly unstable_setSessionModel: (params: SetSessionModelRequest) => Promise<SetSessionModelResponse>
  readonly prompt: (params: PromptRequest) => Promise<PromptResponse>
  readonly cancel: (params: CancelNotification) => Promise<void>
}

export function make(options: ACPServiceOptions): ACPAgentInterface {
  const sdk = options.sdk
  const connection = options.connection

  const sessions = new Store()
  const sessionSnapshots = new Map<SessionId, Snapshot>()
  const events = connection ? new Subscription({ sdk, connection, sessionCwd: cwdFor }) : undefined

  if (events) events.start()

  const contextLimit: ContextLimitLoader = options.contextLimit ?? (async (input) => resolveContextLimit(sdk, input))

  // ───────────────────────── initialize ─────────────────────────

  async function initialize(params: InitializeRequest): Promise<InitializeResponse> {
    const authMethod = {
      description: "Run `nikcli auth login` in the terminal",
      name: "Login with nikcli",
      id: AuthMethodID,
    } as AuthMethod
    if (params.clientCapabilities?._meta?.["terminal-auth"] === true) {
      authMethod._meta = {
        "terminal-auth": {
          command: "nikcli",
          args: ["auth", "login"],
          label: "Nikcli Login",
        },
      }
    }

    return {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        mcpCapabilities: {
          http: true,
          sse: true,
        },
        promptCapabilities: {
          embeddedContext: true,
          image: true,
        },
        sessionCapabilities: {
          close: {},
          fork: {},
          list: {},
          resume: {},
        },
      },
      authMethods: [authMethod],
      agentInfo: {
        name: "Nikcli",
        version: "1.76.0",
      },
    }
  }

  // ───────────────────────── authenticate ─────────────────────────

  async function authenticate(params: AuthenticateRequest): Promise<AuthenticateResponse> {
    if (params.methodId !== AuthMethodID) {
      throw new InvalidConfigOptionError(params.methodId)
    }
    return {}
  }

  // ───────────────────────── newSession ─────────────────────────

  async function newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const snapshot = await loadDirectorySnapshot(params.cwd)
    const selected = selectDefaultModel(snapshot)
    const variant = selectVariant(snapshot, selected)
    const modeId = snapshot.availableModes.length > 0 ? snapshot.defaultModeID : undefined

    const created = await sdk.session.create({ directory: params.cwd }, { throwOnError: true }).then((x) => x.data!)

    const sessionId: SessionId = created.id
    sessions.create({
      id: sessionId,
      cwd: params.cwd,
      mcpServers: params.mcpServers,
      model: selected,
      variant,
      modeId,
    })
    sessionSnapshots.set(sessionId, snapshot)

    await registerMcpServers(params.cwd, sessionId, params.mcpServers)
    sendAvailableCommands(sessionId, snapshot)

    return {
      sessionId,
      configOptions: buildConfigOptions({
        providers: Object.values(snapshot.providers),
        currentModel: selected,
        currentVariant: variant,
        includeModelVariants: true,
        modes: snapshot.availableModes,
        currentModeId: modeId,
      }),
      _meta: {},
    }
  }

  // ───────────────────────── loadSession ─────────────────────────

  async function loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    const snapshot = await loadDirectorySnapshot(params.cwd)
    await sdk.session.get({ sessionID: params.sessionId, directory: params.cwd }, { throwOnError: true })
    const messages = await sdk.session
      .messages({ sessionID: params.sessionId, directory: params.cwd }, { throwOnError: true })
      .then((x) => (x.data ?? []) as SessionMessageResponse[])

    const restored = restoreFromMessages(messages)
    const model = restored.model ?? selectDefaultModel(snapshot)
    const variant = restored.variant ?? selectVariant(snapshot, model)
    const modeId = restored.modeId ?? (snapshot.availableModes.length > 0 ? snapshot.defaultModeID : undefined)

    const state = sessions.load({
      id: params.sessionId,
      cwd: params.cwd,
      mcpServers: params.mcpServers,
      model,
      variant,
      modeId,
    })
    sessionSnapshots.set(state.id, snapshot)

    await registerMcpServers(params.cwd, state.id, params.mcpServers)
    sendAvailableCommands(state.id, snapshot)
    await replayMessages(events, messages, state.cwd)

    return {
      configOptions: buildConfigOptions({
        providers: Object.values(snapshot.providers),
        currentModel: state.model ?? model,
        currentVariant: state.variant ?? variant,
        includeModelVariants: true,
        modes: snapshot.availableModes,
        currentModeId: state.modeId,
      }),
      _meta: {},
    }
  }

  // ───────────────────────── listSessions ─────────────────────────

  async function listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    const cursor = params.cursor ? Number(params.cursor) : undefined
    const limit = 100

    const listInput = {
      roots: true,
      ...(params.cwd ? { directory: params.cwd } : undefined),
    }
    const serverEntries = (await sdk.session.list(listInput, { throwOnError: true }).then((x) => x.data ?? [])).map(
      (entry) => serverSessionToInfo(entry),
    )

    const liveEntries = sessions
      .list()
      .filter((session) => !serverEntries.some((entry) => entry.sessionId === session.id))
      .filter((session) => !params.cwd || session.cwd === params.cwd)
      .map(storeSessionToInfo)

    const sorted = [...liveEntries, ...serverEntries].toSorted(
      (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime(),
    )

    const filtered =
      cursor === undefined || !Number.isFinite(cursor)
        ? sorted
        : sorted.filter((item) => new Date(item.updatedAt ?? 0).getTime() < cursor)

    const page = filtered.slice(0, limit)
    const last = page.at(-1)

    const response: ListSessionsResponse = {
      sessions: page,
      _meta: {},
    }
    if (filtered.length > limit && last) {
      response.nextCursor = String(new Date(last.updatedAt ?? 0).getTime())
    }
    return response
  }

  // ───────────────────────── resumeSession ─────────────────────────

  async function resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    const snapshot = await loadDirectorySnapshot(params.cwd)
    await sdk.session.get({ sessionID: params.sessionId, directory: params.cwd }, { throwOnError: true })
    const messages = await sdk.session
      .messages({ sessionID: params.sessionId, directory: params.cwd, limit: 20 }, { throwOnError: true })
      .then((x) => (x.data ?? []) as SessionMessageResponse[])

    const restored = restoreFromMessages(messages)
    const model = restored.model ?? selectDefaultModel(snapshot)
    const variant = restored.variant ?? selectVariant(snapshot, model)
    const modeId = restored.modeId ?? (snapshot.availableModes.length > 0 ? snapshot.defaultModeID : undefined)

    const state = sessions.load({
      id: params.sessionId,
      cwd: params.cwd,
      mcpServers: params.mcpServers ?? [],
      model,
      variant,
      modeId,
    })
    sessionSnapshots.set(state.id, snapshot)

    await registerMcpServers(params.cwd, state.id, params.mcpServers ?? [])
    sendAvailableCommands(state.id, snapshot)
    await replayMessages(events, messages, state.cwd)

    return {
      configOptions: buildConfigOptions({
        providers: Object.values(snapshot.providers),
        currentModel: state.model ?? model,
        currentVariant: state.variant ?? variant,
        includeModelVariants: true,
        modes: snapshot.availableModes,
        currentModeId: state.modeId,
      }),
      _meta: {},
    }
  }

  // ───────────────────────── closeSession ─────────────────────────

  async function closeSession(params: CloseSessionRequest): Promise<CloseSessionResponse> {
    const removed = sessions.remove(params.sessionId)
    sessionSnapshots.delete(params.sessionId)
    if (!removed) return { _meta: {} }

    // Best-effort abort: if the SDK call fails, we still report the
    // session as closed (the entry is gone from our store).
    try {
      await sdk.session.abort({ sessionID: removed.id, directory: removed.cwd }, { throwOnError: true })
    } catch (error) {
      log.error("failed to abort backing session", {
        error,
        sessionID: removed.id,
      })
    }

    return { _meta: {} }
  }

  // ───────────────────────── cancel ─────────────────────────

  async function cancel(params: CancelNotification): Promise<void> {
    const session = sessions.tryGet(params.sessionId)
    if (!session) return
    try {
      await sdk.session.abort({ sessionID: session.id, directory: session.cwd }, { throwOnError: true })
    } catch (error) {
      log.error("failed to abort session", { error, sessionID: session.id })
    }
  }

  // ───────────────────────── forkSession ─────────────────────────

  async function forkSession(params: ForkSessionRequest): Promise<ForkSessionResponse> {
    const snapshot = await loadDirectorySnapshot(params.cwd)
    const forked = await sdk.session.fork(
      {
        directory: params.cwd,
        sessionID: params.sessionId,
      },
      { throwOnError: true },
    )

    const newId = forked.data!.id
    const messages = await sdk.session
      .messages({ directory: params.cwd, sessionID: newId, limit: 20 }, { throwOnError: true })
      .then((x) => (x.data ?? []) as SessionMessageResponse[])

    const restored = restoreFromMessages(messages)
    const model = restored.model ?? selectDefaultModel(snapshot)
    const variant = restored.variant ?? selectVariant(snapshot, model)
    const modeId = restored.modeId ?? (snapshot.availableModes.length > 0 ? snapshot.defaultModeID : undefined)

    const state = sessions.load({
      id: newId,
      cwd: params.cwd,
      mcpServers: params.mcpServers ?? [],
      model,
      variant,
      modeId,
    })
    sessionSnapshots.set(state.id, snapshot)

    await registerMcpServers(params.cwd, state.id, params.mcpServers ?? [])
    sendAvailableCommands(state.id, snapshot)
    await replayMessages(events, messages, state.cwd)

    return {
      sessionId: state.id,
      configOptions: buildConfigOptions({
        providers: Object.values(snapshot.providers),
        currentModel: state.model ?? model,
        currentVariant: state.variant ?? variant,
        includeModelVariants: true,
        modes: snapshot.availableModes,
        currentModeId: state.modeId,
      }),
      _meta: {},
    }
  }

  // ───────────────────────── setSessionConfigOption ─────────────────────────

  async function setSessionConfigOption(
    params: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse> {
    const current = sessions.get(params.sessionId)
    const snapshot = snapshotFor(current.id, current.cwd)
    if (typeof params.value !== "string") {
      throw new InvalidConfigOptionError(params.configId)
    }

    if (params.configId === "model") {
      const selected = parseSelectedModel(snapshot, params.value)
      const variant = selected.variant ?? selectVariant(snapshot, selected.model)
      sessions.setVariant(params.sessionId, variants(snapshot, selected.model) ? variant : undefined)
      sessions.setModel(params.sessionId, selected.model)
      return configOptionsResponse(params.sessionId, snapshot)
    }

    if (params.configId === "effort") {
      const model = current.model ?? selectDefaultModel(snapshot)
      const variantsForModel = variants(snapshot, model)
      if (!variantsForModel || !Object.keys(variantsForModel).includes(params.value)) {
        throw new InvalidEffortError(params.value)
      }
      sessions.setVariant(params.sessionId, params.value)
      return configOptionsResponse(params.sessionId, snapshot)
    }

    if (params.configId === "mode") {
      if (!snapshot.availableModes.some((mode) => mode.id === params.value)) {
        throw new InvalidModeError(params.value)
      }
      sessions.setMode(params.sessionId, params.value)
      return configOptionsResponse(params.sessionId, snapshot)
    }

    throw new InvalidConfigOptionError(params.configId)
  }

  // ───────────────────────── setSessionMode ─────────────────────────

  async function setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    const current = sessions.get(params.sessionId)
    const snapshot = snapshotFor(current.id, current.cwd)
    if (!snapshot.availableModes.some((mode) => mode.id === params.modeId)) {
      throw new InvalidModeError(params.modeId)
    }
    sessions.setMode(params.sessionId, params.modeId)
    return { _meta: {} }
  }

  // ───────────────────────── unstable_setSessionModel ─────────────────────────

  async function unstable_setSessionModel(params: SetSessionModelRequest): Promise<SetSessionModelResponse> {
    const current = sessions.get(params.sessionId)
    const snapshot = snapshotFor(current.id, current.cwd)
    const selected = parseSelectedModel(snapshot, params.modelId)
    sessions.setVariant(
      params.sessionId,
      variants(snapshot, selected.model) ? (selected.variant ?? selectVariant(snapshot, selected.model)) : undefined,
    )
    sessions.setModel(params.sessionId, selected.model)
    return { _meta: {} }
  }

  // ───────────────────────── prompt ─────────────────────────

  async function prompt(params: PromptRequest): Promise<PromptResponse> {
    const current = sessions.get(params.sessionId)
    const snapshot = snapshotFor(current.id, current.cwd)
    const selected = current.model ?? selectDefaultModel(snapshot)
    if (!current.model) sessions.setModel(current.id, selected)
    const variant = current.variant ?? selectVariant(snapshot, selected)
    const modeId = current.modeId ?? (snapshot.availableModes.length > 0 ? snapshot.defaultModeID : undefined)

    const parts = promptContentToParts(params.prompt)
    const command = detectSlashCommand(parts)

    if (!command) {
      await sdk.session.prompt(
        {
          sessionID: current.id,
          model: { providerID: selected.providerID, modelID: selected.modelID },
          variant,
          parts: parts as Parameters<typeof sdk.session.prompt>[0]["parts"],
          agent: modeId,
          directory: current.cwd,
        },
        { throwOnError: true },
      )
      await sendUsageUpdate({
        connection,
        sdk,
        sessionID: current.id,
        directory: current.cwd,
        contextLimit,
      }).catch((error) => {
        log.error("usage update failed", { error })
      })
      return promptResponse(params.messageId)
    }

    const known = snapshot.availableCommands.find((item) => item.name === command.name)
    if (known) {
      await sdk.session.command(
        {
          sessionID: current.id,
          command: known.name,
          arguments: command.args,
          model: `${selected.providerID}/${selected.modelID}`,
          variant,
          agent: modeId,
          directory: current.cwd,
        },
        { throwOnError: true },
      )
      await sendUsageUpdate({
        connection,
        sdk,
        sessionID: current.id,
        directory: current.cwd,
        contextLimit,
      }).catch(() => {})
      return promptResponse(params.messageId)
    }

    if (command.name === "compact") {
      await sdk.session.summarize(
        {
          sessionID: current.id,
          directory: current.cwd,
          providerID: selected.providerID,
          modelID: selected.modelID,
        },
        { throwOnError: true },
      )
      await sendUsageUpdate({
        connection,
        sdk,
        sessionID: current.id,
        directory: current.cwd,
        contextLimit,
      }).catch(() => {})
    }

    return promptResponse(params.messageId)
  }

  // ───────────────────────── helpers ─────────────────────────

  function cwdFor(sessionId: string): string | undefined {
    return sessions.tryGet(sessionId)?.cwd
  }

  function snapshotFor(sessionId: SessionId, cwd: string): Snapshot {
    const cached = sessionSnapshots.get(sessionId)
    if (cached && cached.directory === cwd) return cached
    throw new SessionNotFoundError(sessionId)
  }

  async function loadDirectorySnapshot(directory: string): Promise<Snapshot> {
    return loadSnapshot(directory)
  }

  async function registerMcpServers(directory: string, sessionId: SessionId, servers: McpServer[]): Promise<void> {
    for (const server of servers) {
      try {
        if ("type" in server) {
          await sdk.mcp.add(
            {
              directory,
              name: server.name,
              config: {
                type: "remote",
                url: server.url,
                headers: Object.fromEntries(server.headers.map((header) => [header.name, header.value])),
              },
            },
            { throwOnError: true },
          )
        } else {
          await sdk.mcp.add(
            {
              directory,
              name: server.name,
              config: {
                type: "local",
                command: [server.command, ...server.args],
                environment: Object.fromEntries(server.env.map((entry) => [entry.name, entry.value])),
              },
            },
            { throwOnError: true },
          )
        }
      } catch (error) {
        log.error("failed to register MCP server", {
          name: server.name,
          error,
        })
      }
    }
  }

  function sendAvailableCommands(sessionId: SessionId, snapshot: Snapshot): void {
    if (!connection) return
    const commands = snapshot.availableCommands.map((command) => ({
      name: command.name,
      description: command.description ?? "",
    }))
    if (!commands.some((c) => c.name === "compact")) {
      commands.push({ name: "compact", description: "compact the session" })
    }
    setTimeout(() => {
      void connection
        .sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "available_commands_update",
            availableCommands: commands,
          },
        })
        .catch((error) => {
          log.error("failed to send available commands update", { error })
        })
    }, 0)
  }

  function configOptionsResponse(sessionId: SessionId, snapshot: Snapshot): SetSessionConfigOptionResponse {
    const current = sessions.get(sessionId)
    const options: SessionConfigOption[] = buildConfigOptions({
      providers: Object.values(snapshot.providers),
      currentModel: current.model ?? selectDefaultModel(snapshot),
      currentVariant: current.variant,
      includeModelVariants: true,
      modes: snapshot.availableModes,
      currentModeId: current.modeId,
    })
    return { configOptions: options, _meta: {} }
  }

  return {
    initialize,
    authenticate,
    newSession,
    loadSession,
    listSessions,
    resumeSession,
    closeSession,
    forkSession,
    setSessionConfigOption,
    setSessionMode,
    unstable_setSessionModel,
    prompt,
    cancel,
  }
}

// ───────────────────────── shared helpers ─────────────────────────

function selectDefaultModel(snapshot: Snapshot): {
  providerID: string
  modelID: string
} {
  if (snapshot.defaultModel) return snapshot.defaultModel
  const model = snapshot.modelOptions[0]
  if (model) return { providerID: model.providerID, modelID: model.modelID }
  return { providerID: "nikcli", modelID: "big-pickle" }
}

function selectVariant(snapshot: Snapshot, model: { providerID: string; modelID: string }): string | undefined {
  const vars = variants(snapshot, model)
  if (!vars) return undefined
  if (vars.default) return DEFAULT_VARIANT_VALUE
  return Object.keys(vars)[0]
}

function detectSlashCommand(parts: PromptPart[]): { name: string; args: string } | undefined {
  const text = parts
    .filter((p): p is Extract<PromptPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim()
  if (!text.startsWith("/")) return undefined
  const [name, ...rest] = text.slice(1).split(/\s+/)
  if (!name) return undefined
  return { name, args: rest.join(" ").trim() }
}

function promptResponse(messageId: string | null | undefined): PromptResponse {
  return {
    stopReason: "end_turn" satisfies StopReason,
    ...(messageId ? { _meta: { userMessageId: messageId } } : { _meta: {} }),
  }
}

async function replayMessages(
  subscription: Subscription | undefined,
  messages: SessionMessageResponse[],
  _cwd: string,
): Promise<void> {
  if (!subscription) return
  for (const message of messages) {
    try {
      await subscription.replayMessage(message)
    } catch (error) {
      log.error("failed to replay message", {
        error,
        sessionID: message.info.sessionID,
      })
    }
  }
}

function serverSessionToInfo(entry: {
  id: string
  directory: string
  title?: string | null
  time?: { updated?: number; created?: number }
}): ACPSessionInfo {
  const updatedAt = entry.time?.updated ?? entry.time?.created
  const info: ACPSessionInfo = {
    sessionId: entry.id,
    cwd: entry.directory,
  }
  if (entry.title) info.title = entry.title
  if (updatedAt) info.updatedAt = new Date(updatedAt).toISOString()
  return info
}

function storeSessionToInfo(session: SessionInfo): ACPSessionInfo {
  return {
    sessionId: session.id,
    cwd: session.cwd,
    updatedAt: session.createdAt.toISOString(),
  }
}

type ModelInfo = {
  readonly providerID: string
  readonly modelID: string
  readonly variant?: string
}

function restoreFromMessages(messages: ReadonlyArray<SessionMessageResponse>): {
  model?: ModelInfo
  variant?: string
  modeId?: string
} {
  for (let i = messages.length - 1; i >= 0; i--) {
    const info = messages[i]?.info
    if (!info) continue
    if (info.role === "user") {
      const model = (
        info as {
          model?: { providerID: string; modelID: string; variant?: string }
        }
      ).model
      if (model?.providerID && model.modelID) {
        return {
          model: { providerID: model.providerID, modelID: model.modelID },
          variant: model.variant,
          modeId: (info as { agent?: string }).agent,
        }
      }
    }
    if (info.role === "assistant") {
      const providerID = (info as { providerID?: string }).providerID
      const modelID = (info as { modelID?: string }).modelID
      if (providerID && modelID) {
        const variant = (info as { variant?: string }).variant
        const mode = (info as { mode?: string }).mode
        const agent = (info as { agent?: string }).agent
        return {
          model: { providerID, modelID },
          variant,
          modeId: mode ?? agent,
        }
      }
    }
  }
  return {}
}

function parseSelectedModel(snapshot: Snapshot, modelId: string): { model: ModelInfo; variant?: string } {
  const selection = parseModelSelection(
    modelId,
    Object.values(snapshot.providers).map((provider) => ({
      id: provider.id,
      name: provider.name,
      models: Object.fromEntries(
        Object.entries(provider.models).map(([modelKey, model]) => [
          modelKey,
          {
            id: model.id,
            name: model.name,
            variants: model.variants as Record<string, Record<string, unknown>> | undefined,
          },
        ]),
      ),
    })),
  )
  const provider = snapshot.providers[selection.model.providerID]
  const model = provider?.models[selection.model.modelID]
  if (!model) {
    throw new InvalidModelError(modelId, selection.model.providerID)
  }
  if (selection.variant && !model.variants?.[selection.variant]) {
    throw new InvalidEffortError(selection.variant)
  }
  return { model: selection.model, variant: selection.variant }
}

async function resolveContextLimit(
  sdk: NikcliClient,
  input: { directory: string; providerID: string; modelID: string },
): Promise<number | undefined> {
  try {
    const response = await sdk.config.providers({ directory: input.directory }, { throwOnError: true })
    const providers = (response.data?.providers ?? []) as Array<{
      id: string
      models: Record<string, { limit?: { context?: number } }>
    }>
    const provider = providers.find((p) => p.id === input.providerID)
    return provider?.models[input.modelID]?.limit?.context
  } catch {
    return undefined
  }
}

// Avoid unused-import warnings for things we keep around for the
// permission / content conversion paths.
void toToolKind
void toLocations
void Provider
void AgentModule
void Command
void path
void applyPatch
void formatCurrentModelId
void fromUnknownDefect
void isACPError
void serviceFailure
void AuthRequiredError
void InvalidModelError
void UnsupportedOperationError

export * as ACPService from "./service"
