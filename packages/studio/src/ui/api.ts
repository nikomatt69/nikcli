import type {
  NikcliConfig,
  McpServerConfig,
  ProfilesData,
  SkillsData,
  SkillDetail,
  PluginsData,
  PluginInfo,
  AgentsData,
  CommandsData,
  AuthData,
  AuthInfo,
  BackupsData,
  ConfigPathsData,
  GitHubStatus,
} from "./types"

const SERVER_CONFIG_KEY = "nikcli_server_config"

function getServerBase(): string {
  if (typeof localStorage === "undefined") return ""
  try {
    const raw = localStorage.getItem(SERVER_CONFIG_KEY)
    if (raw) {
      const cfg = JSON.parse(raw) as { url?: string }
      if (cfg.url) return cfg.url.replace(/\/$/, "")
    }
  } catch {}
  return ""
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getServerBase()
  const url = base ? `${base}/studio/api${path}` : `/studio/api${path}`
  const res = await fetch(url, init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; message?: string }
    throw new Error(err.error ?? err.message ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export type UserProfile = {
  id: string
  username: string
  email: string
  display_name: string | null
  role: "admin" | "user"
  created_at: number
  updated_at: number
}

const USER_TOKEN_KEY = "nikcli_user_token"

async function userRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof localStorage !== "undefined" ? localStorage.getItem(USER_TOKEN_KEY) : null
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`
  const base = getServerBase()
  const url = base ? `${base}/user${path}` : `/user${path}`
  const res = await fetch(url, { ...init, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; message?: string }
    throw new Error(err.error ?? err.message ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

function json(body: unknown): RequestInit {
  return { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
}

export const api = {
  config: {
    get: () => request<NikcliConfig>("/config"),
    patch: (patch: Partial<NikcliConfig>) => request<{ success: boolean }>("/config", { method: "PATCH", ...json(patch) }),
    paths: () => request<ConfigPathsData>("/config/paths"),
    setPath: (configPath: string) => request<{ success: boolean; current: string }>("/config/paths", { method: "POST", ...json({ configPath }) }),
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
    activate: (name: string) => request<{ success: boolean }>(`/profiles/activate/${encodeURIComponent(name)}`, { method: "POST" }),
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
    restore: (name: string) =>
      request<{ success: boolean }>("/backup/restore", { method: "POST", ...json({ name }) }),
  },

  github: {
    status: () => request<GitHubStatus>("/github/status"),
    push: () => request<{ success: boolean }>("/github/sync/push", { method: "POST", ...json({}) }),
  },
}

export const userApi = {
  status: () => userRequest<{ hasUsers: boolean }>("/status"),
  me: () => userRequest<UserProfile>("/me"),
  login: (email: string, password: string) =>
    userRequest<{ token: string; user: UserProfile }>("/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  register: (data: { username: string; email: string; password: string; displayName?: string }) =>
    userRequest<{ token: string; user: UserProfile }>("/register", { method: "POST", body: JSON.stringify(data) }),
  logout: () => userRequest<{ ok: boolean }>("/logout", { method: "POST" }),
  list: () => userRequest<UserProfile[]>("/list"),
  update: (id: string, data: { displayName?: string; password?: string; role?: "admin" | "user" }) =>
    userRequest<UserProfile>(`/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => userRequest<{ ok: boolean }>(`/${id}`, { method: "DELETE" }),
  getToken: () => (typeof localStorage !== "undefined" ? localStorage.getItem(USER_TOKEN_KEY) : null),
  saveToken: (token: string) => { if (typeof localStorage !== "undefined") localStorage.setItem(USER_TOKEN_KEY, token) },
  clearToken: () => { if (typeof localStorage !== "undefined") localStorage.removeItem(USER_TOKEN_KEY) },
}
