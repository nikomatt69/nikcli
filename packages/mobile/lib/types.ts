export type Session = {
  id: string
  projectID: string
  directory: string
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

export type Part =
  | TextPart
  | ReasoningPart
  | ToolPart
  | PatchPart
  | StepStartPart
  | StepFinishPart
  | { id: string; sessionID: string; messageID: string; type: string; [key: string]: unknown }

export type MessageWithParts = {
  info: Message
  parts: Part[]
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

export type ServerConfig = {
  url: string
  /** Bearer token — takes precedence over username/password */
  token?: string
  /** Basic auth username */
  username?: string
  /** Basic auth password */
  password?: string
  directory?: string
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
  github: {
    connected: boolean
    user?: {
      login: string
      name?: string | null
      avatar_url?: string
    }
  }
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
