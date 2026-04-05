const SERVER_CONFIG_KEY = "nikcli_server_config"
const USER_TOKEN_KEY = "nikcli_dashboard_token"
const DEFAULT_SERVER_URL = (typeof import.meta !== "undefined" && (import.meta as any).env?.PROD_SERVER_URL) || ""

function getServerBase(): string {
  if (typeof localStorage === "undefined") return ""
  if (import.meta.env.DEV) return ""
  try {
    const raw = localStorage.getItem(SERVER_CONFIG_KEY)
    if (raw) {
      const cfg = JSON.parse(raw) as { url?: string }
      if (cfg.url) return cfg.url.replace(/\/$/, "")
    }
  } catch {}
  return DEFAULT_SERVER_URL
}

function getToken(): string | null {
  if (typeof localStorage === "undefined") return null
  return localStorage.getItem(USER_TOKEN_KEY)
}

function handle401() {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(USER_TOKEN_KEY)
    localStorage.removeItem("nikcli_dashboard_user")
  }
  if (typeof window !== "undefined") window.location.href = "/dashboard/login"
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getServerBase()
  const token = getToken()
  if (!base) throw new Error("No server configured. Connect to a nikcli server first.")
  const url = `${base}/studio/api${path}`
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`
  const res = await fetch(url, {
    ...init,
    headers: { ...headers, ...((init?.headers as Record<string, string>) ?? {}) },
  })
  if (res.status === 401) {
    handle401()
    throw new Error("Session expired. Please log in again.")
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string }
    throw new Error(err.error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

function json(body: unknown): RequestInit {
  return { body: JSON.stringify(body) }
}

export type NikcliConfig = {
  model?: string
  small_model?: string
  theme?: string
  autoupdate?: boolean | "notify"
  _path?: string
  mcp?: Record<string, McpServerConfig>
}

export type McpServerConfig =
  | { type: "local"; command: string[]; enabled?: boolean }
  | { type: "remote"; url: string; enabled?: boolean }

export type ProfileInfo = {
  mcpCount?: number
  plugins?: string[]
  providerCount?: number
}

export type ProfilesData = { profiles: Record<string, ProfileInfo>; activeProfile: string }

export type SkillSummary = {
  name: string
  description?: string
  category?: string
  tags?: string[]
  path?: string
  disabled?: boolean
}

export type SkillDetail = SkillSummary & { content?: string }

export type SkillsData = { skills: SkillSummary[] }

export type PluginInfo = {
  name: string
  description?: string
  path?: string
  content?: string
}

export type PluginsData = { plugins: PluginInfo[] }

export type AgentInfo = {
  name: string
  description?: string
  mode?: string
  model?: string
  path?: string
}

export type AgentsData = { agents: AgentInfo[] }

export type CommandInfo = { name: string; description?: string; path?: string }
export type CommandsData = { commands: CommandInfo[] }

export type AuthInfo = { type: "api"; apiKey: string } | { type: "oauth"; access: string; refresh?: string }
export type AuthData = { auth: Record<string, { type: string; apiKey?: string }> }

export type BackupInfo = { name: string; size?: number; createdAt?: string }
export type BackupsData = { backups: BackupInfo[] }

export type GitHubStatus = { available: boolean; authenticated: boolean; username?: string }

export type ConfigPathsData = { detected?: string; candidates: string[] }

export const studioApi = {
  config: {
    get: () => request<NikcliConfig>("/config"),
    patch: (patch: Partial<NikcliConfig>) =>
      request<{ success: boolean }>("/config", { method: "PATCH", ...json(patch) }),
    paths: () => request<ConfigPathsData>("/config/paths"),
    providers: () => request<{ providers: Record<string, unknown> }>("/config/providers"),
    setProviderApiKey: (id: string, apiKey: string) =>
      request<{ success: boolean }>(`/config/providers/${id}/api`, { method: "POST", ...json({ apiKey }) }),
  },

  mcp: {
    add: (name: string, config: McpServerConfig) =>
      request<{ success: boolean }>("/config/mcp", { method: "POST", ...json({ name, config }) }),
    patch: (name: string, patch: Partial<McpServerConfig>) =>
      request<{ success: boolean }>(`/config/mcp/${encodeURIComponent(name)}`, { method: "PATCH", ...json(patch) }),
    delete: (name: string) =>
      request<{ success: boolean }>(`/config/mcp/${encodeURIComponent(name)}`, { method: "DELETE" }),
  },

  profiles: {
    list: () => request<ProfilesData>("/profiles"),
    create: (name: string) => request<{ success: boolean }>("/profiles", { method: "POST", ...json({ name }) }),
    activate: (name: string) =>
      request<{ success: boolean }>(`/profiles/activate/${encodeURIComponent(name)}`, { method: "POST" }),
  },

  skills: {
    list: () => request<SkillsData>("/skills"),
    get: (name: string) => request<SkillDetail>(`/skills/${encodeURIComponent(name)}/content`),
    create: (name: string, description: string, content: string) =>
      request<{ success: boolean }>("/skills", { method: "POST", ...json({ name, description, content }) }),
    update: (name: string, data: Partial<SkillDetail>) =>
      request<{ success: boolean }>(`/skills/${encodeURIComponent(name)}`, { method: "PUT", ...json(data) }),
    delete: (name: string) =>
      request<{ success: boolean }>(`/skills/${encodeURIComponent(name)}`, { method: "DELETE" }),
    importUrls: (urls: string[]) =>
      request<{ success: boolean; imported: number }>("/skills/import", { method: "POST", ...json({ urls }) }),
  },

  plugins: {
    list: () => request<PluginsData>("/plugins"),
    get: (name: string) => request<PluginInfo>(`/plugins/${encodeURIComponent(name)}`),
    create: (name: string, template: string) =>
      request<{ success: boolean }>("/plugins", { method: "POST", ...json({ name, template }) }),
    update: (name: string, content: string) =>
      request<{ success: boolean }>(`/plugins/${encodeURIComponent(name)}`, { method: "PUT", ...json({ content }) }),
  },

  agents: {
    list: () => request<AgentsData>("/agents"),
    create: (name: string, description: string, prompt: string) =>
      request<{ success: boolean }>("/agents", { method: "POST", ...json({ name, description, prompt }) }),
  },

  commands: {
    list: () => request<CommandsData>("/commands"),
  },

  auth: {
    list: () => request<AuthData>("/auth"),
    set: (provider: string, info: AuthInfo) =>
      request<{ success: boolean }>(`/auth/${encodeURIComponent(provider)}`, { method: "POST", ...json(info) }),
    remove: (provider: string) =>
      request<{ success: boolean }>(`/auth/${encodeURIComponent(provider)}`, { method: "DELETE" }),
  },

  backup: {
    list: () => request<BackupsData>("/backup/list"),
    create: () => request<{ success: boolean; name: string }>("/backup/create", { method: "POST", ...json({}) }),
    restore: (name: string) => request<{ success: boolean }>("/backup/restore", { method: "POST", ...json({ name }) }),
  },

  github: {
    status: () => request<GitHubStatus>("/github/status"),
    push: () => request<{ success: boolean }>("/github/sync/push", { method: "POST", ...json({}) }),
  },
}
