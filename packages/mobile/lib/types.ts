export type Session = {
  id: string
  projectID: string
  directory: string
  workspaceID?: string
  parentID?: string
  title: string
  version: string
  time: {
    created: number
    updated: number
    compacting?: number
    archived?: number
  }
  summary?: {
    additions: number
    deletions: number
    files: number
  }
  share?: {
    url: string
  }
  github?: {
    owner: string
    repo: string
    fullName: string
    baseBranch: string
    headBranch: string
    repositoryDirectory?: string
    cloneUrl?: string
    htmlUrl?: string
    private?: boolean
    worktree: {
      name: string
      branch: string
      directory: string
      cleanedAt?: number
    }
    pullRequest?: {
      number: number
      url: string
      title: string
    }
    lastCommitSha?: string
    publishedAt?: number
    publishError?: string
  }
}

export type MobileExecutionTarget = "local" | "container"

export type ThemeMode = "system" | "light" | "dark"

export type SettingsSectionID =
  | "profile"
  | "interaction"
  | "commands"
  | "memories"
  | "connection"
  | "execution"
  | "providers"
  | "github"
  | "mcp"
  | "skills"
  | "advanced"
  | "connectors"
  | "agents"
  | "tokens"

export type NotificationPreferences = {
  enabled: boolean
  sessionReady: boolean
  permissions: boolean
  failures: boolean
}

export type HapticPreferences = {
  enabled: boolean
  send: boolean
  commands: boolean
  permissions: boolean
  errors: boolean
}

export type GesturePreferences = {
  bubbleSwipeActions: boolean
  bubbleLongPressActions: boolean
}

export type PromptPreset = {
  id: string
  title: string
  prompt: string
  mode: "plan" | "code"
}

export type ComposerPreferences = {
  defaultMode: "plan" | "code"
  autoFollowTranscript: boolean
  slashSuggestions: boolean
}

export type AppPreferences = {
  themeMode: ThemeMode
  visibleSettingsSections: Record<SettingsSectionID, boolean>
  notifications: NotificationPreferences
  haptics: HapticPreferences
  gestures: GesturePreferences
  composer: ComposerPreferences
  promptPresets: PromptPreset[]
}

export type SessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number }

export type UserMessage = {
  id: string
  sessionID: string
  role: "user"
  time: { created: number }
  agent: string
  model: { providerID: string; modelID: string }
}

export type AssistantMessage = {
  id: string
  sessionID: string
  role: "assistant"
  time: { created: number; completed?: number }
  error?: { name: string; data: { message: string } }
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

export type Message = UserMessage | AssistantMessage

export type TextPart = {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
  synthetic?: boolean
}

export type ReasoningPart = {
  id: string
  sessionID: string
  messageID: string
  type: "reasoning"
  text: string
}

export type FilePart = {
  id: string
  sessionID: string
  messageID: string
  type: "file"
  mime: string
  filename?: string
  url: string
}

export type ToolState =
  | { status: "pending"; input: Record<string, unknown>; raw: string }
  | { status: "running"; input: Record<string, unknown>; title?: string; time: { start: number } }
  | {
      status: "completed"
      input: Record<string, unknown>
      output: string
      title: string
      time: { start: number; end: number }
    }
  | { status: "error"; input: Record<string, unknown>; error: string; time: { start: number; end: number } }

export type ToolPart = {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string
  state: ToolState
}

export type PatchPart = {
  id: string
  sessionID: string
  messageID: string
  type: "patch"
  hash: string
  files: string[]
}

export type StepStartPart = {
  id: string
  sessionID: string
  messageID: string
  type: "step-start"
}

export type StepFinishPart = {
  id: string
  sessionID: string
  messageID: string
  type: "step-finish"
  reason: string
  cost: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
}

export type KnownPartType = "text" | "file" | "reasoning" | "tool" | "patch" | "step-start" | "step-finish"

export type UnknownPart = {
  id: string
  sessionID: string
  messageID: string
  type: string
  [key: string]: unknown
}

export type Part =
  | TextPart
  | FilePart
  | ReasoningPart
  | ToolPart
  | PatchPart
  | StepStartPart
  | StepFinishPart

export type AnyPart = Part | UnknownPart

export function isKnownPart(part: AnyPart): part is Part {
  const knownTypes: KnownPartType[] = ["text", "file", "reasoning", "tool", "patch", "step-start", "step-finish"]
  return knownTypes.includes(part.type as KnownPartType)
}

export type MessageWithParts = {
  info: Message
  parts: AnyPart[]
}

export type SSEEvent =
  | { type: "message.part.updated"; properties: { part: Part; delta?: string } }
  | { type: "session.idle"; properties: { sessionID: string } }
  | { type: "session.status"; properties: { sessionID: string; status: SessionStatus } }
  | { type: "session.created"; properties: { info: Session } }
  | { type: "session.updated"; properties: { info: Session } }
  | { type: "session.deleted"; properties: { info: Session } }
  | { type: "message.updated"; properties: { info: Message } }
  | { type: "server.connected"; properties: Record<string, never> }
  | { type: "server.heartbeat"; properties: Record<string, never> }
  | { type: string; properties: unknown }

export const MOBILE_DEFAULT_PROVIDER_ID = "minimax-coding-plan"
export const MOBILE_DEFAULT_MODEL_ID = "MiniMax-M2.5"

export type ModelRef = {
  providerID: string
  modelID: string
}

export type ServerConfig = {
  url: string
  /** Bearer token — takes precedence over username/password */
  token?: string
  /** Basic auth username */
  username?: string
  /** Basic auth password */
  password?: string
  directory?: string
  modelProviderID?: string
  modelID?: string
  executionTarget?: MobileExecutionTarget
}

export type ProviderModel = {
  id: string
  providerID: string
  name: string
  status: "alpha" | "beta" | "deprecated" | "active"
  api: {
    id: string
    url: string
    npm: string
  }
}

export type ProviderInfo = {
  id: string
  name: string
  source: "env" | "config" | "custom" | "api"
  env: string[]
  key?: string
  models: Record<string, ProviderModel>
}

export type ProviderCatalog = {
  all: ProviderInfo[]
  default: Record<string, string>
  connected: string[]
}

export type PermissionRequest = {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  always: string[]
  metadata: Record<string, unknown>
}

export type ProjectInfo = {
  id: string
  worktree: string
  vcs?: "git"
  name?: string
  sandboxes: string[]
  current?: boolean
  time: {
    created: number
    updated: number
    initialized?: number
  }
}

export type MobileBootstrap = {
  version: string
  auth: {
    bearerEnabled: boolean
    currentToken?: {
      id: string
      name: string
      createdAt: number
      lastUsedAt?: number
      expiresAt?: number
    }
  }
  currentProject: ProjectInfo
  projects: ProjectInfo[]
  execution: {
    container: {
      available: boolean
      runtime?: "docker" | "podman"
      image: string
    }
  }
  github: {
    connected: boolean
    oauthDeviceEnabled: boolean
    oauthDeviceConfigured?: boolean
    oauthClientSource?: "flag" | "config" | "env"
    user?: {
      login: string
      name?: string | null
      avatar_url?: string
    }
  }
}

export type HostMcpStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "needs_auth" }
  | { status: "needs_client_registration"; error: string }
  | { status: "failed"; error: string }

export type SkillInfo = {
  name: string
  description: string
  location: string
  category?: string
  tags?: string[]
  version?: string
}

export type HostMcpConfig =
  | {
      type: "local"
      command: string[]
      environment?: Record<string, string>
      enabled?: boolean
      timeout?: number
    }
  | {
      type: "remote"
      url: string
      headers?: Record<string, string>
      enabled?: boolean
      timeout?: number
      oauth?: false | Record<string, unknown>
    }

export type HostConfigSnapshot = {
  connectors?: Record<string, Record<string, unknown>>
  command?: Record<string, HostCommandConfig>
  mcp?: Record<string, HostMcpConfig>
  [key: string]: unknown
}

export type HostCommandConfig = {
  template: string
  description?: string
  agent?: string
  model?: string
  subtask?: boolean
}

export type CommandInfo = {
  name: string
  description?: string
  agent?: string
  model?: string
  mcp?: boolean
  subtask?: boolean
  hints: string[]
}

export type PromptHistoryEntry = {
  id: string
  input: string
  mode?: "normal" | "shell"
  partsCount: number
}

export type PromptStashEntry = {
  id: string
  input: string
  timestamp: number
  partsCount: number
}

export type MemorySearchHit = {
  id: string
  sessionID: string
  sessionTitle: string
  messageID: string
  role: "user" | "assistant"
  createdAt: number
  preview: string
}

export type SessionSummary = {
  info: Session
  status?: SessionStatus
}

export type SessionDetail = {
  info: Session
  status?: SessionStatus
  messages: MessageWithParts[]
  permissions: PermissionRequest[]
}

export type GitHubRepo = {
  id: number
  name: string
  full_name: string
  description: string | null
  private: boolean
  html_url: string
  default_branch: string
  updated_at: string
  stargazers_count: number
  language: string | null
  topics: string[]
  clone_url?: string
  imported?: boolean
  imported_directory?: string
  imported_project_id?: string
}

export type FileDiff = {
  file: string
  before: string
  after: string
  additions: number
  deletions: number
}

export type ManagedGithubImport = {
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

export type GitHubBranch = {
  name: string
  protected?: boolean
  commit: {
    sha: string
  }
}

export type GitHubSessionCreateResult = {
  session: Session
  worktree: {
    name: string
    branch: string
    directory: string
  }
  project: ProjectInfo
  workspace?: {
    id: string
    projectID: string
    branch: string | null
    config: {
      type: "container" | "worktree"
      [key: string]: unknown
    }
  }
}

export type GitHubPublishResult = {
  commitSha: string
  branch: string
  pullRequest: {
    number: number
    url: string
    title: string
  }
}

export type GitHubDeviceAuthStart = {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  expiresAt: number
  interval: number
}

export type GitHubDeviceAuthPollResult = {
  status: "pending" | "approved" | "denied" | "expired"
  interval?: number
  user?: {
    login: string
    name?: string | null
    avatar_url?: string
  }
}

export type SessionStreamEvent =
  | { type: "server.connected"; properties: { sessionID: string } }
  | { type: "server.heartbeat"; properties: { sessionID: string } }
  | { type: "message.updated"; properties: { info: Message } }
  | { type: "message.removed"; properties: { sessionID: string; messageID: string } }
  | { type: "message.part.updated"; properties: { part: Part; delta?: string } }
  | { type: "message.part.removed"; properties: { sessionID: string; messageID: string; partID: string } }
  | { type: "session.updated"; properties: { info: Session } }
  | { type: "session.status"; properties: { sessionID: string; status: SessionStatus } }
  | { type: "session.idle"; properties: { sessionID: string } }
  | { type: "permission.asked"; properties: PermissionRequest }
  | {
      type: "permission.replied"
      properties: { sessionID: string; requestID: string; reply: "once" | "always" | "reject" }
    }
  | { type: string; properties: any }

export type MobileAuthToken = {
  id: string
  name?: string
  hash: string
  createdAt: number
  lastUsedAt?: number
  expiresAt?: number
}

export type HealthResponse = {
  healthy: boolean
  version?: string
}

export type ConnectorStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string }
  | { status: "needs_auth" }

export type ConnectorAuthInput = {
  token?: string
  botToken?: string
  apiKey?: string
}

export type ConnectorInfo = {
  name: string
  type: string
  credentialType: "token" | "botToken" | "apiKey"
  status: ConnectorStatus
}

export type AgentInfo = {
  id: string
  name: string
  description?: string
  tools?: string[]
  isDefault?: boolean
}

export function relativeTime(value: number): string {
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
