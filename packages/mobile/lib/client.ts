import type {
  AgentInfo,
  CommandInfo,
  ConnectorAuthInput,
  ConnectorStatus,
  FileContent,
  FileNode,
  FilePart,
  FileDiff,
  GitHubBranch,
  GitHubDeviceAuthPollResult,
  GitHubDeviceAuthStart,
  GitHubPublishResult,
  GitHubRepo,
  GitHubSessionCreateResult,
  GitBranchInfo,
  GitCommitResult,
  GitState,
  HostConfigSnapshot,
  HostCommandConfig,
  HostMcpStatus,
  ManagedGithubImport,
  MemorySearchHit,
  MobileAuthToken,
  MobileExecutionTarget,
  ModelRef,
  MobileBootstrap,
  ProviderCatalog,
  PromptHistoryEntry,
  PromptPreset,
  PromptStashEntry,
  ProjectInfo,
  PtyCreateInput,
  PtyInfo,
  PtyUpdateInput,
  QuestionRequest,
  SearchMatch,
  Routine,
  RoutineCreateInput,
  RoutineUpdateInput,
  ServerConfig,
  Session,
  SessionDetail,
  SessionSummary,
  SkillInfo,
} from "@/lib/types"

type JsonObject = Record<string, unknown>

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "")
}

function toBasicAuth(username: string, password: string): string {
  const value = `${username}:${password}`
  if (typeof btoa === "function") return btoa(value)
  return value
}

function parseErrorPayload(value: unknown): string | null {
  if (!value || typeof value !== "object") return null
  const data = value as JsonObject
  const direct = data.error ?? data.message ?? data.detail
  if (typeof direct === "string" && direct.trim()) return direct.trim()
  if (Array.isArray(direct)) return direct.map(String).join(", ")
  return null
}

function isLikelyHtml(value: string): boolean {
  return /^\s*</.test(value)
}

export async function parseMobileResponse<T>(response: Response, pathname: string): Promise<T> {
  if (response.status === 204) return undefined as T

  const text = await response.text().catch(() => "")
  const contentType = response.headers.get("content-type") ?? ""
  let parsed: unknown = undefined

  if (text.trim()) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = undefined
    }
  }

  if (!response.ok) {
    const parsedMessage = parseErrorPayload(parsed)
    if (parsedMessage) throw new Error(parsedMessage)
    if (isLikelyHtml(text)) {
      throw new Error(
        `Request to ${pathname} returned HTML (${response.status}). Check the server URL, auth, and endpoint prefix.`,
      )
    }
    throw new Error(text.trim() || `Request to ${pathname} failed with ${response.status}`)
  }

  if (parsed !== undefined) return parsed as T
  if (contentType.includes("application/json")) {
    throw new Error(`Request to ${pathname} returned invalid JSON`)
  }
  return text as T
}

export function buildMobileHeaders(config: ServerConfig, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    ...(extra ?? {}),
    "Content-Type": "application/json",
  }
  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`
  } else if (config.username && config.password) {
    headers.Authorization = `Basic ${toBasicAuth(config.username, config.password)}`
  }
  if (config.directory) headers["x-nikcli-directory"] = config.directory
  return headers
}

export function buildMobileUrl(config: Pick<ServerConfig, "url">, pathname: string): string {
  const base = trimTrailingSlash(config.url)
  const path = pathname.startsWith("/") ? pathname.slice(1) : pathname
  return `${base}/${path}`
}

export class MobileClient {
  constructor(private readonly config: ServerConfig) {}

  headers(extra?: Record<string, string>) {
    return buildMobileHeaders(this.config, extra)
  }

  url(pathname: string) {
    return buildMobileUrl(this.config, pathname)
  }

  async request<T>(pathname: string, init?: RequestInit): Promise<T> {
    const response = await fetch(this.url(pathname), {
      ...init,
      headers: this.headers(init?.headers as Record<string, string> | undefined),
    })
    return parseMobileResponse<T>(response, pathname)
  }

  bootstrap() {
    return this.request<MobileBootstrap>("/mobile/bootstrap")
  }

  listCommands(sessionID: string) {
    return this.request<CommandInfo[]>(`/mobile/session/${encodeURIComponent(sessionID)}/command`)
  }

  listHostCommands() {
    return this.request<CommandInfo[]>("/mobile/command")
  }

  listSessions(search?: string) {
    const query = search ? `?search=${encodeURIComponent(search)}` : ""
    return this.request<SessionSummary[]>(`/mobile/session${query}`)
  }

  createSession(input?: {
    title?: string
    parentID?: string
    permission?: unknown
    github?: Session["github"]
    executionTarget?: MobileExecutionTarget
  }) {
    return this.request<Session>("/mobile/session", {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    })
  }

  getSession(sessionID: string) {
    return this.request<SessionDetail>(`/mobile/session/${encodeURIComponent(sessionID)}`)
  }

  sendMessage(sessionID: string, text: string, options?: { model?: ModelRef; agent?: string }) {
    return this.sendParts(sessionID, [{ type: "text", text }], options)
  }

  sendCommand(sessionID: string, command: string, argumentsText = "", options?: { model?: ModelRef; agent?: string }) {
    return this.request<{
      info: SessionDetail["messages"][number]["info"]
      parts: SessionDetail["messages"][number]["parts"]
    }>(`/mobile/session/${encodeURIComponent(sessionID)}/command`, {
      method: "POST",
      body: JSON.stringify({
        command,
        arguments: argumentsText,
        agent: options?.agent,
        model: options?.model,
      }),
    })
  }

  sendParts(
    sessionID: string,
    parts: Array<Pick<FilePart, "type" | "mime" | "filename" | "url"> | { type: "text"; text: string }>,
    options?: { model?: ModelRef; agent?: string },
  ) {
    return this.request<{ accepted: true }>(`/mobile/session/${encodeURIComponent(sessionID)}/message`, {
      method: "POST",
      body: JSON.stringify({ parts, ...options }),
    })
  }

  abortSession(sessionID: string) {
    return this.request<{ success: true }>(`/mobile/session/${encodeURIComponent(sessionID)}/abort`, {
      method: "POST",
    })
  }

  respondToPermission(sessionID: string, permissionID: string, response: "once" | "always" | "reject") {
    return this.request<{ success: true }>(
      `/mobile/session/${encodeURIComponent(sessionID)}/permissions/${encodeURIComponent(permissionID)}`,
      {
        method: "POST",
        body: JSON.stringify({ response }),
      },
    )
  }

  respondToQuestion(sessionID: string, requestID: string, answers: string[][]) {
    return this.request<{ success: true }>(
      `/mobile/session/${encodeURIComponent(sessionID)}/question/${encodeURIComponent(requestID)}`,
      {
        method: "POST",
        body: JSON.stringify({ answers }),
      },
    )
  }

  rejectQuestion(sessionID: string, requestID: string) {
    return this.request<{ success: true }>(
      `/mobile/session/${encodeURIComponent(sessionID)}/question/${encodeURIComponent(requestID)}`,
      {
        method: "DELETE",
      },
    )
  }

  getDiff(sessionID: string, messageID: string) {
    return this.request<FileDiff[]>(
      `/mobile/session/${encodeURIComponent(sessionID)}/diff/${encodeURIComponent(messageID)}`,
    )
  }

  sessionStreamUrl(sessionID: string) {
    return this.url(`/mobile/session/${encodeURIComponent(sessionID)}/stream`)
  }

  listProjects() {
    return this.request<ProjectInfo[]>("/mobile/project")
  }

  listProviders() {
    return this.request<ProviderCatalog>("/provider")
  }

  getConfig() {
    return this.request<HostConfigSnapshot>("/config")
  }

  updateConfig(config: HostConfigSnapshot) {
    return this.request<HostConfigSnapshot>("/config", {
      method: "PATCH",
      body: JSON.stringify(config),
    })
  }

  listMcpStatus() {
    return this.request<Record<string, HostMcpStatus>>("/mcp")
  }

  listPromptHistory() {
    return this.request<PromptHistoryEntry[]>("/mobile/memory/history")
  }

  searchMemories(query: string) {
    return this.request<MemorySearchHit[]>(`/mobile/memory/search?query=${encodeURIComponent(query)}`)
  }

  listPromptStash() {
    return this.request<PromptStashEntry[]>("/mobile/memory/stash")
  }

  addPromptStash(input: { input: string }) {
    return this.request<PromptStashEntry>("/mobile/memory/stash", {
      method: "POST",
      body: JSON.stringify(input),
    })
  }

  removePromptStash(id: string) {
    return this.request<{ success: true }>(`/mobile/memory/stash/${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
  }

  connectMcp(name: string) {
    return this.request<boolean>(`/mcp/${encodeURIComponent(name)}/connect`, {
      method: "POST",
    })
  }

  disconnectMcp(name: string) {
    return this.request<boolean>(`/mcp/${encodeURIComponent(name)}/disconnect`, {
      method: "POST",
    })
  }

  toggleMcp(name: string, enabled: boolean) {
    return this.request<Record<string, HostMcpStatus>>(`/mcp/${encodeURIComponent(name)}/toggle`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    })
  }

  getGitStatus() {
    return this.request<GitState>("/mobile/git/status")
  }

  getGitCommits(limit: number = 20) {
    return this.request<import("@/lib/types").GitCommit[]>(`/mobile/git/commits?limit=${limit}`)
  }

  getGitDiff(options?: { staged?: boolean; file?: string }) {
    const params = new URLSearchParams()
    if (options?.staged) params.set("staged", "true")
    if (options?.file) params.set("file", options.file)
    const query = params.toString()
    return this.request<import("@/lib/types").ParsedFileDiff[]>(`/mobile/git/diff${query ? `?${query}` : ""}`)
  }

  getGitBranches() {
    return this.request<GitBranchInfo[]>("/mobile/git/branches")
  }

  stageGitFiles(paths: string[]) {
    return this.request<{ success: true }>("/mobile/git/stage", {
      method: "POST",
      body: JSON.stringify({ files: paths }),
    })
  }

  unstageGitFiles(paths: string[]) {
    return this.request<{ success: true }>("/mobile/git/unstage", {
      method: "POST",
      body: JSON.stringify({ files: paths }),
    })
  }

  discardGitFiles(paths: string[]) {
    return this.request<{ success: true }>("/mobile/git/discard", {
      method: "POST",
      body: JSON.stringify({ files: paths }),
    })
  }

  createGitCommit(message: string, files?: string[], options?: { stagedOnly?: boolean }) {
    return this.request<GitCommitResult>("/mobile/git/commit", {
      method: "POST",
      body: JSON.stringify({ message, files, stagedOnly: options?.stagedOnly }),
    })
  }

  pushGitBranch(upstream?: string) {
    const query = upstream ? `?upstream=${encodeURIComponent(upstream)}` : ""
    return this.request<{ success: true; pushed: boolean }>(`/mobile/git/push${query}`, { method: "POST" })
  }

  pullGitBranch() {
    return this.request<{ success: true; pulled: boolean; conflicts?: string[] }>("/mobile/git/pull", {
      method: "POST",
    })
  }

  // ── File System ──────────────────────────────────────────────────────────

  listDirectory(dirPath: string) {
    return this.request<FileNode[]>(`/file?path=${encodeURIComponent(dirPath)}`)
  }

  readFile(filePath: string) {
    return this.request<FileContent>(`/file/content?path=${encodeURIComponent(filePath)}`)
  }

  writeFile(filePath: string, content: string) {
    return this.request<{ success: boolean }>("/file/content", {
      method: "PUT",
      body: JSON.stringify({ path: filePath, content }),
    })
  }

  searchFiles(query: string) {
    return this.request<string[]>(`/find/file?query=${encodeURIComponent(query)}`)
  }

  searchText(pattern: string) {
    return this.request<SearchMatch[]>(`/find?pattern=${encodeURIComponent(pattern)}`)
  }

  startMcpAuth(name: string) {
    return this.request<{ authorizationUrl: string }>(`/mcp/${encodeURIComponent(name)}/auth`, {
      method: "POST",
    })
  }

  removeMcpAuth(name: string) {
    return this.request<{ success: true }>(`/mcp/${encodeURIComponent(name)}/auth`, {
      method: "DELETE",
    })
  }

  listSkills() {
    return this.request<SkillInfo[]>("/skill")
  }

  setProviderApiKey(providerID: string, key: string) {
    return this.request<{ success: true }>(`/provider/${encodeURIComponent(providerID)}/api`, {
      method: "POST",
      body: JSON.stringify({ key }),
    })
  }

  removeProviderAuth(providerID: string) {
    return this.request<{ success: true }>(`/provider/${encodeURIComponent(providerID)}/auth`, {
      method: "DELETE",
    })
  }

  listGithubRepos() {
    return this.request<GitHubRepo[]>("/mobile/github/repos")
  }

  listGithubBranches(owner: string, repo: string) {
    return this.request<GitHubBranch[]>(
      `/mobile/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`,
    )
  }

  listGithubImports() {
    return this.request<ManagedGithubImport[]>("/mobile/github/imports")
  }

  startGithubDeviceAuth() {
    return this.request<GitHubDeviceAuthStart>("/mobile/github/oauth/device", {
      method: "POST",
    })
  }

  saveGithubOAuthClientID(clientId: string) {
    return this.request<HostConfigSnapshot>("/mobile/github/oauth/client", {
      method: "POST",
      body: JSON.stringify({ clientId }),
    })
  }

  pollGithubDeviceAuth(deviceCode: string) {
    return this.request<GitHubDeviceAuthPollResult>("/mobile/github/oauth/device/poll", {
      method: "POST",
      body: JSON.stringify({ deviceCode }),
    })
  }

  setGithubToken(token: string) {
    return this.request<{ success: true }>("/mobile/github/auth", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
  }

  clearGithubToken() {
    return this.request<{ success: true }>("/mobile/github/auth", { method: "DELETE" })
  }

  importGithubRepo(input: { owner: string; repo: string; cloneUrl: string; defaultBranch: string; private: boolean }) {
    return this.request<{ import: ManagedGithubImport; project: ProjectInfo }>("/mobile/github/import", {
      method: "POST",
      body: JSON.stringify(input),
    })
  }

  createGithubSession(input: {
    owner: string
    repo: string
    cloneUrl: string
    htmlUrl?: string
    defaultBranch: string
    baseBranch: string
    private: boolean
    title?: string
    executionTarget?: MobileExecutionTarget
  }) {
    return this.request<GitHubSessionCreateResult>("/mobile/github/session", {
      method: "POST",
      body: JSON.stringify(input),
    })
  }

  publishGithubSession(sessionID: string, input?: { title?: string; body?: string; commitMessage?: string }) {
    return this.request<GitHubPublishResult>(`/mobile/session/${encodeURIComponent(sessionID)}/publish`, {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    })
  }

  cleanupGithubSession(sessionID: string) {
    return this.request<{ success: true }>(`/mobile/session/${encodeURIComponent(sessionID)}/cleanup`, {
      method: "POST",
    })
  }

  createWorktree(name?: string) {
    return this.request<{ name: string; branch: string; directory: string }>("/mobile/worktree", {
      method: "POST",
      body: JSON.stringify(name ? { name } : {}),
    })
  }

  resetWorktree(directory: string) {
    return this.request<{ success: true }>("/mobile/worktree/reset", {
      method: "POST",
      body: JSON.stringify({ directory }),
    })
  }

  removeWorktree(directory: string) {
    return this.request<{ success: true }>("/mobile/worktree", {
      method: "DELETE",
      body: JSON.stringify({ directory }),
    })
  }

  async ping(): Promise<boolean> {
    try {
      await this.request<MobileBootstrap>("/mobile/bootstrap")
      return true
    } catch {
      return false
    }
  }

  listAuthTokens() {
    return this.request<MobileAuthToken[]>("/mobile/auth/token")
  }

  createAuthToken(name?: string, expiresInDays?: number) {
    return this.request<{ token: string; info: MobileAuthToken }>("/mobile/auth/token", {
      method: "POST",
      body: JSON.stringify({ name, expiresInDays }),
    })
  }

  revokeAuthToken(id: string) {
    return this.request<{ revoked: boolean }>(`/mobile/auth/token/${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
  }

  listConnectors() {
    return this.request<Record<string, ConnectorStatus>>("/connectors")
  }

  setConnectorAuth(name: string, input: ConnectorAuthInput) {
    return this.request<{ success: true }>(`/connectors/${encodeURIComponent(name)}/auth`, {
      method: "POST",
      body: JSON.stringify(input),
    })
  }

  removeConnectorAuth(name: string) {
    return this.request<{ success: true }>(`/connectors/${encodeURIComponent(name)}/auth`, {
      method: "DELETE",
    })
  }

  listAgents() {
    return this.request<AgentInfo[]>("/agent")
  }

  renameSession(sessionID: string, title: string) {
    return this.request<{ success: true }>(`/mobile/session/${encodeURIComponent(sessionID)}/rename`, {
      method: "POST",
      body: JSON.stringify({ title }),
    })
  }

  // ── Routines ────────────────────────────────────────────────────────────────

  listRoutines() {
    return this.request<Routine[]>("/mobile/routines")
  }

  createRoutine(input: RoutineCreateInput) {
    return this.request<Routine>("/mobile/routines", {
      method: "POST",
      body: JSON.stringify(input),
    })
  }

  getRoutine(id: string) {
    return this.request<Routine>(`/mobile/routines/${encodeURIComponent(id)}`)
  }

  updateRoutine(id: string, input: RoutineUpdateInput) {
    return this.request<Routine>(`/mobile/routines/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    })
  }

  deleteRoutine(id: string) {
    return this.request<{ success: true }>(`/mobile/routines/${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
  }

  runRoutine(id: string) {
    return this.request<Session>(`/mobile/routines/${encodeURIComponent(id)}/run`, {
      method: "POST",
    })
  }

  pauseRoutine(id: string) {
    return this.request<Routine>(`/mobile/routines/${encodeURIComponent(id)}/pause`, {
      method: "POST",
    })
  }

  resumeRoutine(id: string) {
    return this.request<Routine>(`/mobile/routines/${encodeURIComponent(id)}/resume`, {
      method: "POST",
    })
  }

  // ── PTY (Terminal) ──────────────────────────────────────────────────────────

  listPty() {
    return this.request<PtyInfo[]>("/pty")
  }

  createPty(input: PtyCreateInput = {}) {
    return this.request<PtyInfo>("/pty", {
      method: "POST",
      body: JSON.stringify(input),
    })
  }

  getPty(ptyID: string) {
    return this.request<PtyInfo>(`/pty/${encodeURIComponent(ptyID)}`)
  }

  updatePty(ptyID: string, input: PtyUpdateInput) {
    return this.request<PtyInfo>(`/pty/${encodeURIComponent(ptyID)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    })
  }

  removePty(ptyID: string) {
    return this.request<boolean>(`/pty/${encodeURIComponent(ptyID)}`, {
      method: "DELETE",
    })
  }

  /** Returns the ws:// or wss:// URL to connect wterm's WebSocketTransport */
  ptyConnectUrl(ptyID: string): string {
    const http = this.url(`/pty/${encodeURIComponent(ptyID)}/connect`)
    const ws = http.replace(/^https?:/, (m) => (m === "https:" ? "wss:" : "ws:"))
    const url = new URL(ws)
    // WebSocket does not support custom headers. Mirror the headers used by createPty()
    // through query params so the server resolves the same Instance.directory/state.
    if (this.config.token) url.searchParams.set("token", this.config.token)
    if (this.config.directory) url.searchParams.set("directory", this.config.directory)
    return url.toString()
  }

  withToken(token: string): MobileClient {
    return new MobileClient({ ...this.config, token })
  }

  get serverUrl(): string {
    return this.config.url
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _client: MobileClient | null = null
let _configKey = ""

export function createMobileClient(config: ServerConfig): MobileClient {
  _configKey = JSON.stringify(config)
  _client = new MobileClient(config)
  return _client
}

export function getCachedClient(): MobileClient | null {
  return _client
}

export function invalidateClient(): void {
  _client = null
  _configKey = ""
}

export async function getMobileClient(): Promise<MobileClient | null> {
  const { getServerConfig } = await import("./storage")
  const config = await getServerConfig()
  if (!config) return null
  const key = JSON.stringify(config)
  if (_client && _configKey === key) return _client
  return createMobileClient(config)
}
