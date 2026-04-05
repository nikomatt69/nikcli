export interface McpServerConfig {
  type?: "local" | "remote" | string
  command?: string[]
  url?: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean
}

export interface NikcliConfig {
  model?: string
  small_model?: string
  theme?: string
  autoupdate?: boolean | "notify"
  mcp?: Record<string, McpServerConfig>
  provider?: Record<string, ProviderConfig>
  _path?: string
}

export interface ProviderConfig {
  apiKey?: string
  model?: string
  [key: string]: unknown
}

export interface ProfileInfo {
  mcpCount?: number
  plugins?: string[]
  providerCount?: number
}

export interface ProfilesData {
  profiles: Record<string, ProfileInfo>
  activeProfile: string
}

export interface SkillInfo {
  name: string
  description?: string
  path: string
  root: string
  category?: string
  tags?: string[]
  disabled?: boolean
}

export interface SkillDetail extends SkillInfo {
  content: string
}

export interface SkillsData {
  skills: SkillInfo[]
  dirs: Array<{ path: string; root: string }>
}

export interface PluginInfo {
  name: string
  path: string
  root: string
  filename: string
  disabled?: boolean
  content?: string
}

export interface PluginsData {
  plugins: PluginInfo[]
}

export interface AgentInfo {
  name: string
  description?: string
  mode?: string
  model?: string
  path: string
  root: string
  content?: string
}

export interface AgentsData {
  agents: AgentInfo[]
}

export interface CommandInfo {
  name: string
  description?: string
  path: string
  root: string
  template?: string
}

export interface CommandsData {
  commands: CommandInfo[]
}

export interface AuthInfo {
  type: string
  apiKey?: string
}

export interface AuthData {
  auth: Record<string, AuthInfo>
}

export interface BackupInfo {
  name: string
  date: string
  path?: string
  size?: number
}

export interface BackupsData {
  backups: BackupInfo[]
}

export interface ConfigPathsData {
  detected: string | null
  candidates: string[]
  studio: {
    configPath: string | null
    activeProfile: string
    githubRepo: string | null
  }
}

export interface GitHubStatus {
  available: boolean
  authenticated: boolean
  username?: string
  gistId?: string
}
