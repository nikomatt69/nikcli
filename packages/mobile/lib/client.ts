import type {
  FileDiff,
  GitHubRepo,
  ManagedGithubImport,
  MobileBootstrap,
  ProjectInfo,
  ServerConfig,
  Session,
  SessionDetail,
  SessionSummary,
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

  listSessions(search?: string) {
    const query = search ? `?search=${encodeURIComponent(search)}` : ""
    return this.request<SessionSummary[]>(`/mobile/session${query}`)
  }

  createSession(input?: Record<string, unknown>) {
    return this.request<Session>("/mobile/session", {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    })
  }

  getSession(sessionID: string) {
    return this.request<SessionDetail>(`/mobile/session/${encodeURIComponent(sessionID)}`)
  }

  sendMessage(sessionID: string, text: string) {
    return this.request<{ accepted: true }>(`/mobile/session/${encodeURIComponent(sessionID)}/message`, {
      method: "POST",
      body: JSON.stringify({ parts: [{ type: "text", text }] }),
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

  listGithubRepos() {
    return this.request<GitHubRepo[]>("/mobile/github/repos")
  }

  listGithubImports() {
    return this.request<ManagedGithubImport[]>("/mobile/github/imports")
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
