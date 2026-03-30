import {
  createNikcliClient,
  type Event as NikcliEvent,
  type FileDiff,
  type MobileAuthTokenPublic,
  type MobileBootstrap,
  type MobileCommand,
  type MobileExecutionTarget,
  type MobileGithubBranch,
  type MobileGithubDeviceAuthPollResult,
  type MobileGithubDeviceAuthStart,
  type MobileGithubImportRequest,
  type MobileGithubPublishInput,
  type MobileGithubPublishResult,
  type MobileGithubSessionCreateInput,
  type MobileGithubSessionCreateResult,
  type MobileProject,
  type MobileSessionCreateInput,
  type MobileSessionDetail,
  type MobileSessionSummary,
  type ProviderListResponse,
  type Session,
  type Worktree,
} from "@nikcli-ai/sdk/v2/client"

export type AppServerConfig = {
  url: string
  token?: string
  directory?: string
  modelProviderID?: string
  modelID?: string
  executionTarget?: MobileExecutionTarget
}

export type ProviderCatalog = ProviderListResponse

export const SERVER_CONFIG_STORAGE_KEY = "nikcli_server_config"
export const SERVER_TOKEN_STORAGE_KEY = "nikcli_server_token"

export function normalizeServerUrl(input: string) {
  const url = new URL(input.trim())
  return url.toString().replace(/\/$/, "")
}

export function parsePairingLink(input: string): Partial<AppServerConfig> | null {
  try {
    const parsed = new URL(input.trim())
    if (parsed.protocol !== "nikcli:") return null
    const isLegacyConnect = parsed.hostname === "connect"
    const isRootConnect = !parsed.hostname && (parsed.pathname === "/" || parsed.pathname === "")
    if (!isLegacyConnect && !isRootConnect) return null

    const server = parsed.searchParams.get("server")
    if (!server) return null

    return {
      url: server,
      token: parsed.searchParams.get("token") || undefined,
      directory: parsed.searchParams.get("directory") || undefined,
    }
  } catch {
    return null
  }
}

export function loadServerConfig(): AppServerConfig | null {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(SERVER_CONFIG_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as AppServerConfig
    const tokenFromSession = window.sessionStorage.getItem(SERVER_TOKEN_STORAGE_KEY) || undefined
    const token = tokenFromSession || (typeof parsed.token === "string" ? parsed.token : undefined)

    if (token && !tokenFromSession) {
      window.sessionStorage.setItem(SERVER_TOKEN_STORAGE_KEY, token)
    }

    return {
      ...parsed,
      token,
    }
  } catch {
    return null
  }
}

export function saveServerConfig(config: AppServerConfig) {
  if (typeof window === "undefined") return
  const { token, ...rest } = config
  window.localStorage.setItem(SERVER_CONFIG_STORAGE_KEY, JSON.stringify(rest))
  if (token) window.sessionStorage.setItem(SERVER_TOKEN_STORAGE_KEY, token)
  else window.sessionStorage.removeItem(SERVER_TOKEN_STORAGE_KEY)
}

export function clearServerConfig() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(SERVER_CONFIG_STORAGE_KEY)
  window.sessionStorage.removeItem(SERVER_TOKEN_STORAGE_KEY)
}

export function getErrorMessage(error: unknown) {
  if (typeof error === "string") return error

  if (error && typeof error === "object") {
    const maybeMessage = Reflect.get(error, "message")
    if (typeof maybeMessage === "string" && maybeMessage.trim()) return maybeMessage

    const maybeError = Reflect.get(error, "error")
    if (typeof maybeError === "string" && maybeError.trim()) return maybeError

    if (maybeError && typeof maybeError === "object") {
      const nestedMessage = Reflect.get(maybeError, "message")
      if (typeof nestedMessage === "string" && nestedMessage.trim()) return nestedMessage
      const nestedData = Reflect.get(maybeError, "data")
      if (nestedData && typeof nestedData === "object") {
        const nestedDataMessage = Reflect.get(nestedData, "message")
        if (typeof nestedDataMessage === "string" && nestedDataMessage.trim()) return nestedDataMessage
      }
    }

    const maybeData = Reflect.get(error, "data")
    if (maybeData && typeof maybeData === "object") {
      const nestedMessage = Reflect.get(maybeData, "message")
      if (typeof nestedMessage === "string" && nestedMessage.trim()) return nestedMessage
    }
  }

  return "Request failed"
}

export function formatRelativeTime(value: number) {
  const diffMs = Date.now() - value
  const diffSeconds = Math.max(1, Math.round(diffMs / 1000))

  if (diffSeconds < 60) return `${diffSeconds}s ago`

  const diffMinutes = Math.round(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m ago`

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.round(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`

  const diffWeeks = Math.round(diffDays / 7)
  if (diffWeeks < 5) return `${diffWeeks}w ago`

  const diffMonths = Math.round(diffDays / 30)
  if (diffMonths < 12) return `${diffMonths}mo ago`

  const diffYears = Math.round(diffDays / 365)
  return `${diffYears}y ago`
}

export function sessionLocation(session: Pick<Session, "directory" | "github">) {
  const github = session.github
  if (github) {
    const repo = github.fullName || github.repo || "Unknown repo"
    const branch = github.headBranch || github.baseBranch || "unknown-branch"
    return `${repo} -> ${branch}`
  }
  return session.directory || "Unknown workspace"
}

function authorizationHeaders(config: AppServerConfig) {
  return config.token ? { Authorization: `Bearer ${config.token}` } : undefined
}

async function unwrap<T>(value: Promise<unknown>): Promise<T> {
  const resolved = await value
  if (resolved && typeof resolved === "object" && "data" in resolved) {
    return (resolved as { data: T }).data
  }
  return resolved as T
}

export class WebNikcliClient {
  private readonly sdk

  constructor(config: AppServerConfig) {
    this.sdk = createNikcliClient({
      baseUrl: normalizeServerUrl(config.url),
      directory: config.directory,
      headers: authorizationHeaders(config),
      responseStyle: "data",
      throwOnError: true,
    })
  }

  bootstrap() {
    return unwrap<MobileBootstrap>(this.sdk.mobile.bootstrap())
  }

  async ping() {
    try {
      await this.bootstrap()
      return true
    } catch {
      return false
    }
  }

  listSessions(search?: string) {
    return unwrap<MobileSessionSummary[]>(this.sdk.mobile.session.list({ search }))
  }

  createSession(input?: MobileSessionCreateInput) {
    return unwrap<Session>(this.sdk.mobile.session.create({ mobileSessionCreateInput: input }))
  }

  getSession(sessionID: string) {
    return unwrap<MobileSessionDetail>(this.sdk.mobile.session.detail({ sessionID }))
  }

  listCommands(sessionID: string) {
    return unwrap<MobileCommand[]>(this.sdk.mobile.session.command2.list({ sessionID }))
  }

  sendMessage(
    sessionID: string,
    text: string,
    options?: { agent?: string; model?: { providerID: string; modelID: string } },
  ) {
    return unwrap<{ accepted: true }>(
      this.sdk.mobile.session.message({
        sessionID,
        agent: options?.agent,
        model: options?.model,
        parts: [{ type: "text", text }],
      }),
    )
  }

  sendCommand(
    sessionID: string,
    command: string,
    argumentsText = "",
    options?: { agent?: string; model?: { providerID: string; modelID: string } },
  ) {
    return unwrap<MobileSessionDetail["messages"][number]>(
      this.sdk.mobile.session.command({
        sessionID,
        mobileSessionCommandInput: {
          command,
          arguments: argumentsText,
          agent: options?.agent,
          model: options?.model,
        },
      }),
    )
  }

  abortSession(sessionID: string) {
    return unwrap<{ success: true }>(this.sdk.mobile.session.abort({ sessionID }))
  }

  respondToPermission(sessionID: string, permissionID: string, response: "once" | "always" | "reject") {
    return unwrap<{ success: true }>(this.sdk.mobile.permission.respond({ sessionID, permissionID, response }))
  }

  getDiff(sessionID: string, messageID: string) {
    return unwrap<FileDiff[]>(this.sdk.mobile.session.diff({ sessionID, messageID }))
  }

  renameSession(sessionID: string, title: string) {
    return unwrap<{ success: true }>(this.sdk.mobile.session.rename({ sessionID, title }))
  }

  publishGithubSession(sessionID: string, input?: MobileGithubPublishInput) {
    return unwrap<MobileGithubPublishResult>(
      this.sdk.mobile.github.session.publish({
        sessionID,
        mobileGithubPublishInput: input,
      }),
    )
  }

  cleanupGithubSession(sessionID: string) {
    return unwrap<{ success: true }>(this.sdk.mobile.github.session.cleanup({ sessionID }))
  }

  listProjects() {
    return unwrap<MobileProject[]>(this.sdk.mobile.project.list())
  }

  listGithubRepos() {
    return unwrap<any[]>(this.sdk.mobile.github.repos())
  }

  listGithubBranches(owner: string, repo: string) {
    return unwrap<MobileGithubBranch[]>(this.sdk.mobile.github.branches({ owner, repo }))
  }

  importGithubRepo(input: MobileGithubImportRequest) {
    return unwrap<{
      import: {
        owner: string
        repo: string
        fullName: string
        directory: string
        cloneUrl: string
        defaultBranch: string
        private: boolean
        importedAt: number
        updatedAt: number
        projectID?: string
      }
      project: MobileProject
    }>(this.sdk.mobile.github.import({ mobileGithubImportRequest: input }))
  }

  createGithubSession(input: MobileGithubSessionCreateInput) {
    return unwrap<MobileGithubSessionCreateResult>(
      this.sdk.mobile.github.session.create({
        mobileGithubSessionCreateInput: input,
      }),
    )
  }

  createWorktree(name?: string) {
    return unwrap<Worktree>(this.sdk.mobile.worktree.create({ worktreeCreateInput: name ? { name } : undefined }))
  }

  removeWorktree(directory: string) {
    return unwrap<{ success: true }>(this.sdk.mobile.worktree.remove({ worktreeRemoveInput: { directory } }))
  }

  resetWorktree(directory: string) {
    return unwrap<{ success: true }>(this.sdk.mobile.worktree.reset({ worktreeResetInput: { directory } }))
  }

  listProviders() {
    return unwrap<ProviderCatalog>(this.sdk.provider.list())
  }

  startGithubDeviceAuth() {
    return unwrap<MobileGithubDeviceAuthStart>(this.sdk.mobile.github.oauth.device.start())
  }

  pollGithubDeviceAuth(deviceCode: string) {
    return unwrap<MobileGithubDeviceAuthPollResult>(
      this.sdk.mobile.github.oauth.device.poll({
        mobileGithubDeviceAuthPollInput: { deviceCode },
      }),
    )
  }

  setGithubToken(token: string) {
    return unwrap<{ success: true }>(this.sdk.mobile.github.auth.set({ token }))
  }

  clearGithubToken() {
    return unwrap<{ success: true }>(this.sdk.mobile.github.auth.remove())
  }

  listAuthTokens() {
    return unwrap<MobileAuthTokenPublic[]>(this.sdk.mobile.auth.token.list())
  }

  createAuthToken(name?: string, expiresInDays?: number) {
    return unwrap<{
      token: string
      info: MobileAuthTokenPublic
    }>(this.sdk.mobile.auth.token.create({ name, expiresInDays }))
  }

  revokeAuthToken(id: string) {
    return unwrap<{ revoked: boolean }>(this.sdk.mobile.auth.token.revoke({ id }))
  }

  async streamSession(input: {
    sessionID: string
    signal?: AbortSignal
    onEvent(event: NikcliEvent): void
    onError?(error: string): void
  }) {
    const streamResult = await this.sdk.mobile.session.stream(
      { sessionID: input.sessionID },
      {
        signal: input.signal,
        onSseError: (error) => {
          input.onError?.(getErrorMessage(error))
        },
      },
    )

    for await (const event of streamResult.stream) {
      if (input.signal?.aborted) break
      if (event && typeof event === "object" && "type" in (event as object)) {
        input.onEvent(event as NikcliEvent)
      }
    }
  }
}
