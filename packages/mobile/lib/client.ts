import type {
  AgentInfo,
  CommandInfo,
  ConnectorAuthInput,
  ConnectorStatus,
  FilePart,
  FileDiff,
  GitHubBranch,
  GitHubDeviceAuthPollResult,
  GitHubDeviceAuthStart,
  GitHubPublishResult,
  GitHubRepo,
  GitHubSessionCreateResult,
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
  ServerConfig,
  Session,
  SessionDetail,
  SessionSummary,
  SkillInfo,
} from "@/lib/types"

export class MobileClient {
  constructor(private readonly config: ServerConfig) {}

  headers(extra?: Record<string, string>) {
    const headers: Record<string, string> = {
      ...(extra ?? {}),
      "Content-Type": "application/json",
    }
    if (this.config.token) {
      headers.Authorization = `Bearer ${this.config.token}`
    }
    if (this.config.directory) headers["x-nikcli-directory"] = this.config.directory
    return headers
  }

  url(pathname: string) {
    return new URL(pathname, this.config.url.endsWith("/") ? this.config.url : `${this.config.url}/`).toString()
  }

  async request<T>(pathname: string, init?: RequestInit): Promise<T> {
    const response = await fetch(this.url(pathname), {
      ...init,
      headers: this.headers(init?.headers as Record<string, string> | undefined),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(body || `Request failed with ${response.status}`)
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
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
    return this.request<import("@/lib/types").GitState>("/git/status")
  }

  getGitCommits(limit: number = 20) {
    return this.request<import("@/lib/types").GitCommit[]>(`/git/commits?limit=${limit}`)
  }

  getGitDiff() {
    return this.request<import("@/lib/types").ParsedFileDiff[]>("/git/diff")
  }

  stageGitFiles(paths: string[]) {
    return this.request<boolean>("/git/stage", {
      method: "POST",
      body: JSON.stringify({ paths }),
    })
  }

  createGitCommit(message: string, files?: string[]) {
    return this.request<boolean>("/git/commit", {
      method: "POST",
      body: JSON.stringify({ message, files }),
    })
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
