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
      repositoryDirectory?: string
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
  /** Isolated worktree for plain (non-GitHub) sessions; GitHub sessions keep theirs under `github.worktree`. */
  worktree?: {
    name: string
    branch: string
    directory: string
    repositoryDirectory?: string
    cleanedAt?: number
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
  | "routines"
  | "plugins"
  | "permissions"

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

export type WallpaperPreferences = {
  uri: string | null
  opacity: number
  enabled: boolean
}

export type AppPreferences = {
  themeMode: ThemeMode
  visibleSettingsSections: Record<SettingsSectionID, boolean>
  notifications: NotificationPreferences
  haptics: HapticPreferences
  gestures: GesturePreferences
  composer: ComposerPreferences
  promptPresets: PromptPreset[]
  wallpaper: WallpaperPreferences
  tipsHidden: boolean
  mathEnabled: boolean
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
  variant?: string
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
  | {
      status: "pending"
      input: Record<string, unknown>
      raw: string
      metadata?: Record<string, unknown>
    }
  | {
      status: "running"
      input: Record<string, unknown>
      title?: string
      metadata?: Record<string, unknown>
      time: { start: number }
    }
  | {
      status: "completed"
      input: Record<string, unknown>
      output: string
      title: string
      metadata?: Record<string, unknown>
      time: { start: number; end: number }
    }
  | {
      status: "error"
      input: Record<string, unknown>
      error: string
      metadata?: Record<string, unknown>
      time: { start: number; end: number }
    }

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
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

export type Part =
  | TextPart
  | FilePart
  | ReasoningPart
  | ToolPart
  | PatchPart
  | StepStartPart
  | StepFinishPart
  | {
      id: string
      sessionID: string
      messageID: string
      type: string
      [key: string]: unknown
    }

export type MessageWithParts = {
  info: Message
  parts: Part[]
}

export type SSEEvent =
  | { type: "message.part.updated"; properties: { part: Part; delta?: string } }
  | { type: "session.idle"; properties: { sessionID: string } }
  | {
      type: "session.status"
      properties: { sessionID: string; status: SessionStatus }
    }
  | { type: "session.created"; properties: { info: Session } }
  | { type: "session.updated"; properties: { info: Session } }
  | { type: "session.deleted"; properties: { info: Session } }
  | { type: "message.updated"; properties: { info: Message } }
  | { type: "server.connected"; properties: Record<string, never> }
  | { type: "server.heartbeat"; properties: Record<string, never> }
  | { type: string; properties: unknown }

export const MOBILE_DEFAULT_PROVIDER_ID = "minimax-coding-plan"
export const MOBILE_DEFAULT_MODEL_ID = "MiniMax-M2.5"

// ── File Explorer ──────────────────────────────────────────────────────────

export type FileNode = {
  name: string
  path: string
  absolute: string
  type: "file" | "directory"
  ignored: boolean
  gitStatus?: "added" | "modified" | "deleted"
}

export type FileContent = {
  type: "text"
  content: string
  diff?: string
  patch?: {
    oldFileName: string
    newFileName: string
    hunks: Array<{
      oldStart: number
      oldLines: number
      newStart: number
      newLines: number
      lines: string[]
    }>
  }
  encoding?: "base64"
  mimeType?: string
}

export type SearchMatch = {
  type: "match" | "context" | "begin" | "end"
  data: {
    path?: { text: string }
    lines?: { text: string }
    line_number?: number
    absolute_offset?: number
    submatches?: Array<{ match: { text: string }; start: number; end: number }>
  }
}

export type ModelRef = {
  providerID: string
  modelID: string
}

export type ServerConfig = {
  url: string
  /** OAuth issuer override for self-hosted deployments. */
  authIssuer?: string
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
  variants?: Record<string, unknown>
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

// ── Question Types ─────────────────────────────────────────────────────────

export type QuestionOption = {
  label: string
  description: string
}

export type QuestionInfo = {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export type QuestionRequest = {
  id: string
  sessionID: string
  questions: QuestionInfo[]
  tool?: {
    messageID: string
    callID: string
  }
}

// Union type for any pending approval request
export type ApprovalRequest = PermissionRequest | QuestionRequest

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

export type MobileProjectType = {
  detected: boolean
  platforms?: string[]
  primaryPlatform?: string
  method?: string
  root?: string
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
    tokenAvailable?: boolean
    reconnectRequired?: boolean
    oauthDeviceEnabled: boolean
    oauthDeviceConfigured?: boolean
    oauthClientSource?: "flag" | "config" | "env"
    user?: {
      login: string
      name?: string | null
      avatar_url?: string
    }
  }
  expo?: {
    available: boolean
    easAvailable: boolean
    details: string[]
  }
  mobileProject?: MobileProjectType
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
  skill?: boolean
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

export type SessionArtifact = {
  id: string
  title: string
  description?: string
  filename: string
  contentType: string
  kind: "html" | "markdown" | "image" | "video" | "text"
  url: string
  viewerUrl: string
  previewUrl: string
  version: number
  sessionID: string
  size: number
  time: { created: number; updated: number }
}

export type SessionDetail = {
  info: Session
  status?: SessionStatus
  messages: MessageWithParts[]
  artifacts?: SessionArtifact[]
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
}

export type WorktreeInfo = {
  name: string
  branch?: string
  directory: string
}

export type TeleportResult = {
  sessionID: string
  title?: string
  messageCount: number
  directory?: string
  workspace: boolean
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
  worktree: WorktreeInfo
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

export type GitFileStatus = {
  status: "added" | "modified" | "deleted" | "renamed" | "untracked"
  path: string
  oldPath?: string
  additions?: number
  deletions?: number
}

export type ParsedFileDiff = {
  file: string
  oldPath?: string
  stage?: "staged" | "unstaged"
  additions?: number
  deletions?: number
  isBinary?: boolean
  hunks: Array<{
    header: {
      oldStart: number
      oldLines: number
      newStart: number
      newLines: number
    }
    lines: Array<{
      type: "add" | "remove" | "context"
      text: string
      oldLineNumber?: number
      newLineNumber?: number
    }>
  }>
}

export type DiffHunk = ParsedFileDiff["hunks"][number]

export type DiffLine = DiffHunk["lines"][number]

export type GitCommit = {
  sha: string
  message: string
  author: { name: string; email: string }
  timestamp: number
  additions: number
  deletions: number
  filesCount: number
}

export type GitState = {
  branch: string
  staged: GitFileStatus[]
  unstaged: GitFileStatus[]
  untracked: string[]
  commitsAhead: number
  commitsBehind: number
  lastCommit?: {
    sha: string
    message: string
    author: string
    timestamp: number
  }
}

export type GitBranchInfo = {
  name: string
  isCurrent: boolean
  isProtected: boolean
  aheadBy: number
  behindBy: number
}

export type GitCommitResult = {
  sha: string
  message: string
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
  | {
      type: "message.removed"
      properties: { sessionID: string; messageID: string }
    }
  | { type: "message.part.updated"; properties: { part: Part; delta?: string } }
  | {
      type: "message.part.removed"
      properties: { sessionID: string; messageID: string; partID: string }
    }
  | { type: "session.updated"; properties: { info: Session } }
  | {
      type: "session.status"
      properties: { sessionID: string; status: SessionStatus }
    }
  | { type: "session.idle"; properties: { sessionID: string } }
  | {
      type: "session.error"
      properties: {
        sessionID?: string
        error?: { message?: string; data?: { message?: string } }
      }
    }
  | { type: "permission.asked"; properties: PermissionRequest }
  | {
      type: "permission.replied"
      properties: {
        sessionID: string
        requestID: string
        reply: "once" | "always" | "reject"
      }
    }
  | { type: "question.asked"; properties: QuestionRequest }
  | {
      type: "question.replied"
      properties: { sessionID: string; requestID: string; answers: string[][] }
    }
  | {
      type: "question.rejected"
      properties: { sessionID: string; requestID: string }
    }
  | { type: string; properties: any }

export type MobileAuthToken = {
  id: string
  name?: string
  createdAt: number
  lastUsedAt?: number
  expiresAt?: number
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

// ── Routines ──────────────────────────────────────────────────────────────────

export type RoutineTriggerSchedule = {
  type: "schedule"
  cron: string
  enabled: boolean
}

export type RoutineTriggerApi = {
  type: "api"
  token: string
  enabled: boolean
}

export type RoutineTrigger = RoutineTriggerSchedule | RoutineTriggerApi

export type Routine = {
  id: string
  name: string
  prompt: string
  triggers: RoutineTrigger[]
  model?: {
    providerID: string
    modelID: string
  }
  paused: boolean
  projectID: string
  directory: string
  createdAt: number
  updatedAt: number
  lastRunAt?: number
  lastSessionID?: string
}

export type RoutineCreateInput = {
  name: string
  prompt: string
  triggers?: RoutineTrigger[]
  model?: {
    providerID: string
    modelID: string
  }
}

export type RoutineUpdateInput = Partial<RoutineCreateInput> & {
  paused?: boolean
}

// ── Loops ─────────────────────────────────────────────────────────────────────

export type LoopTrigger = { kind: "manual" } | { kind: "interval"; everyMs: number }

export type LoopStage = {
  name: string
  agent: string
  model?: string
  objective: string
  tokenBudget?: number
}

export type LoopDefinition = {
  id: string
  name: string
  stages: LoopStage[]
  trigger: LoopTrigger
  maxRuns?: number
  timeoutMs?: number
  paused?: boolean
  enabled: boolean
  createdAt: number
}

export type LoopWriteInput = Omit<LoopDefinition, "id" | "createdAt">

export type LoopRuntimeStatus = "idle" | "running" | "paused" | "error" | "cancelling"

export type LoopRuntime = {
  loopID: string
  status: LoopRuntimeStatus
  runs: number
  lastRunAt?: number
  lastError?: string
  sessionID?: string
}

export type LoopRunStatus = "running" | "complete" | "error" | "timeout" | "cancelled" | "orphaned"

export type LoopRun = {
  id: string
  loopID: string
  startedAt: number
  endedAt?: number
  status: LoopRunStatus
  heartbeatAt?: number
  sessionID?: string
  error?: string
  ok: boolean
}

export type LoopTemplate = {
  id: string
  title: string
  description: string
  draft: {
    name?: string
    stages: Array<{
      name?: string
      agent?: string
      model?: string
      objective: string
      tokenBudget?: number
    }>
    intervalMs?: number
    maxRuns?: number
  }
}

export type LoopListResult = {
  loops: LoopDefinition[]
  runtimes: LoopRuntime[]
}

export type LoopDetailResult = {
  loop: LoopDefinition
  runtime: LoopRuntime
}

export type MissionFeatureStatus = "pending" | "running" | "done" | "blocked" | "skipped" | "error"
export type MissionMilestoneStatus = "pending" | "running" | "validating" | "done" | "blocked"
export type MissionStatus = "planning" | "ready" | "running" | "paused" | "frozen" | "complete" | "error"
export type MissionRuntimeStatus = "idle" | "running" | "paused" | "error" | "cancelling"
export type MissionValidation = "scrutiny" | "user-test" | "none"

export type MissionFeature = {
  id: string
  name: string
  objective: string
  agent: string
  model?: string
  tokenBudget?: number
  dependsOn: string[]
  status: MissionFeatureStatus
  error?: string
}

export type MissionMilestone = {
  id: string
  name: string
  features: MissionFeature[]
  validation: MissionValidation
  status: MissionMilestoneStatus
}

export type MissionDefinition = {
  id: string
  name: string
  brief: string
  milestones: MissionMilestone[]
  models: { worker?: string; validation?: string; orchestrator?: string }
  timeoutMs?: number
  sandbox?: boolean
  status: MissionStatus
  createdAt: number
}

export type MissionWriteInput = Omit<MissionDefinition, "id" | "createdAt" | "status">

export type MissionRuntime = {
  missionID: string
  status: MissionRuntimeStatus
  sessionID?: string
  currentMilestoneID?: string
  currentFeatureID?: string
  doneFeatures: number
  totalFeatures: number
  lastError?: string
  lastRunAt?: number
}

export type MissionExec = {
  id: string
  missionID: string
  kind: "feature" | "validation"
  targetID: string
  targetName: string
  startedAt: number
  endedAt?: number
  status: "running" | "complete" | "error" | "timeout" | "cancelled" | "orphaned"
  sessionID?: string
  error?: string
  ok: boolean
}

export type MissionTemplate = {
  id: string
  title: string
  description: string
  brief: string
}

export type MissionListResult = {
  missions: MissionDefinition[]
  runtimes: MissionRuntime[]
}

export type MissionDetailResult = {
  mission: MissionDefinition
  runtime: MissionRuntime
}

export type SessionTodo = {
  id: string
  content: string
  status: string
  priority: string
}

export type LspServerStatus = {
  id: string
  name: string
  root: string
  status: "connected" | "error"
}

export type ChatBotInfo = {
  name: string
  type: string
  running: boolean
  webhookPath: string
}

export type BrainStatus = {
  enabled: boolean
  memoryEnabled: boolean
  minHours: number
  minSessions: number
  lastBrainAt: number
  hoursSinceLastBrain: number
  sessionsSinceLastBrain: number
  shouldTrigger: boolean
  model?: { providerID: string; modelID: string }
}

export type BrainTriggerResult = {
  success: boolean
  sessionsReviewed: number
  hoursSinceLastBrain: number
  error?: string
  sessionID?: string
}

export type ObservabilityStatus = {
  enabled: boolean
  otlpEndpoint: string | null
}

export type FusionPreset = {
  name: string
  builtin: boolean
  enabled: boolean
}

export type HostCapability<T extends Record<string, unknown> = Record<string, unknown>> = {
  available: boolean
  reason?: string
} & T

export type HostEvent = {
  type: string
  properties?: Record<string, unknown>
}

// ── PTY (Terminal) ────────────────────────────────────────────────────────────

export type PtyInfo = {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: "running" | "exited"
  pid: number
}

export type PtyCreateInput = {
  command?: string
  args?: string[]
  cwd?: string
  title?: string
  env?: Record<string, string>
}

export type PtyUpdateInput = {
  title?: string
  size?: { rows: number; cols: number }
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
