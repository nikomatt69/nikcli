export type InstanceDisposeResult = boolean

export type Path = { home: string; state: string; config: string; worktree: string; directory: string }

export type VcsInfo = { branch?: string | undefined }

export type VcsFileStatus = {
  file: string
  additions: number
  deletions: number
  status: "added" | "deleted" | "modified"
}

export type VcsApplyResult = { applied: boolean }

export type Command = {
  name: string
  description?: string | undefined
  agent?: string | undefined
  model?: string | undefined
  mcp?: boolean | undefined
  skill?: boolean | undefined
  template: any
  subtask?: boolean | undefined
  hints: Array<string>
}

export type Agent = {
  name: string
  description?: string | undefined
  mode: "subagent" | "primary" | "all"
  native?: boolean | undefined
  hidden?: boolean | undefined
  topP?: number | undefined
  temperature?: number | undefined
  color?: string | undefined
  permission: Array<{ permission: string; pattern: string; action: "allow" | "deny" | "ask" }>
  model?: { modelID: string; providerID: string } | undefined
  advisor?: { model: { modelID: string; providerID: string }; maxUses?: number | undefined } | undefined
  variant?: string | undefined
  prompt?: string | undefined
  options: { [x: string]: any }
  steps?: number | undefined
}

export type Skill = {
  name: string
  description: string
  location: string
  category?: string | undefined
  tags?: Array<string> | undefined
  version?: string | undefined
}

export type LSPStatus = { id: string; name: string; root: string; status: "connected" | "error" }

export type FormatterStatus = { name: string; extensions: Array<string>; enabled: boolean }

export type AnalyticsTokenBreakdown = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

export type AnalyticsProviderStat = { sessions: number; messages: number; tokens: number; cost: number }

export type AnalyticsModelTokens = { input: number; output: number; reasoning: number }

export type AnalyticsProjectStat = { sessions: number; tokens: number; cost: number; lastActive: number }

export type AnalyticsDataModelStat = {
  model: string
  provider: string
  author: string
  tokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  sessions: number
  messages: number
  toolCalls: number
  costUsd: number
  share: number
  pricePerMillion: number
  costPerSession: number
  tokensPerSession: number
  cacheRatio: number | null
}

export type AnalyticsDataPeriodStat = {
  month: string | null
  tokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  messages: number
  toolCalls: number
  sessions: number
  costUsd: number
  models: number
  pricePerMillion: number
  costPerSession: number
  cacheRatio: number | null
}

export type AppSkillInfo = {
  name: string
  description: string
  location: string
  category?: string | undefined
  tags?: Array<string> | undefined
  version?: string | undefined
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
  model?: { providerID: string; modelID: string } | undefined
}

export type BrainResult = {
  success: boolean
  sessionsReviewed: number
  hoursSinceLastBrain: number
  error?: string | undefined
  sessionID?: string | undefined
}

export type ChatbotBot = { name: string; type: string; running: boolean; webhookPath: string }

export type ChatbotStartResult = { running: boolean; error?: string | undefined }

export type ChatbotStopResult = { removed: boolean }

export type VoiceTranscribeResult = { transcript: string; error?: string | undefined }

export type ProfileInfo = {
  version: number
  key: string
  name?: string | undefined
  role?: string | undefined
  about?: string | undefined
  stack?: Array<string> | undefined
  expertise?: Array<string> | undefined
  learning?: Array<string> | undefined
  skills?: Array<string> | undefined
  tools?: { preferred?: Array<string> | undefined; avoid?: Array<string> | undefined } | undefined
  conventions?: Array<string> | undefined
  communication?:
    | {
        verbosity?: "concise" | "balanced" | "detailed" | undefined
        language?: string | undefined
        explain?: boolean | undefined
      }
    | undefined
  custom?: string | undefined
  habits?: boolean | undefined
  updatedAt: number
}

export type ProfileDeleted = { deleted: boolean }

export type ProfileHabits = { content: string }

export type ProfilePreview = { lines: Array<string>; habitsFile: string }

export type KeybindsConfig = {
  leader?: string | undefined
  app_exit?: string | undefined
  editor_open?: string | undefined
  theme_list?: string | undefined
  sidebar_toggle?: string | undefined
  scrollbar_toggle?: string | undefined
  username_toggle?: string | undefined
  status_view?: string | undefined
  sync_view?: string | undefined
  session_export?: string | undefined
  session_new?: string | undefined
  session_list?: string | undefined
  session_timeline?: string | undefined
  session_fork?: string | undefined
  session_rename?: string | undefined
  session_delete?: string | undefined
  session_pin_toggle?: string | undefined
  session_scope_toggle?: string | undefined
  session_tab_back?: string | undefined
  session_tab_forward?: string | undefined
  session_quick_switch_1?: string | undefined
  session_quick_switch_2?: string | undefined
  session_quick_switch_3?: string | undefined
  session_quick_switch_4?: string | undefined
  session_quick_switch_5?: string | undefined
  session_quick_switch_6?: string | undefined
  session_quick_switch_7?: string | undefined
  session_quick_switch_8?: string | undefined
  session_quick_switch_9?: string | undefined
  stash_delete?: string | undefined
  model_provider_list?: string | undefined
  model_favorite_toggle?: string | undefined
  session_share?: string | undefined
  session_unshare?: string | undefined
  session_interrupt?: string | undefined
  session_codebro_open?: string | undefined
  subtask_background?: string | undefined
  subtask_picker?: string | undefined
  session_compact?: string | undefined
  messages_page_up?: string | undefined
  messages_page_down?: string | undefined
  messages_line_up?: string | undefined
  messages_line_down?: string | undefined
  messages_half_page_up?: string | undefined
  messages_half_page_down?: string | undefined
  messages_first?: string | undefined
  messages_last?: string | undefined
  messages_next?: string | undefined
  messages_previous?: string | undefined
  messages_last_user?: string | undefined
  messages_copy?: string | undefined
  messages_undo?: string | undefined
  messages_redo?: string | undefined
  messages_toggle_conceal?: string | undefined
  tool_details?: string | undefined
  model_list?: string | undefined
  model_cycle_recent?: string | undefined
  model_cycle_recent_reverse?: string | undefined
  model_cycle_favorite?: string | undefined
  model_cycle_favorite_reverse?: string | undefined
  command_list?: string | undefined
  agent_list?: string | undefined
  agent_cycle?: string | undefined
  agent_cycle_reverse?: string | undefined
  permission_mode?: string | undefined
  variant_cycle?: string | undefined
  input_clear?: string | undefined
  input_paste?: string | undefined
  input_submit?: string | undefined
  input_newline?: string | undefined
  input_move_left?: string | undefined
  input_move_right?: string | undefined
  input_move_up?: string | undefined
  input_move_down?: string | undefined
  input_select_left?: string | undefined
  input_select_right?: string | undefined
  input_select_up?: string | undefined
  input_select_down?: string | undefined
  input_line_home?: string | undefined
  input_line_end?: string | undefined
  input_select_line_home?: string | undefined
  input_select_line_end?: string | undefined
  input_visual_line_home?: string | undefined
  input_visual_line_end?: string | undefined
  input_select_visual_line_home?: string | undefined
  input_select_visual_line_end?: string | undefined
  input_buffer_home?: string | undefined
  input_buffer_end?: string | undefined
  input_select_buffer_home?: string | undefined
  input_select_buffer_end?: string | undefined
  input_delete_line?: string | undefined
  input_delete_to_line_end?: string | undefined
  input_delete_to_line_start?: string | undefined
  input_backspace?: string | undefined
  input_delete?: string | undefined
  input_undo?: string | undefined
  input_redo?: string | undefined
  input_word_forward?: string | undefined
  input_word_backward?: string | undefined
  input_select_word_forward?: string | undefined
  input_select_word_backward?: string | undefined
  input_delete_word_forward?: string | undefined
  input_delete_word_backward?: string | undefined
  history_previous?: string | undefined
  history_next?: string | undefined
  session_child_cycle?: string | undefined
  session_child_cycle_reverse?: string | undefined
  session_parent?: string | undefined
  session_child_close?: string | undefined
  terminal_suspend?: string | undefined
  terminal_title_toggle?: string | undefined
  tips_toggle?: string | undefined
  voice_record?: string | undefined
  app_support?: string | undefined
}

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR"

export type AdsItemConfig = { id: string; text: string; url?: string | undefined; enabled?: boolean | undefined }

export type ServerConfig = {
  port?: number | undefined
  hostname?: string | undefined
  mdns?: boolean | undefined
  cors?: Array<string> | undefined
}

export type RemoteConfig = {
  enabled?: boolean | undefined
  enableTunnel?: boolean | undefined
  provider?: "localtunnel" | "cloudflared" | "ngrok" | "remotosh" | "none" | undefined
  askOnExistingSession?: boolean | undefined
}

export type TeleportConfig = { url?: string | undefined; token?: string | undefined }

export type ReferenceConfig =
  | { type: "git"; repository: string; branch?: string | undefined; description?: string | undefined }
  | { type: "local"; path: string; description?: string | undefined }

export type PermissionActionConfig = "ask" | "allow" | "deny"

export type ProviderConfig = {
  api?: string | undefined
  name?: string | undefined
  env?: Array<string> | undefined
  id?: string | undefined
  npm?: string | undefined
  models?:
    | {
        [x: string]: {
          id?: string | undefined
          name?: string | undefined
          family?: string | undefined
          release_date?: string | undefined
          attachment?: boolean | undefined
          reasoning?: boolean | undefined
          temperature?: boolean | undefined
          tool_call?: boolean | undefined
          interleaved?: true | { field: "reasoning_content" | "reasoning_details" } | undefined
          cost?:
            | {
                input: number
                output: number
                cache_read?: number | undefined
                cache_write?: number | undefined
                context_over_200k?:
                  | { input: number; output: number; cache_read?: number | undefined; cache_write?: number | undefined }
                  | undefined
              }
            | undefined
          limit?: { context: number; input?: number | undefined; output: number } | undefined
          modalities?:
            | {
                input: Array<"text" | "audio" | "image" | "video" | "pdf">
                output: Array<"text" | "audio" | "image" | "video" | "pdf">
              }
            | undefined
          experimental?: boolean | undefined
          status?: "alpha" | "beta" | "deprecated" | undefined
          options?: { [x: string]: any } | undefined
          headers?: { [x: string]: string } | undefined
          provider?: { npm: string; api: string } | undefined
          reasoning_options?:
            | Array<
                | { type: "effort"; values: Array<string | null> }
                | { type: "toggle" }
                | { type: "budget_tokens"; min?: number | undefined; max?: number | undefined }
              >
            | undefined
          variants?: { [x: string]: { disabled?: boolean | undefined; [x: string]: any | undefined } } | undefined
          disabled?: boolean | undefined
        }
      }
    | undefined
  auth_provider?: string | undefined
  whitelist?: Array<string> | undefined
  blacklist?: Array<string> | undefined
  options?:
    | {
        apiKey?: string | undefined
        baseURL?: string | undefined
        enterpriseUrl?: string | undefined
        setCacheKey?: boolean | undefined
        timeout?: number | false | undefined
        headerTimeout?: number | false | undefined
        chunkTimeout?: number | undefined
        [x: string]: any | undefined
      }
    | undefined
}

export type McpLocalConfig = {
  type: "local"
  command: Array<string>
  environment?: { [x: string]: string } | undefined
  enabled?: boolean | undefined
  timeout?: number | undefined
}

export type McpOAuthConfig = {
  clientId?: string | undefined
  clientSecret?: string | undefined
  scope?: string | undefined
}

export type ConnectorFigma = { type: "figma"; token?: string | undefined; enabled?: boolean | undefined }

export type ConnectorSlack = {
  type: "slack"
  botToken?: string | undefined
  teamId?: string | undefined
  enabled?: boolean | undefined
}

export type ConnectorGithub = {
  type: "github"
  token?: string | undefined
  oauthClientId?: string | undefined
  clientId?: string | undefined
  enabled?: boolean | undefined
}

export type ConnectorLovable = {
  type: "lovable"
  token?: string | undefined
  apiKey?: string | undefined
  enabled?: boolean | undefined
}

export type ConnectorDiscord = { type: "discord"; botToken?: string | undefined; enabled?: boolean | undefined }

export type ConnectorTeams = { type: "teams"; botToken?: string | undefined; enabled?: boolean | undefined }

export type ConnectorGChat = { type: "gchat"; botToken?: string | undefined; enabled?: boolean | undefined }

export type ConnectorLinear = { type: "linear"; botToken?: string | undefined; enabled?: boolean | undefined }

export type LayoutConfig = "auto" | "stretch"

export type PolicyStatementConfig = { effect: "allow" | "deny"; action: string; resource: string }

export type RagConfig = { model?: string | undefined; provider?: string | undefined }

export type ImageConfig = { model?: string | undefined; provider?: string | undefined }

export type ComputerConfig = {
  mode?: "sandbox" | "host" | undefined
  width?: number | undefined
  height?: number | undefined
}

export type AttachmentConfig = {
  image?:
    | {
        auto_resize?: boolean | undefined
        max_width?: number | undefined
        max_height?: number | undefined
        max_base64_bytes?: number | undefined
      }
    | undefined
}

export type SpeakConfig = {
  provider?: string | undefined
  model?: string | undefined
  modelId?: string | undefined
  outputFormat?: string | undefined
}

export type Model = {
  id: string
  providerID: string
  api: { id: string; url?: string | undefined; npm: string }
  name: string
  family?: string | undefined
  capabilities: {
    temperature: boolean
    reasoning: boolean
    attachment: boolean
    toolcall: boolean
    input: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean }
    output: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean }
    interleaved: boolean | { field: "reasoning_content" | "reasoning_details" }
  }
  cost: {
    input: number
    output: number
    cache: { read: number; write: number }
    experimentalOver200K?: { input: number; output: number; cache: { read: number; write: number } } | undefined
  }
  limit: { context: number; input?: number | undefined; output: number }
  status: "alpha" | "beta" | "deprecated" | "active"
  options: { [x: string]: any }
  headers: { [x: string]: string }
  release_date: string
  variants?: { [x: string]: { [x: string]: any } } | undefined
}

export type ConnectorStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string }
  | { status: "needs_auth" }

export type ConnectorsSuccess = { success: true }

export type DoctorCheck = { ok: boolean; label: string; detail?: string | undefined; fix?: string | undefined }

export type ToolIDs = Array<string>

export type ToolListItem = { id: string; description: string; parameters: any }

export type Worktree = { name: string; branch?: string | undefined; directory: string }

export type WorktreeList = Array<string>

export type McpResource = {
  name: string
  uri: string
  description?: string | undefined
  mimeType?: string | undefined
  client: string
}

export type ManagedWorktreeInfo = {
  id: string
  parentId: string | null
  name: string
  branch: string
  directory: string
  createdAt: number
}

export type SearchMatch = {
  path: { text: string }
  lines: { text: string }
  line_number: number
  absolute_offset: number
  submatches: Array<{ match: { text: string }; start: number; end: number }>
}

export type Symbol = {
  name: string
  kind: number
  location: {
    uri: string
    range: { start: { line: number; character: number }; end: { line: number; character: number } }
  }
}

export type FileNode = { name: string; path: string; absolute: string; type: "file" | "directory"; ignored: boolean }

export type FileContent = {
  type: "text"
  content: string
  diff?: string | undefined
  patch?:
    | {
        oldFileName: string
        newFileName: string
        oldHeader?: string | undefined
        newHeader?: string | undefined
        hunks: Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number; lines: Array<string> }>
        index?: string | undefined
      }
    | undefined
  encoding?: "base64" | undefined
  mimeType?: string | undefined
}

export type FileWriteResult = { success: boolean }

export type File = { path: string; added: number; removed: number; status: "added" | "deleted" | "modified" }

export type GlobalHealth = { healthy: true; version: string }

export type MCPStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string }
  | { status: "needs_auth" }
  | { status: "needs_client_registration"; error: string }

export type McpStartAuthResponse = { authorizationUrl: string }

export type McpMutationSuccess = { success: true }

export type MissionFeature = {
  id: string
  name: string
  objective: string
  agent: string
  model?: string | undefined
  tokenBudget?: number | undefined
  dependsOn: Array<string>
  status: "pending" | "running" | "done" | "blocked" | "skipped" | "error"
  error?: string | undefined
}

export type MissionModels = {
  worker?: string | undefined
  validation?: string | undefined
  orchestrator?: string | undefined
}

export type MissionWorktree = { name: string; branch?: string | undefined; directory: string }

export type MissionRuntime = {
  missionID: string
  status: "idle" | "running" | "paused" | "error" | "cancelling"
  sessionID?: string | undefined
  currentMilestoneID?: string | undefined
  currentFeatureID?: string | undefined
  doneFeatures: number
  totalFeatures: number
  lastError?: string | undefined
  lastRunAt?: number | undefined
}

export type MissionTemplate = { id: string; title: string; description: string; brief: string }

export type MissionExec = {
  id: string
  missionID: string
  kind: "feature" | "validation"
  targetID: string
  targetName: string
  startedAt: number
  endedAt?: number | undefined
  status: "running" | "complete" | "error" | "timeout" | "cancelled" | "orphaned"
  heartbeatAt?: number | undefined
  sessionID?: string | undefined
  error?: string | undefined
  ok: boolean
}

export type MissionBooleanResult = boolean

export type MobileAuthTokenPublic = {
  id: string
  name: string
  createdAt: number
  lastUsedAt?: number | undefined
  expiresAt?: number | undefined
  scope?: string | undefined
}

export type MobileProject = any

export type MobileCommand = {
  name: string
  description?: string | undefined
  agent?: string | undefined
  model?: string | undefined
  mcp?: boolean | undefined
  skill?: boolean | undefined
  subtask?: boolean | undefined
  hints: Array<string>
}

export type MobilePromptHistoryEntry = {
  id: string
  input: string
  mode?: "normal" | "shell" | undefined
  partsCount: number
}

export type MobileMemorySearchHit = {
  id: string
  sessionID: string
  sessionTitle: string
  messageID: string
  role: "user" | "assistant"
  createdAt: number
  preview: string
}

export type MobilePromptStashEntry = { id: string; input: string; timestamp: number; partsCount: number }

export type MobileSuccess = { success: true }

export type MobileGithubBranch = { name: string; protected?: boolean | undefined; commit: { sha: string } }

export type MobileGithubImport = {
  owner: string
  repo: string
  fullName: string
  directory: string
  cloneUrl: string
  defaultBranch: string
  private: boolean
  importedAt: number
  updatedAt: number
  projectID?: string | undefined
}

export type MobileConfigInfo = { [x: string]: any }

export type MobileGithubDeviceAuthStart = {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete?: string | undefined
  expiresAt: number
  interval: number
}

export type MobileGithubDeviceAuthPollResult = {
  status: "pending" | "approved" | "denied" | "expired"
  interval?: number | undefined
  user?: { login: string; name?: string | null | undefined; avatar_url?: string | undefined } | undefined
}

export type Project = {
  id: string
  worktree: string
  canonical: string
  vcs?: "git" | undefined
  name?: string | undefined
  icon?: { url?: string | undefined; override?: string | undefined; color?: string | undefined } | undefined
  commands?: { start?: string | undefined } | undefined
  time: { created: number; updated: number; initialized?: number | undefined }
  sandboxes: Array<string>
}

export type FileDiff = {
  file: string
  patch: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified" | undefined
  before: string
  after: string
}

export type SessionWorktree = {
  name: string
  branch: string
  directory: string
  repositoryDirectory?: string | undefined
  cleanedAt?: number | undefined
}

export type SessionMobile = {
  platforms: Array<"ios" | "android" | "expo" | "flutter" | "react-native">
  primaryPlatform: string
  method: string
  detectedAt: number
  buildStatus?: "unknown" | "building" | "succeeded" | "failed" | undefined
  lastBuildAt?: number | undefined
  artifacts?:
    | Array<{ platform: string; path: string; size?: number | undefined; createdAt?: number | undefined }>
    | undefined
}

export type PermissionAction = "allow" | "deny" | "ask"

export type Workspace = {
  id: string
  name: string
  timeUsed: number
  branch: string | null
  projectID: string
  config:
    | {
        directory: string
        type: "worktree"
        name?: string | undefined
        strategy?: "git" | "cow" | undefined
        eventLimit?: number | undefined
      }
    | {
        directory: string
        type: "container"
        runtime: "docker" | "podman"
        image: string
        containerName: string
        port: number
        serverUrl: string
        eventLimit?: number | undefined
      }
    | { directory: string; type: "branch"; branch?: string | undefined; eventLimit?: number | undefined }
}

export type OutputFormatText = { type: "text" }

export type JSONSchema = { [x: string]: any }

export type ProviderAuthError = { name: "ProviderAuthError"; data: { providerID: string; message: string } }

export type UnknownError = { name: "UnknownError"; data: { message: string } }

export type MessageOutputLengthError = { name: "MessageOutputLengthError"; data: {} }

export type MessageContextOverflowError = {
  name: "MessageContextOverflowError"
  data: { message: string; statusCode?: number | undefined; responseBody?: string | undefined }
}

export type MessageAbortedError = { name: "MessageAbortedError"; data: { message: string } }

export type StructuredOutputError = { name: "StructuredOutputError"; data: { message: string; retries: number } }

export type APIError = {
  name: "APIError"
  data: {
    message: string
    statusCode?: number | undefined
    isRetryable: boolean
    responseHeaders?: { [x: string]: string } | undefined
    responseBody?: string | undefined
    metadata?: { [x: string]: string } | undefined
    classification?: "payload-too-large" | undefined
  }
}

export type TextPart = {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
  synthetic?: boolean | undefined
  ignored?: boolean | undefined
  time?: { start: number; end?: number | undefined } | undefined
  metadata?: { [x: string]: any } | undefined
}

export type SubtaskPart = {
  id: string
  sessionID: string
  messageID: string
  type: "subtask"
  prompt: string
  description: string
  agent: string
  model?: { providerID: string; modelID: string } | undefined
  command?: string | undefined
  background?: boolean | undefined
}

export type ReasoningPart = {
  id: string
  sessionID: string
  messageID: string
  type: "reasoning"
  text: string
  metadata?: { [x: string]: any } | undefined
  time: { start: number; end?: number | undefined }
}

export type FilePartSourceText = { value: string; start: number; end: number }

export type Range = { start: { line: number; character: number }; end: { line: number; character: number } }

export type ToolStatePending = { status: "pending"; input: { [x: string]: any }; raw: string }

export type ToolStateRunning = {
  status: "running"
  input: { [x: string]: any }
  title?: string | undefined
  metadata?: { [x: string]: any } | undefined
  structured?: { [x: string]: any } | undefined
  content?:
    | Array<{ type: "text"; text: string } | { type: "file"; data: string; mime: string; name?: string | undefined }>
    | undefined
  time: { start: number }
}

export type ToolStateError = {
  status: "error"
  input: { [x: string]: any }
  error: string
  metadata?: { [x: string]: any } | undefined
  time: { start: number; end: number }
}

export type StepStartPart = {
  id: string
  sessionID: string
  messageID: string
  type: "step-start"
  snapshot?: string | undefined
}

export type StepFinishPart = {
  id: string
  sessionID: string
  messageID: string
  type: "step-finish"
  reason: string
  snapshot?: string | undefined
  cost: number
  tokens: {
    total?: number | undefined
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

export type SnapshotPart = { id: string; sessionID: string; messageID: string; type: "snapshot"; snapshot: string }

export type PatchPart = {
  id: string
  sessionID: string
  messageID: string
  type: "patch"
  hash: string
  files: Array<string>
}

export type AgentPart = {
  id: string
  sessionID: string
  messageID: string
  type: "agent"
  name: string
  source?: { value: string; start: number; end: number } | undefined
}

export type CompactionPart = { id: string; sessionID: string; messageID: string; type: "compaction"; auto: boolean }

export type MobileGithubPublishResult = {
  commitSha: string
  branch: string
  pullRequest: { number: number; url: string; title: string }
}

export type MobileTeleportResult = {
  sessionID: string
  title?: string | undefined
  messageCount: number
  directory?: string | undefined
  workspace: boolean
}

export type MobileGitChange = {
  status: "added" | "modified" | "deleted" | "renamed"
  path: string
  additions?: number | undefined
  deletions?: number | undefined
  oldPath?: string | undefined
}

export type MobileGitFileDiff = {
  file: string
  oldPath?: string | undefined
  hunks: Array<{
    header: { oldStart: number; oldLines: number; newStart: number; newLines: number }
    lines: Array<{
      type: "add" | "remove" | "context"
      text: string
      oldLineNumber?: number | undefined
      newLineNumber?: number | undefined
    }>
  }>
  isBinary: boolean
  additions: number
  deletions: number
}

export type MobileGitCommit = {
  sha: string
  message: string
  author: { name: string; email: string }
  timestamp: number
  filesCount: number
  additions: number
  deletions: number
}

export type MobileGitBranch = {
  name: string
  isCurrent: boolean
  isProtected: boolean
  aheadBy: number
  behindBy: number
}

export type LoopStage = {
  name: string
  agent: string
  model?: string | undefined
  objective: string
  tokenBudget?: number | undefined
}

export type LoopTrigger = { kind: "manual" } | { kind: "interval"; everyMs: number }

export type LoopWorktree = { name: string; branch?: string | undefined; directory: string }

export type MobileLoopRuntime = {
  loopID: string
  status: "idle" | "running" | "paused" | "error" | "cancelling"
  runs: number
  lastRunAt?: number | undefined
  lastError?: string | undefined
  sessionID?: string | undefined
}

export type LoopPullRequestRef = {
  number: number
  url: string
  branch: string
  base: string
  title?: string | undefined
  action: "created" | "updated"
}

export type RoutineTriggerSchedule = { type: "schedule"; cron: string; enabled: boolean }

export type RoutineTriggerApi = { type: "api"; token: string; enabled: boolean }

export type Pty = {
  id: string
  title: string
  command: string
  args: Array<string>
  cwd: string
  status: "running" | "exited"
  pid: number
}

export type ProjectDirectory = { directory: string; strategy?: string | undefined }

export type ProjectCopy = { directory: string }

export type ProjectCopyRefresh = { updated: Array<string>; removed: Array<string> }

export type ProviderAuthMethod = { type: "oauth" | "api"; label: string }

export type ProviderMutationSuccess = { success: true }

export type ProviderOAuthAuthorization = { url: string; method: "auto" | "code" | "auto-code"; instructions: string }

export type QuestionOption = { label: string; description: string }

export type PermissionRequest = {
  id: string
  sessionID: string
  permission: string
  patterns: Array<string>
  metadata: { [x: string]: any }
  always: Array<string>
  tool?: { messageID: string; callID: string } | undefined
}

export type Pty1 = {
  id: string
  title: string
  command: string
  args: Array<string>
  cwd: string
  status: "running" | "exited"
  pid: number
}

export type LoopRuntime = {
  loopID: string
  status: "idle" | "running" | "paused" | "error" | "cancelling"
  runs: number
  lastRunAt?: number | undefined
  lastError?: string | undefined
  sessionID?: string | undefined
}

export type LoopTemplate = {
  id: string
  title: string
  description: string
  draft: {
    name?: string | undefined
    stages: Array<{
      name?: string | undefined
      agent?: string | undefined
      model?: string | undefined
      objective: string
      tokenBudget?: number | undefined
    }>
    intervalMs?: number | undefined
    maxRuns?: number | undefined
  }
}

export type LoopBooleanResult = boolean

export type SessionStatus =
  | { type: "idle" }
  | { type: "retry"; attempt: number; message: string; next: number }
  | { type: "busy"; since: number }
  | { type: "busy" }

export type BooleanResult = boolean

export type Todo = { content: string; status: string; priority: string; id: string }

export type TextPartInput = {
  type: "text"
  text: string
  synthetic?: boolean | undefined
  ignored?: boolean | undefined
  time?: { start: number; end?: number | undefined } | undefined
  metadata?: { [x: string]: any } | undefined
  id?: string | undefined
}

export type AgentPartInput = {
  type: "agent"
  name: string
  source?: { value: string; start: number; end: number } | undefined
  id?: string | undefined
}

export type SubtaskPartInput = {
  type: "subtask"
  prompt: string
  description: string
  agent: string
  model?: { providerID: string; modelID: string } | undefined
  command?: string | undefined
  background?: boolean | undefined
  id?: string | undefined
}

export type SessionV2EntryList = Array<any>

export type SessionV2State = any

export type SessionV2EventList = Array<any>

export type SessionInstructionList = Array<{ path: string; name: string }>

export type SessionContextSource = {
  id: string
  category: "system" | "instructions" | "skills" | "mcp" | "tools" | "agents" | "messages"
  label: string
  detail?: string | undefined
  tokens: number
  enabled: boolean
  togglable: boolean
  toggleKind?: "mcp" | "skill" | "instruction" | "tool" | undefined
  toggleKey?: string | undefined
}

export type SessionGoalState = {
  sessionID: string
  goalID: string
  objective: string
  status: "active" | "paused" | "blocked" | "usage_limited" | "budget_limited" | "complete"
  tokenBudget?: number | undefined
  tokensUsed: number
  timeUsedSeconds: number
  iterationCount: number
  timeCreated: number
  timeUpdated: number
}

export type DelegationJob = {
  jobID: string
  rootDelegationID: string
  parentSessionID: string
  title: string
  agent: string
  parentAgent?: string | undefined
  status: "running" | "complete" | "error" | "timeout" | "cancelled" | "orphaned" | "synthesizing"
  source?:
    | "task"
    | "model-subtask"
    | "advisor"
    | "research"
    | "ultrareview"
    | "delegator"
    | "delegator-followup"
    | "loop"
    | "other"
    | undefined
  workerSessionID?: string | undefined
  delegatorID?: string | undefined
  delegatorSessionID?: string | undefined
  createdAt: number
  updatedAt: number
  completedAt?: number | undefined
  lastActivityAt?: number | undefined
  progressSummary?: string | undefined
  resultSummary?: string | undefined
  error?: string | undefined
}

export type SessionMonitorOutput2 = {
  id: string
  sessionID: string
  messageID: string
  callID: string
  partID?: string | null
  title: string
  command: string
  cwd: string
  agent: string
  wake: boolean
  timeoutMs?: number | "Infinity" | "-Infinity" | "NaN" | null
  status: "running" | "complete" | "error" | "timeout" | "cancelled"
  pid?: number | "Infinity" | "-Infinity" | "NaN" | null
  exitCode?: number | "Infinity" | "-Infinity" | "NaN" | null
  signal?: string | null
  logPath: string
  commandPath: string
  pidPath: string
  exitCodePath: string
  preview?: string | null | null
  bytes?: number | "Infinity" | "-Infinity" | "NaN" | null | null
  time: {
    created: number | "Infinity" | "-Infinity" | "NaN"
    updated: number | "Infinity" | "-Infinity" | "NaN"
    completed?: number | "Infinity" | "-Infinity" | "NaN" | null
  }
} | null

export type SessionMonitorLogOutput2 = {
  record: {
    id: string
    sessionID: string
    messageID: string
    callID: string
    partID?: string | null
    title: string
    command: string
    cwd: string
    agent: string
    wake: boolean
    timeoutMs?: number | "Infinity" | "-Infinity" | "NaN" | null
    status: "running" | "complete" | "error" | "timeout" | "cancelled"
    pid?: number | "Infinity" | "-Infinity" | "NaN" | null
    exitCode?: number | "Infinity" | "-Infinity" | "NaN" | null
    signal?: string | null
    logPath: string
    commandPath: string
    pidPath: string
    exitCodePath: string
    preview?: string | null | null
    bytes?: number | "Infinity" | "-Infinity" | "NaN" | null | null
    time: {
      created: number | "Infinity" | "-Infinity" | "NaN"
      updated: number | "Infinity" | "-Infinity" | "NaN"
      completed?: number | "Infinity" | "-Infinity" | "NaN" | null
    }
  }
  output: string
  truncated: boolean
} | null

export type SyncOutboxResponse = { events: Array<any>; hasMore: boolean }

export type SyncSnapshotResponse = { lastSeq: number; state: any }

export type SyncStatsEvent = {
  id: string
  projectId: string
  workspaceId?: string | undefined
  aggregate: string
  seq: number
  type: string
  timestamp: number
  origin: string
  dataPreview: any
}

export type SyncConfigSetResponse = {
  configured: boolean
  url?: string | undefined
  source?: "env" | "config" | undefined
  started: boolean
  error?: string | undefined
}

export type TuiBooleanResult = boolean

export type PluginOptionsConfig = { [x: string]: any }

export type TuiControlRequest = { path: string; body: any }

export type WorkspaceAdaptorInfo = { type: string; name: string; description: string; available?: boolean | undefined }

export type WorkspaceConnectionStatus = {
  workspaceID: string
  status: "connected" | "connecting" | "disconnected" | "error"
}

export type WorkspaceConfig =
  | { type: "worktree"; directory: string; strategy?: "git" | "cow" | undefined; eventLimit?: number | undefined }
  | {
      type: "container"
      directory: string
      runtime: "docker" | "podman"
      image: string
      containerName: string
      port: number
      serverUrl: string
      eventLimit?: number | undefined
    }
  | { type: "branch"; directory: string; branch?: string | undefined; eventLimit?: number | undefined }

export type WorkspaceRestore = { workspaceID: string; sessions: Array<string>; events: Array<any> }

export type WorkspaceSessionRestore = {
  workspaceID: string
  sessionID: string
  sessions: Array<string>
  events: Array<any>
}

export type ConfigReloadResponse = { reloaded: boolean; directory: string }

export type SuccessFlag = { success: boolean }

export type EventTelemetryRecord = {
  type: "telemetry.record"
  properties: {
    id: string
    traceId: string
    parentId?: string | undefined
    name: string
    kind: string
    startTime: number
    durationMs: number
    statusCode?: number | undefined
    statusMessage?: string | undefined
    attributes?: { [x: string]: string } | undefined
  }
}

export type EventServerInstanceDisposed = { type: "server.instance.disposed"; properties: { directory: string } }

export type PermissionRequest1 = {
  id: string
  sessionID: string
  permission: string
  patterns: Array<string>
  metadata: { [x: string]: any }
  always: Array<string>
  tool?: { messageID: string; callID: string } | undefined
}

export type EventPermissionReplied = {
  type: "permission.replied"
  properties: { sessionID: string; requestID: string; reply: "once" | "always" | "reject" }
}

export type QuestionOption1 = { label: string; description: string }

export type QuestionAnswer = Array<string>

export type EventQuestionRejected = { type: "question.rejected"; properties: { sessionID: string; requestID: string } }

export type EventInstallationUpdated = { type: "installation.updated"; properties: { version: string } }

export type EventInstallationUpdateAvailable = {
  type: "installation.update-available"
  properties: {
    version: string
    method?: "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown" | undefined
    current?: string | undefined
  }
}

export type EventServerConnected = { type: "server.connected"; properties: {} }

export type EventGlobalDisposed = { type: "global.disposed"; properties: {} }

export type EventLspUpdated = { type: "lsp.updated"; properties: {} }

export type EventMessageRemoved = { type: "message.removed"; properties: { sessionID: string; messageID: string } }

export type EventMessagePartRemoved = {
  type: "message.part.removed"
  properties: { sessionID: string; messageID: string; partID: string }
}

export type EventSessionPendingPromoted = {
  type: "session.pending.promoted"
  properties: { sessionID: string; pendingIDs: Array<string>; messageIDs: Array<string> }
}

export type EventSessionInstructionsUpdated = {
  type: "session.instructions.updated"
  properties: { sessionID: string; delta: { [x: string]: string | "removed" } }
}

export type EventTuiPromptAppend = { type: "tui.prompt.append"; properties: { text: string } }

export type EventTuiCommandExecute = {
  type: "tui.command.execute"
  properties: {
    command:
      | "session.list"
      | "session.new"
      | "session.share"
      | "session.interrupt"
      | "session.compact"
      | "session.page.up"
      | "session.page.down"
      | "session.line.up"
      | "session.line.down"
      | "session.half.page.up"
      | "session.half.page.down"
      | "session.first"
      | "session.last"
      | "prompt.clear"
      | "prompt.submit"
      | "agent.cycle"
      | string
  }
}

export type EventTuiToastShow = {
  type: "tui.toast.show"
  properties: {
    title?: string | undefined
    message: string
    variant: "info" | "success" | "warning" | "error"
    duration: number
  }
}

export type EventTuiSessionSelect = { type: "tui.session.select"; properties: { sessionID: string } }

export type EventMcpToolsChanged = { type: "mcp.tools.changed"; properties: { server: string } }

export type EventFileWatcherUpdated = {
  type: "file.watcher.updated"
  properties: { file: string; event: "add" | "change" | "unlink" }
}

export type EventVcsBranchUpdated = { type: "vcs.branch.updated"; properties: { branch?: string | undefined } }

export type EventSessionIdle = { type: "session.idle"; properties: { sessionID: string } }

export type EventSessionCompacted = { type: "session.compacted"; properties: { sessionID: string } }

export type EventIdeInstalled = { type: "ide.installed"; properties: { ide: string } }

export type EventPtyExited = { type: "pty.exited"; properties: { id: string; exitCode: number } }

export type EventPtyDeleted = { type: "pty.deleted"; properties: { id: string } }

export type EventSessionV2Updated = { type: "session.v2.updated"; properties: { sessionID: string } }

export type EventSessionEntryUpdated = { type: "session.entry.updated"; properties: { sessionID: string; entry: any } }

export type EventSessionEntryRemoved = {
  type: "session.entry.removed"
  properties: { sessionID: string; entryID: string }
}

export type EventFileEdited = { type: "file.edited"; properties: { file: string } }

export type EventMonitorCreated = {
  type: "monitor.created"
  properties: {
    sessionID: string
    record: {
      id: string
      sessionID: string
      messageID: string
      callID: string
      partID?: string | undefined
      title: string
      command: string
      cwd: string
      agent: string
      wake: boolean
      timeoutMs?: number | undefined
      status: "running" | "complete" | "error" | "timeout" | "cancelled"
      pid?: number | undefined
      exitCode?: number | undefined
      signal?: string | undefined
      logPath: string
      commandPath: string
      pidPath: string
      exitCodePath: string
      preview?: string | undefined | undefined
      bytes?: number | undefined | undefined
      time: { created: number; updated: number; completed?: number | undefined }
    }
  }
}

export type EventMonitorUpdated = {
  type: "monitor.updated"
  properties: {
    sessionID: string
    record: {
      id: string
      sessionID: string
      messageID: string
      callID: string
      partID?: string | undefined
      title: string
      command: string
      cwd: string
      agent: string
      wake: boolean
      timeoutMs?: number | undefined
      status: "running" | "complete" | "error" | "timeout" | "cancelled"
      pid?: number | undefined
      exitCode?: number | undefined
      signal?: string | undefined
      logPath: string
      commandPath: string
      pidPath: string
      exitCodePath: string
      preview?: string | undefined | undefined
      bytes?: number | undefined | undefined
      time: { created: number; updated: number; completed?: number | undefined }
    }
  }
}

export type EventMonitorOutput = {
  type: "monitor.output"
  properties: {
    sessionID: string
    monitorID: string
    delta: string
    preview: string
    bytes: number
    status: "running" | "complete" | "error" | "timeout" | "cancelled"
  }
}

export type EventMonitorCompleted = {
  type: "monitor.completed"
  properties: {
    sessionID: string
    monitorID: string
    title: string
    status: "running" | "complete" | "error" | "timeout" | "cancelled"
    exitCode: number | null
    logPath: string
    wake: boolean
  }
}

export type EventLoopUpserted = { type: "loop.upserted"; properties: { loopID: string } }

export type EventLoopRemoved = { type: "loop.removed"; properties: { loopID: string } }

export type EventLoopRunStarted = {
  type: "loop.run.started"
  properties: { loopID: string; runID: string; sessionID: string }
}

export type EventLoopRunFinished = {
  type: "loop.run.finished"
  properties: {
    loopID: string
    runID: string
    sessionID?: string | undefined
    status: "running" | "complete" | "error" | "timeout" | "cancelled" | "orphaned"
    ok: boolean
    error?: string | undefined
  }
}

export type EventLoopRuntimeChanged = { type: "loop.runtime.changed"; properties: { loopID: string } }

export type EventMissionUpserted = { type: "mission.upserted"; properties: { missionID: string } }

export type EventMissionRemoved = { type: "mission.removed"; properties: { missionID: string } }

export type EventMissionStarted = { type: "mission.started"; properties: { missionID: string } }

export type EventMissionFinished = {
  type: "mission.finished"
  properties: { missionID: string; status: "complete" | "error" | "paused" | "frozen"; error?: string | undefined }
}

export type EventMissionExecStarted = {
  type: "mission.exec.started"
  properties: {
    missionID: string
    execID: string
    kind: "feature" | "validation"
    targetID: string
    targetName: string
    sessionID: string
  }
}

export type EventMissionExecFinished = {
  type: "mission.exec.finished"
  properties: {
    missionID: string
    execID: string
    kind: "feature" | "validation"
    targetID: string
    status: "running" | "complete" | "error" | "timeout" | "cancelled" | "orphaned"
    ok: boolean
    error?: string | undefined
  }
}

export type EventMissionRuntimeChanged = { type: "mission.runtime.changed"; properties: { missionID: string } }

export type EventMissionAborted = { type: "mission.aborted"; properties: { missionID: string; reason: string } }

export type EventWorkspaceStatus = {
  type: "workspace.status"
  properties: { workspaceID: string; status: "connecting" | "connected" | "disconnected" | "error" }
}

export type EventWorkspaceReady = { type: "workspace.ready"; properties: { name: string } }

export type EventWorkspaceFailed = { type: "workspace.failed"; properties: { message: string } }

export type EventDelegationCompleted = {
  type: "delegation.completed"
  properties: {
    delegationID: string
    parentSessionID: string
    status: "running" | "complete" | "error" | "timeout" | "cancelled" | "orphaned"
    title: string
  }
}

export type WorkspaceJournalEvent = any

export type WorkspaceSessionWarpResponse = { sessionID: string; workspaceID: string | null }

export type PublicUser = {
  id: string
  username: string
  email: string
  display_name: string | null
  role: "admin" | "user"
  created_at: number
  updated_at: number
}

export type AnalyticsDaily = {
  date: string
  sessions: number
  messages: number
  tokens: AnalyticsTokenBreakdown
  cost: number
  toolCalls: number
  tools: { [x: string]: { calls: number; success: number; error: number } }
  providers: { [x: string]: { messages: number; tokens: number; cost: number } }
  models: { [x: string]: { messages: number; tokens: number; cost: number } }
  recordedAt: number
}

export type AnalyticsSession = {
  sessionID: string
  projectID: string
  directory: string
  title: string
  providerID: string
  modelID: string
  messages: number
  tokens: AnalyticsTokenBreakdown
  cost: number
  toolCalls: number
  duration: number
  time: { created: number; completed: number }
}

export type AnalyticsModelStat = {
  sessions: number
  messages: number
  tokens: AnalyticsModelTokens
  cost: number
  firstUsed: number
  lastUsed: number
}

export type AnalyticsLeaderboard = {
  models: Array<{
    key: string
    providerID: string
    modelID: string
    sessions: number
    messages: number
    tokens: AnalyticsModelTokens
    cost: number
    firstUsed: number
    lastUsed: number
    totalTokens: number
  }>
  providers: Array<{ id: string; sessions: number; messages: number; tokens: number; cost: number }>
  projects: Array<{ id: string; sessions: number; tokens: number; cost: number; lastActive: number }>
}

export type AnalyticsData = {
  totals: {
    tokens: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    sessions: number
    messages: number
    toolCalls: number
    costUsd: number
    models: number
    providers: number
    authors: number
    pricePerMillion: number
    costPerSession: number
    tokensPerSession: number
    cacheRatio: number | null
    change: number | null
  }
  models: Array<AnalyticsDataModelStat>
  authors: Array<{ author: string; tokens: number; sessions: number; share: number; models: number }>
  series: Array<{ day: string; byModel: { [x: string]: number }; tokens: number; sessions: number }>
  months: Array<AnalyticsDataPeriodStat>
  lifetime: AnalyticsDataPeriodStat
  seriesModels: Array<string>
  windowDays: number
  seriesDays: number
  from: string
  to: string
  generatedAt: number
} | null

export type ProfileInfoOrNull = ProfileInfo | null

export type AdsConfig = {
  enabled?: boolean | undefined
  ratio?: number | undefined
  items?: Array<AdsItemConfig> | undefined
}

export type PermissionObjectConfig = { [x: string]: PermissionActionConfig }

export type McpRemoteConfig = {
  type: "remote"
  url: string
  enabled?: boolean | undefined
  headers?: { [x: string]: string } | undefined
  oauth?: McpOAuthConfig | false | undefined
  timeout?: number | undefined
}

export type Provider = {
  id: string
  name: string
  source: "env" | "config" | "custom" | "api"
  env: Array<string>
  key?: string | undefined
  options: { [x: string]: any }
  models: { [x: string]: Model }
}

export type ConnectorsStatusOutput2 = { [x: string]: ConnectorStatus }

export type DoctorReport = {
  ok: boolean
  version: string
  channel: string
  failures: number
  results: Array<DoctorCheck>
}

export type ToolList = Array<ToolListItem>

export type McpResourceMap = { [x: string]: McpResource }

export type ManagedWorktreeList = Array<ManagedWorktreeInfo>

export type MCPStatusMap = { [x: string]: MCPStatus }

export type MissionMilestone = {
  id: string
  name: string
  features: Array<MissionFeature>
  validation: "scrutiny" | "user-test" | "none"
  status: "pending" | "running" | "validating" | "done" | "blocked"
}

export type MissionTemplatesOutput2 = { templates: Array<MissionTemplate> }

export type MissionExecsOutput2 = { execs: Array<MissionExec> }

export type MobileBootstrap = {
  version: string
  auth: { bearerEnabled: boolean; currentToken?: MobileAuthTokenPublic | undefined }
  currentProject: MobileProject
  projects: Array<MobileProject>
  execution: { container: { available: boolean; runtime?: "docker" | "podman" | undefined; image: string } }
  github: {
    connected: boolean
    tokenAvailable?: boolean | undefined
    reconnectRequired?: boolean | undefined
    oauthDeviceEnabled: boolean
    oauthDeviceConfigured?: boolean | undefined
    oauthClientSource?: "flag" | "config" | "env" | undefined
    user?: { login: string; name?: string | null | undefined; avatar_url?: string | undefined } | undefined
  }
  expo: { available: boolean; easAvailable: boolean; details: Array<string> }
  mobileProject?:
    | {
        detected: boolean
        platforms?: Array<string> | undefined
        primaryPlatform?: string | undefined
        method?: string | undefined
        root?: string | undefined
      }
    | undefined
}

export type EventProjectUpdated = { type: "project.updated"; properties: Project }

export type FileDiffList = Array<FileDiff>

export type EventSessionDiff = { type: "session.diff"; properties: { sessionID: string; diff: Array<FileDiff> } }

export type SessionGithub = {
  owner: string
  repo: string
  fullName: string
  baseBranch: string
  headBranch: string
  repositoryDirectory?: string | undefined
  cloneUrl?: string | undefined
  htmlUrl?: string | undefined
  private?: boolean | undefined
  worktree: SessionWorktree
  pullRequest?: { number: number; url: string; title: string } | undefined
  lastCommitSha?: string | undefined
  publishedAt?: number | undefined
  publishError?: string | undefined
}

export type PermissionRule = { permission: string; pattern: string; action: PermissionAction }

export type OutputFormatJsonSchema = { type: "json_schema"; schema: JSONSchema; retryCount: number }

export type AssistantMessage = {
  id: string
  sessionID: string
  role: "assistant"
  time: { created: number; completed?: number | undefined }
  error?:
    | ProviderAuthError
    | UnknownError
    | MessageOutputLengthError
    | MessageContextOverflowError
    | MessageAbortedError
    | StructuredOutputError
    | APIError
    | undefined
  parentID: string
  modelID: string
  providerID: string
  mode: string
  agent: string
  path: { cwd: string; root: string }
  summary?: boolean | undefined
  cost: number
  tokens: {
    total?: number | undefined
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  structured?: any | undefined
  finish?: string | undefined
}

export type RetryPart = {
  id: string
  sessionID: string
  messageID: string
  type: "retry"
  attempt: number
  error: APIError
  time: { created: number }
}

export type EventSessionError = {
  type: "session.error"
  properties: {
    sessionID?: string | undefined
    error?:
      | ProviderAuthError
      | UnknownError
      | MessageOutputLengthError
      | MessageContextOverflowError
      | MessageAbortedError
      | StructuredOutputError
      | APIError
      | undefined
  }
}

export type FileSource = { text: FilePartSourceText; type: "file"; path: string }

export type ResourceSource = { text: FilePartSourceText; type: "resource"; clientName: string; uri: string }

export type SymbolSource = {
  text: FilePartSourceText
  type: "symbol"
  path: string
  range: Range
  name: string
  kind: number
}

export type MobileGitStatus = {
  branch: string
  staged: Array<MobileGitChange>
  unstaged: Array<MobileGitChange>
  untracked: Array<string>
  commitsAhead: number
  commitsBehind: number
  lastCommit?: { sha: string; message: string; author: string; timestamp: number } | undefined
}

export type LoopDefinition = {
  id: string
  name: string
  stages: Array<LoopStage>
  trigger: LoopTrigger
  maxRuns?: number | undefined
  timeoutMs?: number | undefined
  createPR?: boolean | undefined
  sandbox?: boolean | undefined
  worktree?: LoopWorktree | undefined
  paused?: boolean | undefined
  enabled: boolean
  createdAt: number
}

export type LoopRun = {
  id: string
  loopID: string
  startedAt: number
  endedAt?: number | undefined
  status: "running" | "complete" | "error" | "timeout" | "cancelled" | "orphaned"
  heartbeatAt?: number | undefined
  sessionID?: string | undefined
  error?: string | undefined
  ok: boolean
  pullRequest?: LoopPullRequestRef | undefined
}

export type RoutineTrigger = RoutineTriggerSchedule | RoutineTriggerApi

export type EventPtyCreated = { type: "pty.created"; properties: { info: Pty } }

export type EventPtyUpdated = { type: "pty.updated"; properties: { info: Pty } }

export type ProviderAuthMethods = { [x: string]: Array<ProviderAuthMethod> }

export type QuestionInfo = {
  question: string
  header: string
  options: Array<QuestionOption>
  multiple?: boolean | undefined
  custom?: boolean | undefined
}

export type PtyList = Array<Pty1>

export type LoopTemplatesOutput2 = { templates: Array<LoopTemplate> }

export type SessionStatusMap = { [x: string]: SessionStatus }

export type EventSessionStatus = { type: "session.status"; properties: { sessionID: string; status: SessionStatus } }

export type TodoList = Array<Todo>

export type EventTodoUpdated = {
  type: "todo.updated"
  properties: { sessionID: string; todos: Array<Todo>; diff: { added: Array<Todo>; completed: Array<Todo> } }
}

export type SessionContextBreakdown = {
  model?: { providerID: string; modelID: string; name: string; contextLimit: number } | undefined
  reported: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; total: number }
  sources: Array<SessionContextSource>
  estimatedTotal: number
}

export type SessionGoalOutput2 = SessionGoalState | null

export type EventSessionGoal = {
  type: "session.goal"
  properties: { sessionID: string; goal: SessionGoalState | null }
}

export type SessionBackgroundOutput2 = Array<DelegationJob>

export type SessionBackgroundInspectOutput2 = DelegationJob | null

export type SyncStatsOutput2 = {
  url?: string | undefined
  configured: boolean
  source: string
  connected: boolean
  pending: number
  failed: number
  total: number
  lastSeq: number
  lastError?: string | undefined
  lastChange: number
  events: Array<SyncStatsEvent>
}

export type PluginSpecConfig = string | [string, PluginOptionsConfig]

export type Workspace1 = {
  id: string
  name: string
  timeUsed: number
  branch: string | null
  projectID: string
  config: WorkspaceConfig
}

export type EventPermissionAsked = { type: "permission.asked"; properties: PermissionRequest1 }

export type QuestionInfo1 = {
  question: string
  header: string
  options: Array<QuestionOption1>
  multiple?: boolean | undefined
  custom?: boolean | undefined
}

export type EventQuestionReplied = {
  type: "question.replied"
  properties: { sessionID: string; requestID: string; answers: Array<QuestionAnswer> }
}

export type UserSession = { token: string; user: PublicUser }

export type AnalyticsGlobal = {
  version: 1
  updatedAt: number
  totals: { sessions: number; messages: number; tokens: AnalyticsTokenBreakdown; cost: number; toolCalls: number }
  byProvider: { [x: string]: AnalyticsProviderStat }
  byModel: { [x: string]: AnalyticsModelStat }
  byProject: { [x: string]: AnalyticsProjectStat }
}

export type PermissionRuleConfig = PermissionActionConfig | PermissionObjectConfig

export type ConfigProviders = { providers: Array<Provider>; default: { [x: string]: string } }

export type ProviderList = { all: Array<Provider>; default: { [x: string]: string }; connected: Array<string> }

export type MissionDefinition = {
  id: string
  name: string
  brief: string
  milestones: Array<MissionMilestone>
  models: MissionModels
  timeoutMs?: number | undefined
  sandbox?: boolean | undefined
  worktree?: MissionWorktree | undefined
  status: "planning" | "ready" | "running" | "paused" | "frozen" | "complete" | "error"
  createdAt: number
}

export type PermissionRuleset = Array<PermissionRule>

export type OutputFormat = OutputFormatText | OutputFormatJsonSchema

export type FilePartSource = FileSource | SymbolSource | ResourceSource

export type LoopListOutput2 = { loops: Array<LoopDefinition>; runtimes: Array<LoopRuntime> }

export type LoopGetOutput2 = { loop: LoopDefinition; runtime: LoopRuntime }

export type LoopRunsOutput2 = { runs: Array<LoopRun> }

export type Routine = {
  id: string
  name: string
  prompt: string
  triggers: Array<RoutineTrigger>
  model?: { providerID: string; modelID: string } | undefined
  paused: boolean
  projectID: string
  directory: string
  createdAt: number
  updatedAt: number
  lastRunAt?: number | undefined
  lastSessionID?: string | undefined
}

export type QuestionRequest = {
  id: string
  sessionID: string
  questions: Array<QuestionInfo>
  tool?: { messageID: string; callID: string } | undefined
}

export type TuiConfig = {
  $schema?: string | undefined
  theme?: string | undefined
  keybinds?:
    | {
        leader?: string | undefined
        app_exit?: string | undefined
        editor_open?: string | undefined
        theme_list?: string | undefined
        sidebar_toggle?: string | undefined
        scrollbar_toggle?: string | undefined
        username_toggle?: string | undefined
        status_view?: string | undefined
        sync_view?: string | undefined
        session_export?: string | undefined
        session_new?: string | undefined
        session_list?: string | undefined
        session_timeline?: string | undefined
        session_fork?: string | undefined
        session_rename?: string | undefined
        session_delete?: string | undefined
        session_pin_toggle?: string | undefined
        session_scope_toggle?: string | undefined
        session_tab_back?: string | undefined
        session_tab_forward?: string | undefined
        session_quick_switch_1?: string | undefined
        session_quick_switch_2?: string | undefined
        session_quick_switch_3?: string | undefined
        session_quick_switch_4?: string | undefined
        session_quick_switch_5?: string | undefined
        session_quick_switch_6?: string | undefined
        session_quick_switch_7?: string | undefined
        session_quick_switch_8?: string | undefined
        session_quick_switch_9?: string | undefined
        stash_delete?: string | undefined
        model_provider_list?: string | undefined
        model_favorite_toggle?: string | undefined
        session_share?: string | undefined
        session_unshare?: string | undefined
        session_interrupt?: string | undefined
        session_codebro_open?: string | undefined
        subtask_background?: string | undefined
        subtask_picker?: string | undefined
        session_compact?: string | undefined
        messages_page_up?: string | undefined
        messages_page_down?: string | undefined
        messages_line_up?: string | undefined
        messages_line_down?: string | undefined
        messages_half_page_up?: string | undefined
        messages_half_page_down?: string | undefined
        messages_first?: string | undefined
        messages_last?: string | undefined
        messages_next?: string | undefined
        messages_previous?: string | undefined
        messages_last_user?: string | undefined
        messages_copy?: string | undefined
        messages_undo?: string | undefined
        messages_redo?: string | undefined
        messages_toggle_conceal?: string | undefined
        tool_details?: string | undefined
        model_list?: string | undefined
        model_cycle_recent?: string | undefined
        model_cycle_recent_reverse?: string | undefined
        model_cycle_favorite?: string | undefined
        model_cycle_favorite_reverse?: string | undefined
        command_list?: string | undefined
        agent_list?: string | undefined
        agent_cycle?: string | undefined
        agent_cycle_reverse?: string | undefined
        permission_mode?: string | undefined
        variant_cycle?: string | undefined
        input_clear?: string | undefined
        input_paste?: string | undefined
        input_submit?: string | undefined
        input_newline?: string | undefined
        input_move_left?: string | undefined
        input_move_right?: string | undefined
        input_move_up?: string | undefined
        input_move_down?: string | undefined
        input_select_left?: string | undefined
        input_select_right?: string | undefined
        input_select_up?: string | undefined
        input_select_down?: string | undefined
        input_line_home?: string | undefined
        input_line_end?: string | undefined
        input_select_line_home?: string | undefined
        input_select_line_end?: string | undefined
        input_visual_line_home?: string | undefined
        input_visual_line_end?: string | undefined
        input_select_visual_line_home?: string | undefined
        input_select_visual_line_end?: string | undefined
        input_buffer_home?: string | undefined
        input_buffer_end?: string | undefined
        input_select_buffer_home?: string | undefined
        input_select_buffer_end?: string | undefined
        input_delete_line?: string | undefined
        input_delete_to_line_end?: string | undefined
        input_delete_to_line_start?: string | undefined
        input_backspace?: string | undefined
        input_delete?: string | undefined
        input_undo?: string | undefined
        input_redo?: string | undefined
        input_word_forward?: string | undefined
        input_word_backward?: string | undefined
        input_select_word_forward?: string | undefined
        input_select_word_backward?: string | undefined
        input_delete_word_forward?: string | undefined
        input_delete_word_backward?: string | undefined
        history_previous?: string | undefined
        history_next?: string | undefined
        session_child_cycle?: string | undefined
        session_child_cycle_reverse?: string | undefined
        session_parent?: string | undefined
        session_child_close?: string | undefined
        terminal_suspend?: string | undefined
        terminal_title_toggle?: string | undefined
        tips_toggle?: string | undefined
        voice_record?: string | undefined
        app_support?: string | undefined
      }
    | undefined
  plugin?: Array<PluginSpecConfig> | undefined
  plugin_enabled?: { [x: string]: boolean } | undefined
  scroll_speed?: number | undefined
  scroll_acceleration?: { enabled: boolean } | undefined
  diff_style?: "auto" | "stacked" | undefined
  mouse?: boolean | undefined
  sound?: boolean | undefined
  bg_pulse?: boolean | undefined
  turn_tokens?: boolean | undefined
  plugin_meta?: { [x: string]: { scope: "global" | "local"; source: string } } | undefined
  [x: string]: any
}

export type OptionalWorkspace = Workspace1 | null

export type QuestionRequest1 = {
  id: string
  sessionID: string
  questions: Array<QuestionInfo1>
  tool?: { messageID: string; callID: string } | undefined
}

export type PermissionConfig = { [x: string]: PermissionRuleConfig | undefined }

export type MissionListOutput2 = { missions: Array<MissionDefinition>; runtimes: Array<MissionRuntime> }

export type MissionGetOutput2 = { mission: MissionDefinition; runtime: MissionRuntime }

export type Session = {
  id: string
  slug: string
  projectID: string
  directory: string
  parentID?: string | undefined
  workspaceID?: string | undefined
  summary?: { additions: number; deletions: number; files: number; diffs?: Array<FileDiff> | undefined } | undefined
  share?: { url: string } | undefined
  github?: SessionGithub | undefined
  worktree?: SessionWorktree | undefined
  mobile?: SessionMobile | undefined
  title: string
  activeCommand?: string | undefined
  version: string
  time: { created: number; updated: number; compacting?: number | undefined; archived?: number | undefined }
  permission?: PermissionRuleset | undefined
  skills?: Array<string> | undefined
  disabledInstructions?: Array<string> | undefined
  disabledTools?: { [x: string]: boolean } | undefined
  revert?:
    | { messageID: string; partID?: string | undefined; snapshot?: string | undefined; diff?: string | undefined }
    | undefined
}

export type UserMessage = {
  id: string
  sessionID: string
  role: "user"
  time: { created: number }
  format?: OutputFormat | undefined
  summary?: { title?: string | undefined; body?: string | undefined; diffs: Array<FileDiff> } | undefined
  agent: string
  model: { providerID: string; modelID: string }
  system?: string | undefined
  tools?: { [x: string]: boolean } | undefined
  variant?: string | undefined
}

export type FilePart = {
  id: string
  sessionID: string
  messageID: string
  type: "file"
  mime: string
  filename?: string | undefined
  url: string
  source?: FilePartSource | undefined
}

export type FilePartInput = {
  type: "file"
  mime: string
  filename?: string | undefined
  url: string
  source?: FilePartSource | undefined
  id?: string | undefined
}

export type EventQuestionAsked = { type: "question.asked"; properties: QuestionRequest1 }

export type AgentConfig = {
  model?: string | undefined
  variant?: string | undefined
  temperature?: number | undefined
  top_p?: number | undefined
  prompt?: string | undefined
  tools?: { [x: string]: boolean } | undefined
  disable?: boolean | undefined
  description?: string | undefined
  mode?: "subagent" | "primary" | "all" | undefined
  hidden?: boolean | undefined
  options?: { [x: string]: any } | undefined
  color?: string | undefined
  steps?: number | undefined
  order?: number | undefined
  maxSteps?: number | undefined
  permission?: PermissionConfig | undefined
  advisor?: string | undefined
  advisor_max_uses?: number | undefined
  [x: string]: any | undefined
}

export type MobileGithubSessionCreateResult = {
  session: Session
  worktree: ManagedWorktreeInfo
  project: Project
  workspace?: Workspace | undefined
}

export type MobileSessionSummary = { info: Session; status?: any | undefined }

export type SessionList = Array<Session>

export type EventSessionCreated = { type: "session.created"; properties: { info: Session } }

export type EventSessionUpdated = { type: "session.updated"; properties: { info: Session } }

export type EventSessionDeleted = { type: "session.deleted"; properties: { info: Session } }

export type Message = UserMessage | AssistantMessage

export type ToolStateCompleted = {
  status: "completed"
  input: { [x: string]: any }
  output: string
  title: string
  metadata: { [x: string]: any }
  time: { start: number; end: number; compacted?: number | undefined }
  attachments?: Array<FilePart> | undefined
}

export type PromptPartInput = TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput

export type Config = {
  $schema?: string | undefined
  theme?: string | undefined
  locale?:
    | {
        language?: string | undefined
        region?: string | undefined
        locale?: string | undefined
        timezone?: string | undefined
        currency?: string | undefined
        autoDetect?: boolean | undefined
        replyLanguage?: boolean | string | undefined
      }
    | undefined
  keybinds?: KeybindsConfig | undefined
  logLevel?: LogLevel | undefined
  tui?:
    | {
        scroll_speed?: number | undefined
        scroll_acceleration?: { enabled: boolean } | undefined
        diff_style?: "auto" | "stacked" | undefined
        mouse?: boolean | undefined
        sound?: boolean | undefined
        bg_pulse?: boolean | undefined
        turn_tokens?: boolean | undefined
      }
    | undefined
  ads?: AdsConfig | undefined
  server?: ServerConfig | undefined
  remote?: RemoteConfig | undefined
  teleport?: TeleportConfig | undefined
  command?:
    | {
        [x: string]: {
          template?: string | undefined
          description?: string | undefined
          agent?: string | undefined
          model?: string | undefined
          subtask?: boolean | undefined
          aliases?: Array<string> | undefined
        }
      }
    | undefined
  reference?: { [x: string]: ReferenceConfig } | undefined
  watcher?: { ignore?: Array<string> | undefined } | undefined
  plugin?: Array<string> | undefined
  snapshot?: boolean | undefined
  sync?: { url?: string | undefined; token?: string | undefined; autostart?: boolean | undefined } | undefined
  analytics?: { share?: boolean | undefined; endpoint?: string | undefined } | undefined
  share?: "manual" | "auto" | "disabled" | undefined
  autoshare?: boolean | undefined
  autoupdate?: boolean | "notify" | undefined
  disabled_providers?: Array<string> | undefined
  enabled_providers?: Array<string> | undefined
  model?: string | undefined
  small_model?: string | undefined
  default_agent?: string | undefined
  username?: string | undefined
  mode?:
    | { build?: AgentConfig | undefined; plan?: AgentConfig | undefined; [x: string]: AgentConfig | undefined }
    | undefined
  agent?:
    | {
        plan?: AgentConfig | undefined
        build?: AgentConfig | undefined
        general?: AgentConfig | undefined
        explore?: AgentConfig | undefined
        scout?: AgentConfig | undefined
        title?: AgentConfig | undefined
        summary?: AgentConfig | undefined
        compaction?: AgentConfig | undefined
        [x: string]: AgentConfig | undefined
      }
    | undefined
  provider?: { [x: string]: ProviderConfig } | undefined
  mcp?: { [x: string]: McpLocalConfig | McpRemoteConfig | { enabled: boolean } } | undefined
  connectors?:
    | {
        [x: string]:
          | ConnectorFigma
          | ConnectorSlack
          | ConnectorGithub
          | ConnectorLovable
          | ConnectorDiscord
          | ConnectorTeams
          | ConnectorGChat
          | ConnectorLinear
          | { enabled: boolean }
      }
    | undefined
  formatter?:
    | false
    | true
    | {
        [x: string]: {
          disabled?: boolean | undefined
          command?: Array<string> | undefined
          environment?: { [x: string]: string } | undefined
          extensions?: Array<string> | undefined
        }
      }
    | undefined
  websearch?:
    | {
        provider?: "exa" | "parallel" | "mcp" | undefined
        apiKey?: string | undefined
        url?: string | undefined
        tool?: string | undefined
      }
    | undefined
  lsp?:
    | false
    | {
        [x: string]:
          | { disabled: true }
          | {
              command: Array<string>
              extensions?: Array<string> | undefined
              disabled?: boolean | undefined
              env?: { [x: string]: string } | undefined
              initialization?: { [x: string]: any } | undefined
              min_severity?: number | undefined
            }
      }
    | undefined
  instructions?: Array<string> | undefined
  layout?: LayoutConfig | undefined
  permission?: PermissionConfig | undefined
  tools?: { [x: string]: boolean } | undefined
  tool?: { allow?: Array<string> | undefined; pin?: { [x: string]: string } | undefined } | undefined
  enterprise?: { url?: string | undefined } | undefined
  compaction?: { auto?: boolean | undefined; prune?: boolean | undefined; reserved?: number | undefined } | undefined
  experimental?:
    | {
        policies?: Array<PolicyStatementConfig> | undefined
        hook?:
          | {
              file_edited?:
                | { [x: string]: Array<{ command: Array<string>; environment?: { [x: string]: string } | undefined }> }
                | undefined
              session_completed?:
                | Array<{ command: Array<string>; environment?: { [x: string]: string } | undefined }>
                | undefined
            }
          | undefined
        queued_message_wrap?: { header: string; footer: string } | "default" | boolean | null | undefined
        chatMaxRetries?: number | undefined
        disable_paste_summary?: boolean | undefined
        batch_tool?: boolean | undefined
        openTelemetry?: boolean | undefined
        primary_tools?: Array<string> | undefined
        continue_loop_on_deny?: boolean | undefined
        brain?: boolean | undefined
        brainMinHours?: number | undefined
        brainMinSessions?: number | undefined
        brainModel?: string | undefined
        memory?: boolean | undefined
        mcp_timeout?: number | undefined
        tool_timeout?: number | false | undefined
        task_timeout?: number | false | undefined
        nativeLlm?: boolean | undefined
        tui?:
          | {
              cacheEviction?: boolean | undefined
              messageVirtualization?: boolean | undefined
              explorationGrouping?: boolean | undefined
            }
          | undefined
        requests?: { latestOnlyLspRefresh?: boolean | undefined } | undefined
        events?: { schemaEncoding?: boolean | undefined } | undefined
      }
    | undefined
  rag?: RagConfig | undefined
  image?: ImageConfig | undefined
  browser?: any | undefined
  computer?: ComputerConfig | undefined
  attachment?: AttachmentConfig | undefined
  speak?: SpeakConfig | undefined
  notifications?:
    | {
        todo?:
          | {
              enabled?: boolean | undefined
              macos?: boolean | undefined
              slack?:
                | { enabled?: boolean | undefined; connector?: string | undefined; channel?: string | undefined }
                | undefined
              discord?: { enabled?: boolean | undefined; webhook?: string | undefined } | undefined
            }
          | undefined
        icon?: { url?: string | undefined; alt?: string | undefined } | undefined
        notify?:
          | {
              enabled?: boolean | undefined
              macos?: boolean | undefined
              slack?:
                | { enabled?: boolean | undefined; connector?: string | undefined; channel?: string | undefined }
                | undefined
              discord?: { enabled?: boolean | undefined; webhook?: string | undefined } | undefined
              events?:
                | {
                    sessionIdle?: boolean | undefined
                    sessionError?: boolean | undefined
                    permissionAsked?: boolean | undefined
                    questionAsked?: boolean | undefined
                  }
                | undefined
              idleMinMs?: number | undefined
              rateLimit?: { windowMs?: number | undefined; maxPerWindow?: number | undefined } | undefined
              retry?:
                | {
                    attempts?: number | undefined
                    delay?: number | undefined
                    factor?: number | undefined
                    maxDelay?: number | undefined
                    timeoutMs?: number | undefined
                  }
                | undefined
              breaker?: { failures?: number | undefined; cooldownMs?: number | undefined } | undefined
              quietHours?:
                | {
                    enabled?: boolean | undefined
                    start?: string | undefined
                    end?: string | undefined
                    suppress?: Array<"macos" | "slack" | "discord"> | undefined
                  }
                | undefined
            }
          | undefined
      }
    | undefined
  mobile?:
    | {
        tophat?:
          | {
              enabled?: boolean | undefined
              cliPath?: string | undefined
              defaultPlatform?: "ios" | "android" | undefined
              defaultDestination?: "device" | "simulator" | "emulator" | undefined
              autoDetect?: boolean | undefined
            }
          | undefined
      }
    | undefined
  [x: string]: any
}

export type EventMessageUpdated = { type: "message.updated"; properties: { info: Message } }

export type ToolState = ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError

export type SessionPendingPromptInput = {
  sessionID: string
  messageID?: string | undefined
  delivery?: "steer" | "queue" | undefined
  model?: { providerID: string; modelID: string } | undefined
  agent?: string | undefined
  noReply?: boolean | undefined
  tools?: { [x: string]: boolean } | undefined
  format?: OutputFormat | undefined
  system?: string | undefined
  variant?: string | undefined
  parts: Array<PromptPartInput>
}

export type ToolPart = {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string
  state: ToolState
  metadata?: { [x: string]: any } | undefined
}

export type SessionPendingInput2 = {
  id: string
  sessionID: string
  delivery: "steer" | "queue"
  messageID: string
  data: SessionPendingPromptInput
  createdAt: number
}

export type Part =
  | TextPart
  | SubtaskPart
  | ReasoningPart
  | FilePart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | SnapshotPart
  | PatchPart
  | AgentPart
  | RetryPart
  | CompactionPart

export type SessionPendingInputList = Array<SessionPendingInput2>

export type MobileSessionDetail = {
  info: Session
  status?: any | undefined
  messages: Array<{ info: Message; parts: Array<Part> }>
  artifacts: Array<any>
  permissions: Array<any>
  questions: Array<any>
}

export type MessageWithParts = { info: Message; parts: Array<Part> }

export type MessageList = Array<{ info: Message; parts: Array<Part> }>

export type SessionPromptResponse = { info: Message; parts: Array<Part> }

export type ShareData = Array<
  | { type: "session"; data: Session }
  | { type: "message"; data: Message }
  | { type: "part"; data: Part }
  | { type: "session_diff"; data: Array<FileDiff> }
  | { type: "model"; data: Array<Model> }
>

export type EventMessagePartUpdated = {
  type: "message.part.updated"
  properties: { part: Part; delta?: string | undefined }
}

export type Event =
  | EventProjectUpdated
  | EventTelemetryRecord
  | EventServerInstanceDisposed
  | EventPermissionAsked
  | EventPermissionReplied
  | EventQuestionAsked
  | EventQuestionReplied
  | EventQuestionRejected
  | EventInstallationUpdated
  | EventInstallationUpdateAvailable
  | EventServerConnected
  | EventGlobalDisposed
  | EventLspUpdated
  | EventMessageUpdated
  | EventMessageRemoved
  | EventMessagePartUpdated
  | EventMessagePartRemoved
  | EventSessionCreated
  | EventSessionUpdated
  | EventSessionDeleted
  | EventSessionDiff
  | EventSessionError
  | EventSessionPendingPromoted
  | EventSessionInstructionsUpdated
  | EventTuiPromptAppend
  | EventTuiCommandExecute
  | EventTuiToastShow
  | EventTuiSessionSelect
  | EventMcpToolsChanged
  | EventFileWatcherUpdated
  | EventVcsBranchUpdated
  | EventTodoUpdated
  | EventSessionStatus
  | EventSessionIdle
  | EventSessionCompacted
  | EventSessionGoal
  | EventIdeInstalled
  | EventPtyCreated
  | EventPtyUpdated
  | EventPtyExited
  | EventPtyDeleted
  | EventSessionV2Updated
  | EventSessionEntryUpdated
  | EventSessionEntryRemoved
  | EventFileEdited
  | EventMonitorCreated
  | EventMonitorUpdated
  | EventMonitorOutput
  | EventMonitorCompleted
  | EventLoopUpserted
  | EventLoopRemoved
  | EventLoopRunStarted
  | EventLoopRunFinished
  | EventLoopRuntimeChanged
  | EventMissionUpserted
  | EventMissionRemoved
  | EventMissionStarted
  | EventMissionFinished
  | EventMissionExecStarted
  | EventMissionExecFinished
  | EventMissionRuntimeChanged
  | EventMissionAborted
  | EventWorkspaceStatus
  | EventWorkspaceReady
  | EventWorkspaceFailed
  | EventDelegationCompleted

export type GlobalEvent = { directory: string; payload: Event }

export type VcsApplyError = {
  readonly name: "VcsApplyError"
  readonly data: { readonly message: string; readonly reason: string }
}

export type AnalyticsSessionNotFound = { readonly error: "Session not found" }

export type ConfigUpdateError = { readonly name: string; readonly data: { readonly [x: string]: unknown } }

export type ConnectorsValidationError = {
  readonly name: "ValidationError"
  readonly data: { readonly [x: string]: unknown }
}

export type McpOAuthUnsupportedError = { readonly error: string }

export type MissionValidationError = {
  readonly name: "ValidationError"
  readonly data: { readonly [x: string]: unknown }
}

export type MissionNotFound = { readonly name: "NotFound"; readonly data: { readonly [x: string]: unknown } }

export type PtyCreateErrorBody = { readonly name: "PtyCreateError"; readonly data: { readonly [x: string]: unknown } }

export type PtyNotFoundError = { readonly name: "NotFoundError"; readonly data: { readonly [x: string]: unknown } }

export type LoopValidationError = { readonly name: "ValidationError"; readonly data: { readonly [x: string]: unknown } }

export type LoopNotFound = { readonly name: "NotFound"; readonly data: { readonly [x: string]: unknown } }

export type SessionNotFoundError = { readonly name: "NotFoundError"; readonly data: { readonly [x: string]: unknown } }

export type SessionBusyErrorBody = {
  readonly name: "SessionBusyError"
  readonly data: { readonly [x: string]: unknown }
}

export type SessionBackgroundNotFound = { readonly error: "Session not found" }

export type TuiValidationError = { readonly data: unknown; readonly error: unknown; readonly success: false }

export type TuiNotFoundError = { readonly name: "NotFoundError"; readonly data: { readonly [x: string]: unknown } }

export type TopLevelDisposeOutput = InstanceDisposeResult

export type TopLevelPathOutput = Path

export type TopLevelVcsOutput = VcsInfo

export type TopLevelVcsStatusOutput = Array<VcsFileStatus>

export type TopLevelVcsDiffRawOutput = string

export type TopLevelVcsApplyInput = { readonly patch: { readonly patch: string }["patch"] }

export type TopLevelVcsApplyOutput = VcsApplyResult

export type TopLevelCommandOutput = Array<Command>

export type TopLevelAgentOutput = Array<Agent>

export type TopLevelSkillOutput = Array<Skill>

export type TopLevelLspOutput = Array<LSPStatus>

export type TopLevelFormatterOutput = Array<FormatterStatus>

export type AnalyticsGlobalOutput = AnalyticsGlobal

export type AnalyticsDailyInput = {
  readonly from?: {
    readonly from?: string | undefined
    readonly to?: string | undefined
    readonly days?: string | undefined
  }["from"]
  readonly to?: {
    readonly from?: string | undefined
    readonly to?: string | undefined
    readonly days?: string | undefined
  }["to"]
  readonly days?: {
    readonly from?: string | undefined
    readonly to?: string | undefined
    readonly days?: string | undefined
  }["days"]
}

export type AnalyticsDailyOutput = Array<AnalyticsDaily>

export type AnalyticsSessionInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type AnalyticsSessionOutput = AnalyticsSession

export type AnalyticsSessionsOutput = Array<AnalyticsSession>

export type AnalyticsLeaderboardOutput = AnalyticsLeaderboard

export type AnalyticsDataInput = {
  readonly days?: { readonly days?: string | undefined; readonly seriesDays?: string | undefined }["days"]
  readonly seriesDays?: { readonly days?: string | undefined; readonly seriesDays?: string | undefined }["seriesDays"]
}

export type AnalyticsDataOutput = AnalyticsData

export type AppLogInput = {
  readonly service: {
    readonly service: string
    readonly level: "debug" | "info" | "error" | "warn"
    readonly message: string
    readonly extra?: { readonly [x: string]: unknown } | undefined
  }["service"]
  readonly level: {
    readonly service: string
    readonly level: "debug" | "info" | "error" | "warn"
    readonly message: string
    readonly extra?: { readonly [x: string]: unknown } | undefined
  }["level"]
  readonly message: {
    readonly service: string
    readonly level: "debug" | "info" | "error" | "warn"
    readonly message: string
    readonly extra?: { readonly [x: string]: unknown } | undefined
  }["message"]
  readonly extra?: {
    readonly service: string
    readonly level: "debug" | "info" | "error" | "warn"
    readonly message: string
    readonly extra?: { readonly [x: string]: unknown } | undefined
  }["extra"]
}

export type AppLogOutput = boolean

export type AppSkillCreateInput = {
  readonly name: {
    readonly name: string
    readonly description: string
    readonly category?: string | undefined
    readonly tags?: ReadonlyArray<string> | undefined
    readonly content?: string | undefined
    readonly scope?: "workspace" | "global" | undefined
  }["name"]
  readonly description: {
    readonly name: string
    readonly description: string
    readonly category?: string | undefined
    readonly tags?: ReadonlyArray<string> | undefined
    readonly content?: string | undefined
    readonly scope?: "workspace" | "global" | undefined
  }["description"]
  readonly category?: {
    readonly name: string
    readonly description: string
    readonly category?: string | undefined
    readonly tags?: ReadonlyArray<string> | undefined
    readonly content?: string | undefined
    readonly scope?: "workspace" | "global" | undefined
  }["category"]
  readonly tags?: {
    readonly name: string
    readonly description: string
    readonly category?: string | undefined
    readonly tags?: ReadonlyArray<string> | undefined
    readonly content?: string | undefined
    readonly scope?: "workspace" | "global" | undefined
  }["tags"]
  readonly content?: {
    readonly name: string
    readonly description: string
    readonly category?: string | undefined
    readonly tags?: ReadonlyArray<string> | undefined
    readonly content?: string | undefined
    readonly scope?: "workspace" | "global" | undefined
  }["content"]
  readonly scope?: {
    readonly name: string
    readonly description: string
    readonly category?: string | undefined
    readonly tags?: ReadonlyArray<string> | undefined
    readonly content?: string | undefined
    readonly scope?: "workspace" | "global" | undefined
  }["scope"]
}

export type AppSkillCreateOutput = AppSkillInfo

export type AppSkillDeleteInput = { readonly name: { readonly name: string }["name"] }

export type AppSkillDeleteOutput = boolean

export type BrainStatusOutput = BrainStatus

export type BrainTriggerInput = { readonly force?: { readonly force?: boolean | undefined }["force"] }

export type BrainTriggerOutput = BrainResult

export type ChatbotBotsOutput = Array<ChatbotBot>

export type ChatbotStartInput = { readonly name: { readonly name: string }["name"] }

export type ChatbotStartOutput = ChatbotStartResult

export type ChatbotStopInput = { readonly name: { readonly name: string }["name"] }

export type ChatbotStopOutput = ChatbotStopResult

export type VoiceTranscribeInput = {
  readonly audio: { readonly audio: string; readonly format?: string | undefined }["audio"]
  readonly format?: { readonly audio: string; readonly format?: string | undefined }["format"]
}

export type VoiceTranscribeOutput = VoiceTranscribeResult

export type ProfileGetOutput = ProfileInfoOrNull

export type ProfilePatchInput = { readonly payload: { readonly [x: string]: unknown } }

export type ProfilePatchOutput = ProfileInfo

export type ProfileClearOutput = ProfileDeleted

export type ProfileHabitsInput = { readonly worktree?: { readonly worktree?: string | undefined }["worktree"] }

export type ProfileHabitsOutput = ProfileHabits

export type ProfilePreviewInput = { readonly worktree?: { readonly worktree?: string | undefined }["worktree"] }

export type ProfilePreviewOutput = ProfilePreview

export type ProfileClearHabitsInput = { readonly worktree?: { readonly worktree?: string | undefined }["worktree"] }

export type ProfileClearHabitsOutput = ProfileDeleted

export type ConfigGetOutput = Config

export type ConfigUpdateInput = {
  readonly payload: {
    readonly $schema?: string | undefined
    readonly theme?: string | undefined
    readonly locale?:
      | {
          readonly language?: string | undefined
          readonly region?: string | undefined
          readonly locale?: string | undefined
          readonly timezone?: string | undefined
          readonly currency?: string | undefined
          readonly autoDetect?: boolean | undefined
          readonly replyLanguage?: boolean | string | undefined
        }
      | undefined
    readonly keybinds?:
      | {
          readonly leader?: string | undefined
          readonly app_exit?: string | undefined
          readonly editor_open?: string | undefined
          readonly theme_list?: string | undefined
          readonly sidebar_toggle?: string | undefined
          readonly scrollbar_toggle?: string | undefined
          readonly username_toggle?: string | undefined
          readonly status_view?: string | undefined
          readonly sync_view?: string | undefined
          readonly session_export?: string | undefined
          readonly session_new?: string | undefined
          readonly session_list?: string | undefined
          readonly session_timeline?: string | undefined
          readonly session_fork?: string | undefined
          readonly session_rename?: string | undefined
          readonly session_delete?: string | undefined
          readonly session_pin_toggle?: string | undefined
          readonly session_scope_toggle?: string | undefined
          readonly session_tab_back?: string | undefined
          readonly session_tab_forward?: string | undefined
          readonly session_quick_switch_1?: string | undefined
          readonly session_quick_switch_2?: string | undefined
          readonly session_quick_switch_3?: string | undefined
          readonly session_quick_switch_4?: string | undefined
          readonly session_quick_switch_5?: string | undefined
          readonly session_quick_switch_6?: string | undefined
          readonly session_quick_switch_7?: string | undefined
          readonly session_quick_switch_8?: string | undefined
          readonly session_quick_switch_9?: string | undefined
          readonly stash_delete?: string | undefined
          readonly model_provider_list?: string | undefined
          readonly model_favorite_toggle?: string | undefined
          readonly session_share?: string | undefined
          readonly session_unshare?: string | undefined
          readonly session_interrupt?: string | undefined
          readonly session_codebro_open?: string | undefined
          readonly subtask_background?: string | undefined
          readonly subtask_picker?: string | undefined
          readonly session_compact?: string | undefined
          readonly messages_page_up?: string | undefined
          readonly messages_page_down?: string | undefined
          readonly messages_line_up?: string | undefined
          readonly messages_line_down?: string | undefined
          readonly messages_half_page_up?: string | undefined
          readonly messages_half_page_down?: string | undefined
          readonly messages_first?: string | undefined
          readonly messages_last?: string | undefined
          readonly messages_next?: string | undefined
          readonly messages_previous?: string | undefined
          readonly messages_last_user?: string | undefined
          readonly messages_copy?: string | undefined
          readonly messages_undo?: string | undefined
          readonly messages_redo?: string | undefined
          readonly messages_toggle_conceal?: string | undefined
          readonly tool_details?: string | undefined
          readonly model_list?: string | undefined
          readonly model_cycle_recent?: string | undefined
          readonly model_cycle_recent_reverse?: string | undefined
          readonly model_cycle_favorite?: string | undefined
          readonly model_cycle_favorite_reverse?: string | undefined
          readonly command_list?: string | undefined
          readonly agent_list?: string | undefined
          readonly agent_cycle?: string | undefined
          readonly agent_cycle_reverse?: string | undefined
          readonly permission_mode?: string | undefined
          readonly variant_cycle?: string | undefined
          readonly input_clear?: string | undefined
          readonly input_paste?: string | undefined
          readonly input_submit?: string | undefined
          readonly input_newline?: string | undefined
          readonly input_move_left?: string | undefined
          readonly input_move_right?: string | undefined
          readonly input_move_up?: string | undefined
          readonly input_move_down?: string | undefined
          readonly input_select_left?: string | undefined
          readonly input_select_right?: string | undefined
          readonly input_select_up?: string | undefined
          readonly input_select_down?: string | undefined
          readonly input_line_home?: string | undefined
          readonly input_line_end?: string | undefined
          readonly input_select_line_home?: string | undefined
          readonly input_select_line_end?: string | undefined
          readonly input_visual_line_home?: string | undefined
          readonly input_visual_line_end?: string | undefined
          readonly input_select_visual_line_home?: string | undefined
          readonly input_select_visual_line_end?: string | undefined
          readonly input_buffer_home?: string | undefined
          readonly input_buffer_end?: string | undefined
          readonly input_select_buffer_home?: string | undefined
          readonly input_select_buffer_end?: string | undefined
          readonly input_delete_line?: string | undefined
          readonly input_delete_to_line_end?: string | undefined
          readonly input_delete_to_line_start?: string | undefined
          readonly input_backspace?: string | undefined
          readonly input_delete?: string | undefined
          readonly input_undo?: string | undefined
          readonly input_redo?: string | undefined
          readonly input_word_forward?: string | undefined
          readonly input_word_backward?: string | undefined
          readonly input_select_word_forward?: string | undefined
          readonly input_select_word_backward?: string | undefined
          readonly input_delete_word_forward?: string | undefined
          readonly input_delete_word_backward?: string | undefined
          readonly history_previous?: string | undefined
          readonly history_next?: string | undefined
          readonly session_child_cycle?: string | undefined
          readonly session_child_cycle_reverse?: string | undefined
          readonly session_parent?: string | undefined
          readonly session_child_close?: string | undefined
          readonly terminal_suspend?: string | undefined
          readonly terminal_title_toggle?: string | undefined
          readonly tips_toggle?: string | undefined
          readonly voice_record?: string | undefined
          readonly app_support?: string | undefined
        }
      | undefined
    readonly logLevel?: ("DEBUG" | "INFO" | "WARN" | "ERROR") | undefined
    readonly tui?:
      | {
          readonly scroll_speed?: number | undefined
          readonly scroll_acceleration?: { readonly enabled: boolean } | undefined
          readonly diff_style?: "auto" | "stacked" | undefined
          readonly mouse?: boolean | undefined
          readonly sound?: boolean | undefined
          readonly bg_pulse?: boolean | undefined
          readonly turn_tokens?: boolean | undefined
        }
      | undefined
    readonly ads?:
      | {
          readonly enabled?: boolean | undefined
          readonly ratio?: number | undefined
          readonly items?:
            | ReadonlyArray<{
                readonly id: string
                readonly text: string
                readonly url?: string | undefined
                readonly enabled?: boolean | undefined
              }>
            | undefined
        }
      | undefined
    readonly server?:
      | {
          readonly port?: number | undefined
          readonly hostname?: string | undefined
          readonly mdns?: boolean | undefined
          readonly cors?: ReadonlyArray<string> | undefined
        }
      | undefined
    readonly remote?:
      | {
          readonly enabled?: boolean | undefined
          readonly enableTunnel?: boolean | undefined
          readonly provider?: "localtunnel" | "cloudflared" | "ngrok" | "remotosh" | "none" | undefined
          readonly askOnExistingSession?: boolean | undefined
        }
      | undefined
    readonly teleport?: { readonly url?: string | undefined; readonly token?: string | undefined } | undefined
    readonly command?:
      | {
          readonly [x: string]: {
            readonly template?: string | undefined
            readonly description?: string | undefined
            readonly agent?: string | undefined
            readonly model?: string | undefined
            readonly subtask?: boolean | undefined
            readonly aliases?: ReadonlyArray<string> | undefined
          }
        }
      | undefined
    readonly reference?:
      | {
          readonly [x: string]:
            | {
                readonly type: "git"
                readonly repository: string
                readonly branch?: string | undefined
                readonly description?: string | undefined
              }
            | { readonly type: "local"; readonly path: string; readonly description?: string | undefined }
        }
      | undefined
    readonly watcher?: { readonly ignore?: ReadonlyArray<string> | undefined } | undefined
    readonly plugin?: ReadonlyArray<string> | undefined
    readonly snapshot?: boolean | undefined
    readonly sync?:
      | {
          readonly url?: string | undefined
          readonly token?: string | undefined
          readonly autostart?: boolean | undefined
        }
      | undefined
    readonly analytics?: { readonly share?: boolean | undefined; readonly endpoint?: string | undefined } | undefined
    readonly share?: "manual" | "auto" | "disabled" | undefined
    readonly autoshare?: boolean | undefined
    readonly autoupdate?: boolean | "notify" | undefined
    readonly disabled_providers?: ReadonlyArray<string> | undefined
    readonly enabled_providers?: ReadonlyArray<string> | undefined
    readonly model?: string | undefined
    readonly small_model?: string | undefined
    readonly default_agent?: string | undefined
    readonly username?: string | undefined
    readonly mode?:
      | {
          readonly build?:
            | {
                readonly model?: string | undefined
                readonly variant?: string | undefined
                readonly temperature?: number | undefined
                readonly top_p?: number | undefined
                readonly prompt?: string | undefined
                readonly tools?: { readonly [x: string]: boolean } | undefined
                readonly disable?: boolean | undefined
                readonly description?: string | undefined
                readonly mode?: "subagent" | "primary" | "all" | undefined
                readonly hidden?: boolean | undefined
                readonly options?: { readonly [x: string]: unknown } | undefined
                readonly color?: string | undefined
                readonly steps?: number | undefined
                readonly order?: number | undefined
                readonly maxSteps?: number | undefined
                readonly permission?:
                  | {
                      readonly [x: string]:
                        | (("ask" | "allow" | "deny") | { readonly [x: string]: "ask" | "allow" | "deny" })
                        | undefined
                    }
                  | undefined
                readonly advisor?: string | undefined
                readonly advisor_max_uses?: number | undefined
                readonly [x: string]: unknown | undefined
              }
            | undefined
          readonly plan?:
            | {
                readonly model?: string | undefined
                readonly variant?: string | undefined
                readonly temperature?: number | undefined
                readonly top_p?: number | undefined
                readonly prompt?: string | undefined
                readonly tools?: { readonly [x: string]: boolean } | undefined
                readonly disable?: boolean | undefined
                readonly description?: string | undefined
                readonly mode?: "subagent" | "primary" | "all" | undefined
                readonly hidden?: boolean | undefined
                readonly options?: { readonly [x: string]: unknown } | undefined
                readonly color?: string | undefined
                readonly steps?: number | undefined
                readonly order?: number | undefined
                readonly maxSteps?: number | undefined
                readonly permission?:
                  | {
                      readonly [x: string]:
                        | (("ask" | "allow" | "deny") | { readonly [x: string]: "ask" | "allow" | "deny" })
                        | undefined
                    }
                  | undefined
                readonly advisor?: string | undefined
                readonly advisor_max_uses?: number | undefined
                readonly [x: string]: unknown | undefined
              }
            | undefined
          readonly [x: string]:
            | {
                readonly model?: string | undefined
                readonly variant?: string | undefined
                readonly temperature?: number | undefined
                readonly top_p?: number | undefined
                readonly prompt?: string | undefined
                readonly tools?: { readonly [x: string]: boolean } | undefined
                readonly disable?: boolean | undefined
                readonly description?: string | undefined
                readonly mode?: "subagent" | "primary" | "all" | undefined
                readonly hidden?: boolean | undefined
                readonly options?: { readonly [x: string]: unknown } | undefined
                readonly color?: string | undefined
                readonly steps?: number | undefined
                readonly order?: number | undefined
                readonly maxSteps?: number | undefined
                readonly permission?:
                  | {
                      readonly [x: string]:
                        | (("ask" | "allow" | "deny") | { readonly [x: string]: "ask" | "allow" | "deny" })
                        | undefined
                    }
                  | undefined
                readonly advisor?: string | undefined
                readonly advisor_max_uses?: number | undefined
                readonly [x: string]: unknown | undefined
              }
            | undefined
        }
      | undefined
    readonly agent?:
      | {
          readonly plan?:
            | {
                readonly model?: string | undefined
                readonly variant?: string | undefined
                readonly temperature?: number | undefined
                readonly top_p?: number | undefined
                readonly prompt?: string | undefined
                readonly tools?: { readonly [x: string]: boolean } | undefined
                readonly disable?: boolean | undefined
                readonly description?: string | undefined
                readonly mode?: "subagent" | "primary" | "all" | undefined
                readonly hidden?: boolean | undefined
                readonly options?: { readonly [x: string]: unknown } | undefined
                readonly color?: string | undefined
                readonly steps?: number | undefined
                readonly order?: number | undefined
                readonly maxSteps?: number | undefined
                readonly permission?:
                  | {
                      readonly [x: string]:
                        | (("ask" | "allow" | "deny") | { readonly [x: string]: "ask" | "allow" | "deny" })
                        | undefined
                    }
                  | undefined
                readonly advisor?: string | undefined
                readonly advisor_max_uses?: number | undefined
                readonly [x: string]: unknown | undefined
              }
            | undefined
          readonly build?:
            | {
                readonly model?: string | undefined
                readonly variant?: string | undefined
                readonly temperature?: number | undefined
                readonly top_p?: number | undefined
                readonly prompt?: string | undefined
                readonly tools?: { readonly [x: string]: boolean } | undefined
                readonly disable?: boolean | undefined
                readonly description?: string | undefined
                readonly mode?: "subagent" | "primary" | "all" | undefined
                readonly hidden?: boolean | undefined
                readonly options?: { readonly [x: string]: unknown } | undefined
                readonly color?: string | undefined
                readonly steps?: number | undefined
                readonly order?: number | undefined
                readonly maxSteps?: number | undefined
                readonly permission?:
                  | {
                      readonly [x: string]:
                        | (("ask" | "allow" | "deny") | { readonly [x: string]: "ask" | "allow" | "deny" })
                        | undefined
                    }
                  | undefined
                readonly advisor?: string | undefined
                readonly advisor_max_uses?: number | undefined
                readonly [x: string]: unknown | undefined
              }
            | undefined
          readonly general?:
            | {
                readonly model?: string | undefined
                readonly variant?: string | undefined
                readonly temperature?: number | undefined
                readonly top_p?: number | undefined
                readonly prompt?: string | undefined
                readonly tools?: { readonly [x: string]: boolean } | undefined
                readonly disable?: boolean | undefined
                readonly description?: string | undefined
                readonly mode?: "subagent" | "primary" | "all" | undefined
                readonly hidden?: boolean | undefined
                readonly options?: { readonly [x: string]: unknown } | undefined
                readonly color?: string | undefined
                readonly steps?: number | undefined
                readonly order?: number | undefined
                readonly maxSteps?: number | undefined
                readonly permission?:
                  | {
                      readonly [x: string]:
                        | (("ask" | "allow" | "deny") | { readonly [x: string]: "ask" | "allow" | "deny" })
                        | undefined
                    }
                  | undefined
                readonly advisor?: string | undefined
                readonly advisor_max_uses?: number | undefined
                readonly [x: string]: unknown | undefined
              }
            | undefined
          readonly explore?:
            | {
                readonly model?: string | undefined
                readonly variant?: string | undefined
                readonly temperature?: number | undefined
                readonly top_p?: number | undefined
                readonly prompt?: string | undefined
                readonly tools?: { readonly [x: string]: boolean } | undefined
                readonly disable?: boolean | undefined
                readonly description?: string | undefined
                readonly mode?: "subagent" | "primary" | "all" | undefined
                readonly hidden?: boolean | undefined
                readonly options?: { readonly [x: string]: unknown } | undefined
                readonly color?: string | undefined
                readonly steps?: number | undefined
                readonly order?: number | undefined
                readonly maxSteps?: number | undefined
                readonly permission?:
                  | {
                      readonly [x: string]:
                        | (("ask" | "allow" | "deny") | { readonly [x: string]: "ask" | "allow" | "deny" })
                        | undefined
                    }
                  | undefined
                readonly advisor?: string | undefined
                readonly advisor_max_uses?: number | undefined
                readonly [x: string]: unknown | undefined
              }
            | undefined
          readonly scout?:
            | {
                readonly model?: string | undefined
                readonly variant?: string | undefined
                readonly temperature?: number | undefined
                readonly top_p?: number | undefined
                readonly prompt?: string | undefined
                readonly tools?: { readonly [x: string]: boolean } | undefined
                readonly disable?: boolean | undefined
                readonly description?: string | undefined
                readonly mode?: "subagent" | "primary" | "all" | undefined
                readonly hidden?: boolean | undefined
                readonly options?: { readonly [x: string]: unknown } | undefined
                readonly color?: string | undefined
                readonly steps?: number | undefined
                readonly order?: number | undefined
                readonly maxSteps?: number | undefined
                readonly permission?:
                  | {
                      readonly [x: string]:
                        | (("ask" | "allow" | "deny") | { readonly [x: string]: "ask" | "allow" | "deny" })
                        | undefined
                    }
                  | undefined
                readonly advisor?: string | undefined
                readonly advisor_max_uses?: number | undefined
                readonly [x: string]: unknown | undefined
              }
            | undefined
          readonly title?:
            | {
                readonly model?: string | undefined
                readonly variant?: string | undefined
                readonly temperature?: number | undefined
                readonly top_p?: number | undefined
                readonly prompt?: string | undefined
                readonly tools?: { readonly [x: string]: boolean } | undefined
                readonly disable?: boolean | undefined
                readonly description?: string | undefined
                readonly mode?: "subagent" | "primary" | "all" | undefined
                readonly hidden?: boolean | undefined
                readonly options?: { readonly [x: string]: unknown } | undefined
                readonly color?: string | undefined
                readonly steps?: number | undefined
                readonly order?: number | undefined
                readonly maxSteps?: number | undefined
                readonly permission?:
                  | {
                      readonly [x: string]:
                        | (("ask" | "allow" | "deny") | { readonly [x: string]: "ask" | "allow" | "deny" })
                        | undefined
                    }
                  | undefined
                readonly advisor?: string | undefined
                readonly advisor_max_uses?: number | undefined
                readonly [x: string]: unknown | undefined
              }
            | undefined
          readonly summary?:
            | {
                readonly model?: string | undefined
                readonly variant?: string | undefined
                readonly temperature?: number | undefined
                readonly top_p?: number | undefined
                readonly prompt?: string | undefined
                readonly tools?: { readonly [x: string]: boolean } | undefined
                readonly disable?: boolean | undefined
                readonly description?: string | undefined
                readonly mode?: "subagent" | "primary" | "all" | undefined
                readonly hidden?: boolean | undefined
                readonly options?: { readonly [x: string]: unknown } | undefined
                readonly color?: string | undefined
                readonly steps?: number | undefined
                readonly order?: number | undefined
                readonly maxSteps?: number | undefined
                readonly permission?:
                  | {
                      readonly [x: string]:
                        | (("ask" | "allow" | "deny") | { readonly [x: string]: "ask" | "allow" | "deny" })
                        | undefined
                    }
                  | undefined
                readonly advisor?: string | undefined
                readonly advisor_max_uses?: number | undefined
                readonly [x: string]: unknown | undefined
              }
            | undefined
          readonly compaction?:
            | {
                readonly model?: string | undefined
                readonly variant?: string | undefined
                readonly temperature?: number | undefined
                readonly top_p?: number | undefined
                readonly prompt?: string | undefined
                readonly tools?: { readonly [x: string]: boolean } | undefined
                readonly disable?: boolean | undefined
                readonly description?: string | undefined
                readonly mode?: "subagent" | "primary" | "all" | undefined
                readonly hidden?: boolean | undefined
                readonly options?: { readonly [x: string]: unknown } | undefined
                readonly color?: string | undefined
                readonly steps?: number | undefined
                readonly order?: number | undefined
                readonly maxSteps?: number | undefined
                readonly permission?:
                  | {
                      readonly [x: string]:
                        | (("ask" | "allow" | "deny") | { readonly [x: string]: "ask" | "allow" | "deny" })
                        | undefined
                    }
                  | undefined
                readonly advisor?: string | undefined
                readonly advisor_max_uses?: number | undefined
                readonly [x: string]: unknown | undefined
              }
            | undefined
          readonly [x: string]:
            | {
                readonly model?: string | undefined
                readonly variant?: string | undefined
                readonly temperature?: number | undefined
                readonly top_p?: number | undefined
                readonly prompt?: string | undefined
                readonly tools?: { readonly [x: string]: boolean } | undefined
                readonly disable?: boolean | undefined
                readonly description?: string | undefined
                readonly mode?: "subagent" | "primary" | "all" | undefined
                readonly hidden?: boolean | undefined
                readonly options?: { readonly [x: string]: unknown } | undefined
                readonly color?: string | undefined
                readonly steps?: number | undefined
                readonly order?: number | undefined
                readonly maxSteps?: number | undefined
                readonly permission?:
                  | {
                      readonly [x: string]:
                        | (("ask" | "allow" | "deny") | { readonly [x: string]: "ask" | "allow" | "deny" })
                        | undefined
                    }
                  | undefined
                readonly advisor?: string | undefined
                readonly advisor_max_uses?: number | undefined
                readonly [x: string]: unknown | undefined
              }
            | undefined
        }
      | undefined
    readonly provider?:
      | {
          readonly [x: string]: {
            readonly api?: string | undefined
            readonly name?: string | undefined
            readonly env?: ReadonlyArray<string> | undefined
            readonly id?: string | undefined
            readonly npm?: string | undefined
            readonly models?:
              | {
                  readonly [x: string]: {
                    readonly id?: string | undefined
                    readonly name?: string | undefined
                    readonly family?: string | undefined
                    readonly release_date?: string | undefined
                    readonly attachment?: boolean | undefined
                    readonly reasoning?: boolean | undefined
                    readonly temperature?: boolean | undefined
                    readonly tool_call?: boolean | undefined
                    readonly interleaved?:
                      | true
                      | { readonly field: "reasoning_content" | "reasoning_details" }
                      | undefined
                    readonly cost?:
                      | {
                          readonly input: number
                          readonly output: number
                          readonly cache_read?: number | undefined
                          readonly cache_write?: number | undefined
                          readonly context_over_200k?:
                            | {
                                readonly input: number
                                readonly output: number
                                readonly cache_read?: number | undefined
                                readonly cache_write?: number | undefined
                              }
                            | undefined
                        }
                      | undefined
                    readonly limit?:
                      | { readonly context: number; readonly input?: number | undefined; readonly output: number }
                      | undefined
                    readonly modalities?:
                      | {
                          readonly input: ReadonlyArray<"text" | "audio" | "image" | "video" | "pdf">
                          readonly output: ReadonlyArray<"text" | "audio" | "image" | "video" | "pdf">
                        }
                      | undefined
                    readonly experimental?: boolean | undefined
                    readonly status?: "alpha" | "beta" | "deprecated" | undefined
                    readonly options?: { readonly [x: string]: unknown } | undefined
                    readonly headers?: { readonly [x: string]: string } | undefined
                    readonly provider?: { readonly npm: string; readonly api: string } | undefined
                    readonly reasoning_options?:
                      | ReadonlyArray<
                          | { readonly type: "effort"; readonly values: ReadonlyArray<string | null> }
                          | { readonly type: "toggle" }
                          | {
                              readonly type: "budget_tokens"
                              readonly min?: number | undefined
                              readonly max?: number | undefined
                            }
                        >
                      | undefined
                    readonly variants?:
                      | {
                          readonly [x: string]: {
                            readonly disabled?: boolean | undefined
                            readonly [x: string]: unknown | undefined
                          }
                        }
                      | undefined
                    readonly disabled?: boolean | undefined
                  }
                }
              | undefined
            readonly auth_provider?: string | undefined
            readonly whitelist?: ReadonlyArray<string> | undefined
            readonly blacklist?: ReadonlyArray<string> | undefined
            readonly options?:
              | {
                  readonly apiKey?: string | undefined
                  readonly baseURL?: string | undefined
                  readonly enterpriseUrl?: string | undefined
                  readonly setCacheKey?: boolean | undefined
                  readonly timeout?: number | false | undefined
                  readonly headerTimeout?: number | false | undefined
                  readonly chunkTimeout?: number | undefined
                  readonly [x: string]: unknown | undefined
                }
              | undefined
          }
        }
      | undefined
    readonly mcp?:
      | {
          readonly [x: string]:
            | {
                readonly type: "local"
                readonly command: ReadonlyArray<string>
                readonly environment?: { readonly [x: string]: string } | undefined
                readonly enabled?: boolean | undefined
                readonly timeout?: number | undefined
              }
            | {
                readonly type: "remote"
                readonly url: string
                readonly enabled?: boolean | undefined
                readonly headers?: { readonly [x: string]: string } | undefined
                readonly oauth?:
                  | {
                      readonly clientId?: string | undefined
                      readonly clientSecret?: string | undefined
                      readonly scope?: string | undefined
                    }
                  | false
                  | undefined
                readonly timeout?: number | undefined
              }
            | { readonly enabled: boolean }
        }
      | undefined
    readonly connectors?:
      | {
          readonly [x: string]:
            | { readonly type: "figma"; readonly token?: string | undefined; readonly enabled?: boolean | undefined }
            | {
                readonly type: "slack"
                readonly botToken?: string | undefined
                readonly teamId?: string | undefined
                readonly enabled?: boolean | undefined
              }
            | {
                readonly type: "github"
                readonly token?: string | undefined
                readonly oauthClientId?: string | undefined
                readonly clientId?: string | undefined
                readonly enabled?: boolean | undefined
              }
            | {
                readonly type: "lovable"
                readonly token?: string | undefined
                readonly apiKey?: string | undefined
                readonly enabled?: boolean | undefined
              }
            | {
                readonly type: "discord"
                readonly botToken?: string | undefined
                readonly enabled?: boolean | undefined
              }
            | { readonly type: "teams"; readonly botToken?: string | undefined; readonly enabled?: boolean | undefined }
            | { readonly type: "gchat"; readonly botToken?: string | undefined; readonly enabled?: boolean | undefined }
            | {
                readonly type: "linear"
                readonly botToken?: string | undefined
                readonly enabled?: boolean | undefined
              }
            | { readonly enabled: boolean }
        }
      | undefined
    readonly formatter?:
      | false
      | true
      | {
          readonly [x: string]: {
            readonly disabled?: boolean | undefined
            readonly command?: ReadonlyArray<string> | undefined
            readonly environment?: { readonly [x: string]: string } | undefined
            readonly extensions?: ReadonlyArray<string> | undefined
          }
        }
      | undefined
    readonly websearch?:
      | {
          readonly provider?: "exa" | "parallel" | "mcp" | undefined
          readonly apiKey?: string | undefined
          readonly url?: string | undefined
          readonly tool?: string | undefined
        }
      | undefined
    readonly lsp?:
      | false
      | {
          readonly [x: string]:
            | { readonly disabled: true }
            | {
                readonly command: ReadonlyArray<string>
                readonly extensions?: ReadonlyArray<string> | undefined
                readonly disabled?: boolean | undefined
                readonly env?: { readonly [x: string]: string } | undefined
                readonly initialization?: { readonly [x: string]: unknown } | undefined
                readonly min_severity?: number | undefined
              }
        }
      | undefined
    readonly instructions?: ReadonlyArray<string> | undefined
    readonly layout?: ("auto" | "stretch") | undefined
    readonly permission?:
      | {
          readonly [x: string]:
            | (("ask" | "allow" | "deny") | { readonly [x: string]: "ask" | "allow" | "deny" })
            | undefined
        }
      | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly tool?:
      | {
          readonly allow?: ReadonlyArray<string> | undefined
          readonly pin?: { readonly [x: string]: string } | undefined
        }
      | undefined
    readonly enterprise?: { readonly url?: string | undefined } | undefined
    readonly compaction?:
      | {
          readonly auto?: boolean | undefined
          readonly prune?: boolean | undefined
          readonly reserved?: number | undefined
        }
      | undefined
    readonly experimental?:
      | {
          readonly policies?:
            | ReadonlyArray<{ readonly effect: "allow" | "deny"; readonly action: string; readonly resource: string }>
            | undefined
          readonly hook?:
            | {
                readonly file_edited?:
                  | {
                      readonly [x: string]: ReadonlyArray<{
                        readonly command: ReadonlyArray<string>
                        readonly environment?: { readonly [x: string]: string } | undefined
                      }>
                    }
                  | undefined
                readonly session_completed?:
                  | ReadonlyArray<{
                      readonly command: ReadonlyArray<string>
                      readonly environment?: { readonly [x: string]: string } | undefined
                    }>
                  | undefined
              }
            | undefined
          readonly queued_message_wrap?:
            | { readonly header: string; readonly footer: string }
            | "default"
            | boolean
            | null
            | undefined
          readonly chatMaxRetries?: number | undefined
          readonly disable_paste_summary?: boolean | undefined
          readonly batch_tool?: boolean | undefined
          readonly openTelemetry?: boolean | undefined
          readonly primary_tools?: ReadonlyArray<string> | undefined
          readonly continue_loop_on_deny?: boolean | undefined
          readonly brain?: boolean | undefined
          readonly brainMinHours?: number | undefined
          readonly brainMinSessions?: number | undefined
          readonly brainModel?: string | undefined
          readonly memory?: boolean | undefined
          readonly mcp_timeout?: number | undefined
          readonly tool_timeout?: number | false | undefined
          readonly task_timeout?: number | false | undefined
          readonly nativeLlm?: boolean | undefined
          readonly tui?:
            | {
                readonly cacheEviction?: boolean | undefined
                readonly messageVirtualization?: boolean | undefined
                readonly explorationGrouping?: boolean | undefined
              }
            | undefined
          readonly requests?: { readonly latestOnlyLspRefresh?: boolean | undefined } | undefined
          readonly events?: { readonly schemaEncoding?: boolean | undefined } | undefined
        }
      | undefined
    readonly rag?: { readonly model?: string | undefined; readonly provider?: string | undefined } | undefined
    readonly image?: { readonly model?: string | undefined; readonly provider?: string | undefined } | undefined
    readonly browser?: unknown | undefined
    readonly computer?:
      | {
          readonly mode?: "sandbox" | "host" | undefined
          readonly width?: number | undefined
          readonly height?: number | undefined
        }
      | undefined
    readonly attachment?:
      | {
          readonly image?:
            | {
                readonly auto_resize?: boolean | undefined
                readonly max_width?: number | undefined
                readonly max_height?: number | undefined
                readonly max_base64_bytes?: number | undefined
              }
            | undefined
        }
      | undefined
    readonly speak?:
      | {
          readonly provider?: string | undefined
          readonly model?: string | undefined
          readonly modelId?: string | undefined
          readonly outputFormat?: string | undefined
        }
      | undefined
    readonly notifications?:
      | {
          readonly todo?:
            | {
                readonly enabled?: boolean | undefined
                readonly macos?: boolean | undefined
                readonly slack?:
                  | {
                      readonly enabled?: boolean | undefined
                      readonly connector?: string | undefined
                      readonly channel?: string | undefined
                    }
                  | undefined
                readonly discord?:
                  | { readonly enabled?: boolean | undefined; readonly webhook?: string | undefined }
                  | undefined
              }
            | undefined
          readonly icon?: { readonly url?: string | undefined; readonly alt?: string | undefined } | undefined
          readonly notify?:
            | {
                readonly enabled?: boolean | undefined
                readonly macos?: boolean | undefined
                readonly slack?:
                  | {
                      readonly enabled?: boolean | undefined
                      readonly connector?: string | undefined
                      readonly channel?: string | undefined
                    }
                  | undefined
                readonly discord?:
                  | { readonly enabled?: boolean | undefined; readonly webhook?: string | undefined }
                  | undefined
                readonly events?:
                  | {
                      readonly sessionIdle?: boolean | undefined
                      readonly sessionError?: boolean | undefined
                      readonly permissionAsked?: boolean | undefined
                      readonly questionAsked?: boolean | undefined
                    }
                  | undefined
                readonly idleMinMs?: number | undefined
                readonly rateLimit?:
                  | { readonly windowMs?: number | undefined; readonly maxPerWindow?: number | undefined }
                  | undefined
                readonly retry?:
                  | {
                      readonly attempts?: number | undefined
                      readonly delay?: number | undefined
                      readonly factor?: number | undefined
                      readonly maxDelay?: number | undefined
                      readonly timeoutMs?: number | undefined
                    }
                  | undefined
                readonly breaker?:
                  | { readonly failures?: number | undefined; readonly cooldownMs?: number | undefined }
                  | undefined
                readonly quietHours?:
                  | {
                      readonly enabled?: boolean | undefined
                      readonly start?: string | undefined
                      readonly end?: string | undefined
                      readonly suppress?: ReadonlyArray<"macos" | "slack" | "discord"> | undefined
                    }
                  | undefined
              }
            | undefined
        }
      | undefined
    readonly mobile?:
      | {
          readonly tophat?:
            | {
                readonly enabled?: boolean | undefined
                readonly cliPath?: string | undefined
                readonly defaultPlatform?: "ios" | "android" | undefined
                readonly defaultDestination?: "device" | "simulator" | "emulator" | undefined
                readonly autoDetect?: boolean | undefined
              }
            | undefined
        }
      | undefined
    readonly [x: string]: unknown
  }
}

export type ConfigUpdateOutput = Config

export type ConfigProvidersOutput = ConfigProviders

export type ConnectorsStatusOutput = ConnectorsStatusOutput2

export type ConnectorsAuthSetInput = { readonly name: { readonly name: string }["name"]; readonly payload: unknown }

export type ConnectorsAuthSetOutput = ConnectorsSuccess

export type ConnectorsAuthRemoveInput = { readonly name: { readonly name: string }["name"] }

export type ConnectorsAuthRemoveOutput = ConnectorsSuccess

export type ConnectorsInvalidateInput = { readonly name?: { readonly name?: string | undefined }["name"] }

export type ConnectorsInvalidateOutput = ConnectorsSuccess

export type DoctorRunOutput = DoctorReport

export type ExperimentalToolIDsOutput = ToolIDs

export type ExperimentalToolsInput = {
  readonly provider: { readonly provider: string; readonly model: string }["provider"]
  readonly model: { readonly provider: string; readonly model: string }["model"]
}

export type ExperimentalToolsOutput = ToolList

export type ExperimentalWorktreeCreateInput = {
  readonly name?: {
    readonly name?: string | undefined
    readonly branch?: string | undefined
    readonly branchPrefix?: string | undefined
    readonly baseBranch?: string | undefined
    readonly remote?: string | undefined
    readonly startCommand?: string | undefined
  }["name"]
  readonly branch?: {
    readonly name?: string | undefined
    readonly branch?: string | undefined
    readonly branchPrefix?: string | undefined
    readonly baseBranch?: string | undefined
    readonly remote?: string | undefined
    readonly startCommand?: string | undefined
  }["branch"]
  readonly branchPrefix?: {
    readonly name?: string | undefined
    readonly branch?: string | undefined
    readonly branchPrefix?: string | undefined
    readonly baseBranch?: string | undefined
    readonly remote?: string | undefined
    readonly startCommand?: string | undefined
  }["branchPrefix"]
  readonly baseBranch?: {
    readonly name?: string | undefined
    readonly branch?: string | undefined
    readonly branchPrefix?: string | undefined
    readonly baseBranch?: string | undefined
    readonly remote?: string | undefined
    readonly startCommand?: string | undefined
  }["baseBranch"]
  readonly remote?: {
    readonly name?: string | undefined
    readonly branch?: string | undefined
    readonly branchPrefix?: string | undefined
    readonly baseBranch?: string | undefined
    readonly remote?: string | undefined
    readonly startCommand?: string | undefined
  }["remote"]
  readonly startCommand?: {
    readonly name?: string | undefined
    readonly branch?: string | undefined
    readonly branchPrefix?: string | undefined
    readonly baseBranch?: string | undefined
    readonly remote?: string | undefined
    readonly startCommand?: string | undefined
  }["startCommand"]
}

export type ExperimentalWorktreeCreateOutput = Worktree

export type ExperimentalWorktreeOutput = WorktreeList

export type ExperimentalWorktreeRemoveInput = { readonly directory: { readonly directory: string }["directory"] }

export type ExperimentalWorktreeRemoveOutput = boolean

export type ExperimentalWorktreeResetInput = { readonly directory: { readonly directory: string }["directory"] }

export type ExperimentalWorktreeResetOutput = boolean

export type ExperimentalResourceOutput = McpResourceMap

export type ExperimentalManagedWorktreeCreateInput = {
  readonly from: {
    readonly from: string
    readonly name?: string | undefined
    readonly into?: string | undefined
  }["from"]
  readonly name?: {
    readonly from: string
    readonly name?: string | undefined
    readonly into?: string | undefined
  }["name"]
  readonly into?: {
    readonly from: string
    readonly name?: string | undefined
    readonly into?: string | undefined
  }["into"]
}

export type ExperimentalManagedWorktreeCreateOutput = ManagedWorktreeInfo

export type ExperimentalManagedWorktreeRemoveInput = { readonly at: { readonly at: string }["at"] }

export type ExperimentalManagedWorktreeRemoveOutput = null

export type ExperimentalManagedWorktreeLinkInput = {
  readonly at: { readonly at: string; readonly to?: string | undefined }["at"]
  readonly to?: { readonly at: string; readonly to?: string | undefined }["to"]
}

export type ExperimentalManagedWorktreeLinkOutput = ManagedWorktreeInfo

export type ExperimentalManagedWorktreeChildrenInput = { readonly of: { readonly of: string }["of"] }

export type ExperimentalManagedWorktreeChildrenOutput = ManagedWorktreeList

export type ExperimentalManagedWorktreeAncestorsInput = { readonly of: { readonly of: string }["of"] }

export type ExperimentalManagedWorktreeAncestorsOutput = ManagedWorktreeList

export type ExperimentalManagedWorktreeListOutput = ManagedWorktreeList

export type FileFindTextInput = { readonly pattern: { readonly pattern: string }["pattern"] }

export type FileFindTextOutput = Array<SearchMatch>

export type FileFindFileInput = {
  readonly query: {
    readonly query: string
    readonly dirs?: "true" | "false" | undefined
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["query"]
  readonly dirs?: {
    readonly query: string
    readonly dirs?: "true" | "false" | undefined
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["dirs"]
  readonly type?: {
    readonly query: string
    readonly dirs?: "true" | "false" | undefined
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["type"]
  readonly limit?: {
    readonly query: string
    readonly dirs?: "true" | "false" | undefined
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["limit"]
}

export type FileFindFileOutput = Array<string>

export type FileFindSymbolInput = { readonly query: { readonly query: string }["query"] }

export type FileFindSymbolOutput = Array<Symbol>

export type FileListInput = { readonly path: { readonly path: string }["path"] }

export type FileListOutput = Array<FileNode>

export type FileContentInput = { readonly path: { readonly path: string }["path"] }

export type FileContentOutput = FileContent

export type FileWriteInput = {
  readonly path: { readonly path: string; readonly content: string }["path"]
  readonly content: { readonly path: string; readonly content: string }["content"]
}

export type FileWriteOutput = FileWriteResult

export type FileStatusOutput = Array<File>

export type GlobalHealthOutput = GlobalHealth

export type GlobalDisposeOutput = boolean

export type McpStatusOutput = MCPStatusMap

export type McpAddInput = {
  readonly name: {
    readonly name: string
    readonly config:
      | {
          readonly type: "local"
          readonly command: ReadonlyArray<string>
          readonly environment?: { readonly [x: string]: string } | undefined
          readonly enabled?: boolean | undefined
          readonly timeout?: number | undefined
        }
      | {
          readonly type: "remote"
          readonly url: string
          readonly enabled?: boolean | undefined
          readonly headers?: { readonly [x: string]: string } | undefined
          readonly oauth?:
            | {
                readonly clientId?: string | undefined
                readonly clientSecret?: string | undefined
                readonly scope?: string | undefined
              }
            | false
            | undefined
          readonly timeout?: number | undefined
        }
  }["name"]
  readonly config: {
    readonly name: string
    readonly config:
      | {
          readonly type: "local"
          readonly command: ReadonlyArray<string>
          readonly environment?: { readonly [x: string]: string } | undefined
          readonly enabled?: boolean | undefined
          readonly timeout?: number | undefined
        }
      | {
          readonly type: "remote"
          readonly url: string
          readonly enabled?: boolean | undefined
          readonly headers?: { readonly [x: string]: string } | undefined
          readonly oauth?:
            | {
                readonly clientId?: string | undefined
                readonly clientSecret?: string | undefined
                readonly scope?: string | undefined
              }
            | false
            | undefined
          readonly timeout?: number | undefined
        }
  }["config"]
}

export type McpAddOutput = MCPStatusMap

export type McpStartAuthInput = { readonly name: { readonly name: string }["name"] }

export type McpStartAuthOutput = McpStartAuthResponse

export type McpAuthCallbackInput = {
  readonly name: { readonly name: string }["name"]
  readonly code: { readonly code: string }["code"]
}

export type McpAuthCallbackOutput = MCPStatus

export type McpAuthenticateInput = { readonly name: { readonly name: string }["name"] }

export type McpAuthenticateOutput = MCPStatus

export type McpRemoveAuthInput = { readonly name: { readonly name: string }["name"] }

export type McpRemoveAuthOutput = McpMutationSuccess

export type McpConnectInput = { readonly name: { readonly name: string }["name"] }

export type McpConnectOutput = boolean

export type McpDisconnectInput = { readonly name: { readonly name: string }["name"] }

export type McpDisconnectOutput = boolean

export type McpToggleInput = {
  readonly name: { readonly name: string }["name"]
  readonly enabled: { readonly enabled: boolean }["enabled"]
}

export type McpToggleOutput = MCPStatusMap

export type MissionListOutput = MissionListOutput2

export type MissionTemplatesOutput = MissionTemplatesOutput2

export type MissionGenerateInput = {
  readonly description: {
    readonly description: string
    readonly model?: string | undefined
    readonly agent?: string | undefined
  }["description"]
  readonly model?: {
    readonly description: string
    readonly model?: string | undefined
    readonly agent?: string | undefined
  }["model"]
  readonly agent?: {
    readonly description: string
    readonly model?: string | undefined
    readonly agent?: string | undefined
  }["agent"]
}

export type MissionGenerateOutput = MissionDefinition

export type MissionRecentExecsInput = { readonly limit?: { readonly limit?: number | undefined }["limit"] }

export type MissionRecentExecsOutput = MissionExecsOutput2

export type MissionGetInput = { readonly id: { readonly id: string }["id"] }

export type MissionGetOutput = MissionGetOutput2

export type MissionUpsertInput = { readonly payload: unknown }

export type MissionUpsertOutput = MissionDefinition

export type MissionUpdateInput = { readonly id: { readonly id: string }["id"]; readonly payload: unknown }

export type MissionUpdateOutput = MissionDefinition

export type MissionRemoveInput = { readonly id: { readonly id: string }["id"] }

export type MissionRemoveOutput = MissionBooleanResult

export type MissionStartInput = { readonly id: { readonly id: string }["id"] }

export type MissionStartOutput = MissionBooleanResult

export type MissionPauseInput = { readonly id: { readonly id: string }["id"] }

export type MissionPauseOutput = MissionBooleanResult

export type MissionCancelInput = { readonly id: { readonly id: string }["id"] }

export type MissionCancelOutput = MissionBooleanResult

export type MissionFeatureMutateInput = {
  readonly id: { readonly id: string; readonly featureID: string }["id"]
  readonly featureID: { readonly id: string; readonly featureID: string }["featureID"]
  readonly status?: {
    readonly status?: "pending" | "running" | "done" | "blocked" | "skipped" | "error" | undefined
    readonly error?: string | undefined
    readonly appendDependsOn?: ReadonlyArray<string> | undefined
  }["status"]
  readonly error?: {
    readonly status?: "pending" | "running" | "done" | "blocked" | "skipped" | "error" | undefined
    readonly error?: string | undefined
    readonly appendDependsOn?: ReadonlyArray<string> | undefined
  }["error"]
  readonly appendDependsOn?: {
    readonly status?: "pending" | "running" | "done" | "blocked" | "skipped" | "error" | undefined
    readonly error?: string | undefined
    readonly appendDependsOn?: ReadonlyArray<string> | undefined
  }["appendDependsOn"]
}

export type MissionFeatureMutateOutput = MissionDefinition

export type MissionExecsInput = {
  readonly id: { readonly id: string }["id"]
  readonly limit?: { readonly limit?: number | undefined }["limit"]
}

export type MissionExecsOutput = MissionExecsOutput2

export type MobileAuthTokenListOutput = Array<MobileAuthTokenPublic>

export type MobileAuthTokenCreateInput = {
  readonly name?: { readonly name?: string | undefined; readonly expiresInDays?: number | undefined }["name"]
  readonly expiresInDays?: {
    readonly name?: string | undefined
    readonly expiresInDays?: number | undefined
  }["expiresInDays"]
}

export type MobileAuthTokenCreateOutput = { token: string; info: MobileAuthTokenPublic }

export type MobileAuthTokenRevokeInput = { readonly id: { readonly id: string }["id"] }

export type MobileAuthTokenRevokeOutput = { revoked: boolean }

export type MobileBootstrapOutput = MobileBootstrap

export type MobileCommandListOutput = Array<MobileCommand>

export type MobileProjectListOutput = Array<MobileProject>

export type MobileMemoryHistoryOutput = Array<MobilePromptHistoryEntry>

export type MobileMemorySearchInput = { readonly query: { readonly query: string }["query"] }

export type MobileMemorySearchOutput = Array<MobileMemorySearchHit>

export type MobileMemoryStashListOutput = Array<MobilePromptStashEntry>

export type MobileMemoryStashCreateInput = { readonly input: { readonly input: string }["input"] }

export type MobileMemoryStashCreateOutput = MobilePromptStashEntry

export type MobileMemoryStashDeleteInput = { readonly id: { readonly id: string }["id"] }

export type MobileMemoryStashDeleteOutput = MobileSuccess

export type MobileGithubReposOutput = Array<any>

export type MobileGithubBranchesInput = {
  readonly owner: { readonly owner: string; readonly repo: string }["owner"]
  readonly repo: { readonly owner: string; readonly repo: string }["repo"]
}

export type MobileGithubBranchesOutput = Array<MobileGithubBranch>

export type MobileGithubImportsOutput = Array<MobileGithubImport>

export type MobileGithubOauthClientInput = { readonly clientId: { readonly clientId: string }["clientId"] }

export type MobileGithubOauthClientOutput = MobileConfigInfo

export type MobileGithubOauthDeviceStartOutput = MobileGithubDeviceAuthStart

export type MobileGithubOauthDevicePollInput = { readonly deviceCode: { readonly deviceCode: string }["deviceCode"] }

export type MobileGithubOauthDevicePollOutput = MobileGithubDeviceAuthPollResult

export type MobileGithubAuthSetInput = { readonly token: { readonly token: string }["token"] }

export type MobileGithubAuthSetOutput = MobileSuccess

export type MobileGithubAuthRemoveOutput = MobileSuccess

export type MobileGithubImportInput = { readonly payload: unknown }

export type MobileGithubImportOutput = { import: MobileGithubImport; project: Project }

export type MobileGithubSessionCreateInput = {
  readonly owner: {
    readonly owner: string
    readonly repo: string
    readonly cloneUrl: string
    readonly htmlUrl?: string | undefined
    readonly defaultBranch: string
    readonly baseBranch: string
    readonly private?: boolean | undefined
    readonly title?: string | undefined
    readonly executionTarget?: "local" | "container" | undefined
  }["owner"]
  readonly repo: {
    readonly owner: string
    readonly repo: string
    readonly cloneUrl: string
    readonly htmlUrl?: string | undefined
    readonly defaultBranch: string
    readonly baseBranch: string
    readonly private?: boolean | undefined
    readonly title?: string | undefined
    readonly executionTarget?: "local" | "container" | undefined
  }["repo"]
  readonly cloneUrl: {
    readonly owner: string
    readonly repo: string
    readonly cloneUrl: string
    readonly htmlUrl?: string | undefined
    readonly defaultBranch: string
    readonly baseBranch: string
    readonly private?: boolean | undefined
    readonly title?: string | undefined
    readonly executionTarget?: "local" | "container" | undefined
  }["cloneUrl"]
  readonly htmlUrl?: {
    readonly owner: string
    readonly repo: string
    readonly cloneUrl: string
    readonly htmlUrl?: string | undefined
    readonly defaultBranch: string
    readonly baseBranch: string
    readonly private?: boolean | undefined
    readonly title?: string | undefined
    readonly executionTarget?: "local" | "container" | undefined
  }["htmlUrl"]
  readonly defaultBranch: {
    readonly owner: string
    readonly repo: string
    readonly cloneUrl: string
    readonly htmlUrl?: string | undefined
    readonly defaultBranch: string
    readonly baseBranch: string
    readonly private?: boolean | undefined
    readonly title?: string | undefined
    readonly executionTarget?: "local" | "container" | undefined
  }["defaultBranch"]
  readonly baseBranch: {
    readonly owner: string
    readonly repo: string
    readonly cloneUrl: string
    readonly htmlUrl?: string | undefined
    readonly defaultBranch: string
    readonly baseBranch: string
    readonly private?: boolean | undefined
    readonly title?: string | undefined
    readonly executionTarget?: "local" | "container" | undefined
  }["baseBranch"]
  readonly private?: {
    readonly owner: string
    readonly repo: string
    readonly cloneUrl: string
    readonly htmlUrl?: string | undefined
    readonly defaultBranch: string
    readonly baseBranch: string
    readonly private?: boolean | undefined
    readonly title?: string | undefined
    readonly executionTarget?: "local" | "container" | undefined
  }["private"]
  readonly title?: {
    readonly owner: string
    readonly repo: string
    readonly cloneUrl: string
    readonly htmlUrl?: string | undefined
    readonly defaultBranch: string
    readonly baseBranch: string
    readonly private?: boolean | undefined
    readonly title?: string | undefined
    readonly executionTarget?: "local" | "container" | undefined
  }["title"]
  readonly executionTarget?: {
    readonly owner: string
    readonly repo: string
    readonly cloneUrl: string
    readonly htmlUrl?: string | undefined
    readonly defaultBranch: string
    readonly baseBranch: string
    readonly private?: boolean | undefined
    readonly title?: string | undefined
    readonly executionTarget?: "local" | "container" | undefined
  }["executionTarget"]
}

export type MobileGithubSessionCreateOutput = MobileGithubSessionCreateResult

export type MobileSessionListInput = {
  readonly limit?: { readonly limit?: number | undefined; readonly search?: string | undefined }["limit"]
  readonly search?: { readonly limit?: number | undefined; readonly search?: string | undefined }["search"]
}

export type MobileSessionListOutput = Array<MobileSessionSummary>

export type MobileSessionCreateInput = {
  readonly parentID?: {
    readonly parentID?: string | undefined
    readonly title?: string | undefined
    readonly permission?: unknown | undefined
    readonly github?: unknown | undefined
    readonly executionTarget?: "local" | "container" | undefined
  }["parentID"]
  readonly title?: {
    readonly parentID?: string | undefined
    readonly title?: string | undefined
    readonly permission?: unknown | undefined
    readonly github?: unknown | undefined
    readonly executionTarget?: "local" | "container" | undefined
  }["title"]
  readonly permission?: {
    readonly parentID?: string | undefined
    readonly title?: string | undefined
    readonly permission?: unknown | undefined
    readonly github?: unknown | undefined
    readonly executionTarget?: "local" | "container" | undefined
  }["permission"]
  readonly github?: {
    readonly parentID?: string | undefined
    readonly title?: string | undefined
    readonly permission?: unknown | undefined
    readonly github?: unknown | undefined
    readonly executionTarget?: "local" | "container" | undefined
  }["github"]
  readonly executionTarget?: {
    readonly parentID?: string | undefined
    readonly title?: string | undefined
    readonly permission?: unknown | undefined
    readonly github?: unknown | undefined
    readonly executionTarget?: "local" | "container" | undefined
  }["executionTarget"]
}

export type MobileSessionCreateOutput = Session

export type MobileSessionDetailInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type MobileSessionDetailOutput = MobileSessionDetail

export type MobileSessionDeleteInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type MobileSessionDeleteOutput = MobileSuccess

export type MobileSessionDiffInput = {
  readonly sessionID: { readonly sessionID: string; readonly messageID: string }["sessionID"]
  readonly messageID: { readonly sessionID: string; readonly messageID: string }["messageID"]
}

export type MobileSessionDiffOutput = Array<FileDiff>

export type MobileSessionCommandListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type MobileSessionCommandListOutput = Array<MobileCommand>

export type MobileSessionCommandInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly command: {
    readonly command: string
    readonly arguments?: string | undefined
    readonly agent?: string | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly variant?: string | undefined
  }["command"]
  readonly arguments?: {
    readonly command: string
    readonly arguments?: string | undefined
    readonly agent?: string | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly variant?: string | undefined
  }["arguments"]
  readonly agent?: {
    readonly command: string
    readonly arguments?: string | undefined
    readonly agent?: string | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly variant?: string | undefined
  }["agent"]
  readonly model?: {
    readonly command: string
    readonly arguments?: string | undefined
    readonly agent?: string | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly variant?: string | undefined
  }["model"]
  readonly variant?: {
    readonly command: string
    readonly arguments?: string | undefined
    readonly agent?: string | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly variant?: string | undefined
  }["variant"]
}

export type MobileSessionCommandOutput = { info: Message; parts: Array<Part> }

export type MobileSessionMessageInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID?: {
    readonly messageID?: string | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?: unknown | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "reasoning"
          readonly text: string
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly time: { readonly start: number; readonly end?: number | undefined }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "tool"
          readonly callID: string
          readonly tool: string
          readonly state:
            | { readonly status: "pending"; readonly input: { readonly [x: string]: any }; readonly raw: string }
            | {
                readonly status: "running"
                readonly input: { readonly [x: string]: any }
                readonly title?: string | undefined
                readonly metadata?: { readonly [x: string]: any } | undefined
                readonly structured?: { readonly [x: string]: unknown } | undefined
                readonly content?:
                  | ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | {
                          readonly type: "file"
                          readonly data: string
                          readonly mime: string
                          readonly name?: string | undefined
                        }
                    >
                  | undefined
                readonly time: { readonly start: number }
              }
            | {
                readonly status: "completed"
                readonly input: { readonly [x: string]: any }
                readonly output: string
                readonly title: string
                readonly metadata: { readonly [x: string]: any }
                readonly time: { readonly start: number; readonly end: number; readonly compacted?: number | undefined }
                readonly attachments?:
                  | ReadonlyArray<{
                      readonly id: string
                      readonly sessionID: string
                      readonly messageID: string
                      readonly type: "file"
                      readonly mime: string
                      readonly filename?: string | undefined
                      readonly url: string
                      readonly source?:
                        | (
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "file"
                                readonly path: string
                              }
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "symbol"
                                readonly path: string
                                readonly range: {
                                  readonly start: { readonly line: number; readonly character: number }
                                  readonly end: { readonly line: number; readonly character: number }
                                }
                                readonly name: string
                                readonly kind: number
                              }
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "resource"
                                readonly clientName: string
                                readonly uri: string
                              }
                          )
                        | undefined
                    }>
                  | undefined
              }
            | {
                readonly status: "error"
                readonly input: { readonly [x: string]: any }
                readonly error: string
                readonly metadata?: { readonly [x: string]: any } | undefined
                readonly time: { readonly start: number; readonly end: number }
              }
          readonly metadata?: { readonly [x: string]: any } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "step-start"
          readonly snapshot?: string | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "step-finish"
          readonly reason: string
          readonly snapshot?: string | undefined
          readonly cost: number
          readonly tokens: {
            readonly total?: number | undefined
            readonly input: number
            readonly output: number
            readonly reasoning: number
            readonly cache: { readonly read: number; readonly write: number }
          }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "snapshot"
          readonly snapshot: string
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "patch"
          readonly hash: string
          readonly files: ReadonlyArray<string>
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "retry"
          readonly attempt: number
          readonly error: {
            readonly name: "APIError"
            readonly data: {
              readonly message: string
              readonly statusCode?: number | undefined
              readonly isRetryable: boolean
              readonly responseHeaders?: { readonly [x: string]: string } | undefined
              readonly responseBody?: string | undefined
              readonly metadata?: { readonly [x: string]: string } | undefined
              readonly classification?: "payload-too-large" | undefined
            }
          }
          readonly time: { readonly created: number }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "compaction"
          readonly auto: boolean
        }
    >
  }["messageID"]
  readonly model?: {
    readonly messageID?: string | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?: unknown | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "reasoning"
          readonly text: string
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly time: { readonly start: number; readonly end?: number | undefined }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "tool"
          readonly callID: string
          readonly tool: string
          readonly state:
            | { readonly status: "pending"; readonly input: { readonly [x: string]: any }; readonly raw: string }
            | {
                readonly status: "running"
                readonly input: { readonly [x: string]: any }
                readonly title?: string | undefined
                readonly metadata?: { readonly [x: string]: any } | undefined
                readonly structured?: { readonly [x: string]: unknown } | undefined
                readonly content?:
                  | ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | {
                          readonly type: "file"
                          readonly data: string
                          readonly mime: string
                          readonly name?: string | undefined
                        }
                    >
                  | undefined
                readonly time: { readonly start: number }
              }
            | {
                readonly status: "completed"
                readonly input: { readonly [x: string]: any }
                readonly output: string
                readonly title: string
                readonly metadata: { readonly [x: string]: any }
                readonly time: { readonly start: number; readonly end: number; readonly compacted?: number | undefined }
                readonly attachments?:
                  | ReadonlyArray<{
                      readonly id: string
                      readonly sessionID: string
                      readonly messageID: string
                      readonly type: "file"
                      readonly mime: string
                      readonly filename?: string | undefined
                      readonly url: string
                      readonly source?:
                        | (
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "file"
                                readonly path: string
                              }
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "symbol"
                                readonly path: string
                                readonly range: {
                                  readonly start: { readonly line: number; readonly character: number }
                                  readonly end: { readonly line: number; readonly character: number }
                                }
                                readonly name: string
                                readonly kind: number
                              }
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "resource"
                                readonly clientName: string
                                readonly uri: string
                              }
                          )
                        | undefined
                    }>
                  | undefined
              }
            | {
                readonly status: "error"
                readonly input: { readonly [x: string]: any }
                readonly error: string
                readonly metadata?: { readonly [x: string]: any } | undefined
                readonly time: { readonly start: number; readonly end: number }
              }
          readonly metadata?: { readonly [x: string]: any } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "step-start"
          readonly snapshot?: string | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "step-finish"
          readonly reason: string
          readonly snapshot?: string | undefined
          readonly cost: number
          readonly tokens: {
            readonly total?: number | undefined
            readonly input: number
            readonly output: number
            readonly reasoning: number
            readonly cache: { readonly read: number; readonly write: number }
          }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "snapshot"
          readonly snapshot: string
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "patch"
          readonly hash: string
          readonly files: ReadonlyArray<string>
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "retry"
          readonly attempt: number
          readonly error: {
            readonly name: "APIError"
            readonly data: {
              readonly message: string
              readonly statusCode?: number | undefined
              readonly isRetryable: boolean
              readonly responseHeaders?: { readonly [x: string]: string } | undefined
              readonly responseBody?: string | undefined
              readonly metadata?: { readonly [x: string]: string } | undefined
              readonly classification?: "payload-too-large" | undefined
            }
          }
          readonly time: { readonly created: number }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "compaction"
          readonly auto: boolean
        }
    >
  }["model"]
  readonly agent?: {
    readonly messageID?: string | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?: unknown | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "reasoning"
          readonly text: string
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly time: { readonly start: number; readonly end?: number | undefined }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "tool"
          readonly callID: string
          readonly tool: string
          readonly state:
            | { readonly status: "pending"; readonly input: { readonly [x: string]: any }; readonly raw: string }
            | {
                readonly status: "running"
                readonly input: { readonly [x: string]: any }
                readonly title?: string | undefined
                readonly metadata?: { readonly [x: string]: any } | undefined
                readonly structured?: { readonly [x: string]: unknown } | undefined
                readonly content?:
                  | ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | {
                          readonly type: "file"
                          readonly data: string
                          readonly mime: string
                          readonly name?: string | undefined
                        }
                    >
                  | undefined
                readonly time: { readonly start: number }
              }
            | {
                readonly status: "completed"
                readonly input: { readonly [x: string]: any }
                readonly output: string
                readonly title: string
                readonly metadata: { readonly [x: string]: any }
                readonly time: { readonly start: number; readonly end: number; readonly compacted?: number | undefined }
                readonly attachments?:
                  | ReadonlyArray<{
                      readonly id: string
                      readonly sessionID: string
                      readonly messageID: string
                      readonly type: "file"
                      readonly mime: string
                      readonly filename?: string | undefined
                      readonly url: string
                      readonly source?:
                        | (
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "file"
                                readonly path: string
                              }
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "symbol"
                                readonly path: string
                                readonly range: {
                                  readonly start: { readonly line: number; readonly character: number }
                                  readonly end: { readonly line: number; readonly character: number }
                                }
                                readonly name: string
                                readonly kind: number
                              }
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "resource"
                                readonly clientName: string
                                readonly uri: string
                              }
                          )
                        | undefined
                    }>
                  | undefined
              }
            | {
                readonly status: "error"
                readonly input: { readonly [x: string]: any }
                readonly error: string
                readonly metadata?: { readonly [x: string]: any } | undefined
                readonly time: { readonly start: number; readonly end: number }
              }
          readonly metadata?: { readonly [x: string]: any } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "step-start"
          readonly snapshot?: string | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "step-finish"
          readonly reason: string
          readonly snapshot?: string | undefined
          readonly cost: number
          readonly tokens: {
            readonly total?: number | undefined
            readonly input: number
            readonly output: number
            readonly reasoning: number
            readonly cache: { readonly read: number; readonly write: number }
          }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "snapshot"
          readonly snapshot: string
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "patch"
          readonly hash: string
          readonly files: ReadonlyArray<string>
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "retry"
          readonly attempt: number
          readonly error: {
            readonly name: "APIError"
            readonly data: {
              readonly message: string
              readonly statusCode?: number | undefined
              readonly isRetryable: boolean
              readonly responseHeaders?: { readonly [x: string]: string } | undefined
              readonly responseBody?: string | undefined
              readonly metadata?: { readonly [x: string]: string } | undefined
              readonly classification?: "payload-too-large" | undefined
            }
          }
          readonly time: { readonly created: number }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "compaction"
          readonly auto: boolean
        }
    >
  }["agent"]
  readonly noReply?: {
    readonly messageID?: string | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?: unknown | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "reasoning"
          readonly text: string
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly time: { readonly start: number; readonly end?: number | undefined }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "tool"
          readonly callID: string
          readonly tool: string
          readonly state:
            | { readonly status: "pending"; readonly input: { readonly [x: string]: any }; readonly raw: string }
            | {
                readonly status: "running"
                readonly input: { readonly [x: string]: any }
                readonly title?: string | undefined
                readonly metadata?: { readonly [x: string]: any } | undefined
                readonly structured?: { readonly [x: string]: unknown } | undefined
                readonly content?:
                  | ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | {
                          readonly type: "file"
                          readonly data: string
                          readonly mime: string
                          readonly name?: string | undefined
                        }
                    >
                  | undefined
                readonly time: { readonly start: number }
              }
            | {
                readonly status: "completed"
                readonly input: { readonly [x: string]: any }
                readonly output: string
                readonly title: string
                readonly metadata: { readonly [x: string]: any }
                readonly time: { readonly start: number; readonly end: number; readonly compacted?: number | undefined }
                readonly attachments?:
                  | ReadonlyArray<{
                      readonly id: string
                      readonly sessionID: string
                      readonly messageID: string
                      readonly type: "file"
                      readonly mime: string
                      readonly filename?: string | undefined
                      readonly url: string
                      readonly source?:
                        | (
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "file"
                                readonly path: string
                              }
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "symbol"
                                readonly path: string
                                readonly range: {
                                  readonly start: { readonly line: number; readonly character: number }
                                  readonly end: { readonly line: number; readonly character: number }
                                }
                                readonly name: string
                                readonly kind: number
                              }
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "resource"
                                readonly clientName: string
                                readonly uri: string
                              }
                          )
                        | undefined
                    }>
                  | undefined
              }
            | {
                readonly status: "error"
                readonly input: { readonly [x: string]: any }
                readonly error: string
                readonly metadata?: { readonly [x: string]: any } | undefined
                readonly time: { readonly start: number; readonly end: number }
              }
          readonly metadata?: { readonly [x: string]: any } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "step-start"
          readonly snapshot?: string | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "step-finish"
          readonly reason: string
          readonly snapshot?: string | undefined
          readonly cost: number
          readonly tokens: {
            readonly total?: number | undefined
            readonly input: number
            readonly output: number
            readonly reasoning: number
            readonly cache: { readonly read: number; readonly write: number }
          }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "snapshot"
          readonly snapshot: string
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "patch"
          readonly hash: string
          readonly files: ReadonlyArray<string>
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "retry"
          readonly attempt: number
          readonly error: {
            readonly name: "APIError"
            readonly data: {
              readonly message: string
              readonly statusCode?: number | undefined
              readonly isRetryable: boolean
              readonly responseHeaders?: { readonly [x: string]: string } | undefined
              readonly responseBody?: string | undefined
              readonly metadata?: { readonly [x: string]: string } | undefined
              readonly classification?: "payload-too-large" | undefined
            }
          }
          readonly time: { readonly created: number }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "compaction"
          readonly auto: boolean
        }
    >
  }["noReply"]
  readonly tools?: {
    readonly messageID?: string | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?: unknown | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "reasoning"
          readonly text: string
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly time: { readonly start: number; readonly end?: number | undefined }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "tool"
          readonly callID: string
          readonly tool: string
          readonly state:
            | { readonly status: "pending"; readonly input: { readonly [x: string]: any }; readonly raw: string }
            | {
                readonly status: "running"
                readonly input: { readonly [x: string]: any }
                readonly title?: string | undefined
                readonly metadata?: { readonly [x: string]: any } | undefined
                readonly structured?: { readonly [x: string]: unknown } | undefined
                readonly content?:
                  | ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | {
                          readonly type: "file"
                          readonly data: string
                          readonly mime: string
                          readonly name?: string | undefined
                        }
                    >
                  | undefined
                readonly time: { readonly start: number }
              }
            | {
                readonly status: "completed"
                readonly input: { readonly [x: string]: any }
                readonly output: string
                readonly title: string
                readonly metadata: { readonly [x: string]: any }
                readonly time: { readonly start: number; readonly end: number; readonly compacted?: number | undefined }
                readonly attachments?:
                  | ReadonlyArray<{
                      readonly id: string
                      readonly sessionID: string
                      readonly messageID: string
                      readonly type: "file"
                      readonly mime: string
                      readonly filename?: string | undefined
                      readonly url: string
                      readonly source?:
                        | (
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "file"
                                readonly path: string
                              }
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "symbol"
                                readonly path: string
                                readonly range: {
                                  readonly start: { readonly line: number; readonly character: number }
                                  readonly end: { readonly line: number; readonly character: number }
                                }
                                readonly name: string
                                readonly kind: number
                              }
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "resource"
                                readonly clientName: string
                                readonly uri: string
                              }
                          )
                        | undefined
                    }>
                  | undefined
              }
            | {
                readonly status: "error"
                readonly input: { readonly [x: string]: any }
                readonly error: string
                readonly metadata?: { readonly [x: string]: any } | undefined
                readonly time: { readonly start: number; readonly end: number }
              }
          readonly metadata?: { readonly [x: string]: any } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "step-start"
          readonly snapshot?: string | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "step-finish"
          readonly reason: string
          readonly snapshot?: string | undefined
          readonly cost: number
          readonly tokens: {
            readonly total?: number | undefined
            readonly input: number
            readonly output: number
            readonly reasoning: number
            readonly cache: { readonly read: number; readonly write: number }
          }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "snapshot"
          readonly snapshot: string
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "patch"
          readonly hash: string
          readonly files: ReadonlyArray<string>
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "retry"
          readonly attempt: number
          readonly error: {
            readonly name: "APIError"
            readonly data: {
              readonly message: string
              readonly statusCode?: number | undefined
              readonly isRetryable: boolean
              readonly responseHeaders?: { readonly [x: string]: string } | undefined
              readonly responseBody?: string | undefined
              readonly metadata?: { readonly [x: string]: string } | undefined
              readonly classification?: "payload-too-large" | undefined
            }
          }
          readonly time: { readonly created: number }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "compaction"
          readonly auto: boolean
        }
    >
  }["tools"]
  readonly format?: {
    readonly messageID?: string | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?: unknown | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "reasoning"
          readonly text: string
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly time: { readonly start: number; readonly end?: number | undefined }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "tool"
          readonly callID: string
          readonly tool: string
          readonly state:
            | { readonly status: "pending"; readonly input: { readonly [x: string]: any }; readonly raw: string }
            | {
                readonly status: "running"
                readonly input: { readonly [x: string]: any }
                readonly title?: string | undefined
                readonly metadata?: { readonly [x: string]: any } | undefined
                readonly structured?: { readonly [x: string]: unknown } | undefined
                readonly content?:
                  | ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | {
                          readonly type: "file"
                          readonly data: string
                          readonly mime: string
                          readonly name?: string | undefined
                        }
                    >
                  | undefined
                readonly time: { readonly start: number }
              }
            | {
                readonly status: "completed"
                readonly input: { readonly [x: string]: any }
                readonly output: string
                readonly title: string
                readonly metadata: { readonly [x: string]: any }
                readonly time: { readonly start: number; readonly end: number; readonly compacted?: number | undefined }
                readonly attachments?:
                  | ReadonlyArray<{
                      readonly id: string
                      readonly sessionID: string
                      readonly messageID: string
                      readonly type: "file"
                      readonly mime: string
                      readonly filename?: string | undefined
                      readonly url: string
                      readonly source?:
                        | (
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "file"
                                readonly path: string
                              }
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "symbol"
                                readonly path: string
                                readonly range: {
                                  readonly start: { readonly line: number; readonly character: number }
                                  readonly end: { readonly line: number; readonly character: number }
                                }
                                readonly name: string
                                readonly kind: number
                              }
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "resource"
                                readonly clientName: string
                                readonly uri: string
                              }
                          )
                        | undefined
                    }>
                  | undefined
              }
            | {
                readonly status: "error"
                readonly input: { readonly [x: string]: any }
                readonly error: string
                readonly metadata?: { readonly [x: string]: any } | undefined
                readonly time: { readonly start: number; readonly end: number }
              }
          readonly metadata?: { readonly [x: string]: any } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "step-start"
          readonly snapshot?: string | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "step-finish"
          readonly reason: string
          readonly snapshot?: string | undefined
          readonly cost: number
          readonly tokens: {
            readonly total?: number | undefined
            readonly input: number
            readonly output: number
            readonly reasoning: number
            readonly cache: { readonly read: number; readonly write: number }
          }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "snapshot"
          readonly snapshot: string
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "patch"
          readonly hash: string
          readonly files: ReadonlyArray<string>
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "retry"
          readonly attempt: number
          readonly error: {
            readonly name: "APIError"
            readonly data: {
              readonly message: string
              readonly statusCode?: number | undefined
              readonly isRetryable: boolean
              readonly responseHeaders?: { readonly [x: string]: string } | undefined
              readonly responseBody?: string | undefined
              readonly metadata?: { readonly [x: string]: string } | undefined
              readonly classification?: "payload-too-large" | undefined
            }
          }
          readonly time: { readonly created: number }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "compaction"
          readonly auto: boolean
        }
    >
  }["format"]
  readonly system?: {
    readonly messageID?: string | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?: unknown | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "reasoning"
          readonly text: string
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly time: { readonly start: number; readonly end?: number | undefined }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "tool"
          readonly callID: string
          readonly tool: string
          readonly state:
            | { readonly status: "pending"; readonly input: { readonly [x: string]: any }; readonly raw: string }
            | {
                readonly status: "running"
                readonly input: { readonly [x: string]: any }
                readonly title?: string | undefined
                readonly metadata?: { readonly [x: string]: any } | undefined
                readonly structured?: { readonly [x: string]: unknown } | undefined
                readonly content?:
                  | ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | {
                          readonly type: "file"
                          readonly data: string
                          readonly mime: string
                          readonly name?: string | undefined
                        }
                    >
                  | undefined
                readonly time: { readonly start: number }
              }
            | {
                readonly status: "completed"
                readonly input: { readonly [x: string]: any }
                readonly output: string
                readonly title: string
                readonly metadata: { readonly [x: string]: any }
                readonly time: { readonly start: number; readonly end: number; readonly compacted?: number | undefined }
                readonly attachments?:
                  | ReadonlyArray<{
                      readonly id: string
                      readonly sessionID: string
                      readonly messageID: string
                      readonly type: "file"
                      readonly mime: string
                      readonly filename?: string | undefined
                      readonly url: string
                      readonly source?:
                        | (
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "file"
                                readonly path: string
                              }
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "symbol"
                                readonly path: string
                                readonly range: {
                                  readonly start: { readonly line: number; readonly character: number }
                                  readonly end: { readonly line: number; readonly character: number }
                                }
                                readonly name: string
                                readonly kind: number
                              }
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "resource"
                                readonly clientName: string
                                readonly uri: string
                              }
                          )
                        | undefined
                    }>
                  | undefined
              }
            | {
                readonly status: "error"
                readonly input: { readonly [x: string]: any }
                readonly error: string
                readonly metadata?: { readonly [x: string]: any } | undefined
                readonly time: { readonly start: number; readonly end: number }
              }
          readonly metadata?: { readonly [x: string]: any } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "step-start"
          readonly snapshot?: string | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "step-finish"
          readonly reason: string
          readonly snapshot?: string | undefined
          readonly cost: number
          readonly tokens: {
            readonly total?: number | undefined
            readonly input: number
            readonly output: number
            readonly reasoning: number
            readonly cache: { readonly read: number; readonly write: number }
          }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "snapshot"
          readonly snapshot: string
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "patch"
          readonly hash: string
          readonly files: ReadonlyArray<string>
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "retry"
          readonly attempt: number
          readonly error: {
            readonly name: "APIError"
            readonly data: {
              readonly message: string
              readonly statusCode?: number | undefined
              readonly isRetryable: boolean
              readonly responseHeaders?: { readonly [x: string]: string } | undefined
              readonly responseBody?: string | undefined
              readonly metadata?: { readonly [x: string]: string } | undefined
              readonly classification?: "payload-too-large" | undefined
            }
          }
          readonly time: { readonly created: number }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "compaction"
          readonly auto: boolean
        }
    >
  }["system"]
  readonly variant?: {
    readonly messageID?: string | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?: unknown | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "reasoning"
          readonly text: string
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly time: { readonly start: number; readonly end?: number | undefined }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "tool"
          readonly callID: string
          readonly tool: string
          readonly state:
            | { readonly status: "pending"; readonly input: { readonly [x: string]: any }; readonly raw: string }
            | {
                readonly status: "running"
                readonly input: { readonly [x: string]: any }
                readonly title?: string | undefined
                readonly metadata?: { readonly [x: string]: any } | undefined
                readonly structured?: { readonly [x: string]: unknown } | undefined
                readonly content?:
                  | ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | {
                          readonly type: "file"
                          readonly data: string
                          readonly mime: string
                          readonly name?: string | undefined
                        }
                    >
                  | undefined
                readonly time: { readonly start: number }
              }
            | {
                readonly status: "completed"
                readonly input: { readonly [x: string]: any }
                readonly output: string
                readonly title: string
                readonly metadata: { readonly [x: string]: any }
                readonly time: { readonly start: number; readonly end: number; readonly compacted?: number | undefined }
                readonly attachments?:
                  | ReadonlyArray<{
                      readonly id: string
                      readonly sessionID: string
                      readonly messageID: string
                      readonly type: "file"
                      readonly mime: string
                      readonly filename?: string | undefined
                      readonly url: string
                      readonly source?:
                        | (
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "file"
                                readonly path: string
                              }
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "symbol"
                                readonly path: string
                                readonly range: {
                                  readonly start: { readonly line: number; readonly character: number }
                                  readonly end: { readonly line: number; readonly character: number }
                                }
                                readonly name: string
                                readonly kind: number
                              }
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "resource"
                                readonly clientName: string
                                readonly uri: string
                              }
                          )
                        | undefined
                    }>
                  | undefined
              }
            | {
                readonly status: "error"
                readonly input: { readonly [x: string]: any }
                readonly error: string
                readonly metadata?: { readonly [x: string]: any } | undefined
                readonly time: { readonly start: number; readonly end: number }
              }
          readonly metadata?: { readonly [x: string]: any } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "step-start"
          readonly snapshot?: string | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "step-finish"
          readonly reason: string
          readonly snapshot?: string | undefined
          readonly cost: number
          readonly tokens: {
            readonly total?: number | undefined
            readonly input: number
            readonly output: number
            readonly reasoning: number
            readonly cache: { readonly read: number; readonly write: number }
          }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "snapshot"
          readonly snapshot: string
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "patch"
          readonly hash: string
          readonly files: ReadonlyArray<string>
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "retry"
          readonly attempt: number
          readonly error: {
            readonly name: "APIError"
            readonly data: {
              readonly message: string
              readonly statusCode?: number | undefined
              readonly isRetryable: boolean
              readonly responseHeaders?: { readonly [x: string]: string } | undefined
              readonly responseBody?: string | undefined
              readonly metadata?: { readonly [x: string]: string } | undefined
              readonly classification?: "payload-too-large" | undefined
            }
          }
          readonly time: { readonly created: number }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "compaction"
          readonly auto: boolean
        }
    >
  }["variant"]
  readonly parts: {
    readonly messageID?: string | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?: unknown | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "reasoning"
          readonly text: string
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly time: { readonly start: number; readonly end?: number | undefined }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "tool"
          readonly callID: string
          readonly tool: string
          readonly state:
            | { readonly status: "pending"; readonly input: { readonly [x: string]: any }; readonly raw: string }
            | {
                readonly status: "running"
                readonly input: { readonly [x: string]: any }
                readonly title?: string | undefined
                readonly metadata?: { readonly [x: string]: any } | undefined
                readonly structured?: { readonly [x: string]: unknown } | undefined
                readonly content?:
                  | ReadonlyArray<
                      | { readonly type: "text"; readonly text: string }
                      | {
                          readonly type: "file"
                          readonly data: string
                          readonly mime: string
                          readonly name?: string | undefined
                        }
                    >
                  | undefined
                readonly time: { readonly start: number }
              }
            | {
                readonly status: "completed"
                readonly input: { readonly [x: string]: any }
                readonly output: string
                readonly title: string
                readonly metadata: { readonly [x: string]: any }
                readonly time: { readonly start: number; readonly end: number; readonly compacted?: number | undefined }
                readonly attachments?:
                  | ReadonlyArray<{
                      readonly id: string
                      readonly sessionID: string
                      readonly messageID: string
                      readonly type: "file"
                      readonly mime: string
                      readonly filename?: string | undefined
                      readonly url: string
                      readonly source?:
                        | (
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "file"
                                readonly path: string
                              }
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "symbol"
                                readonly path: string
                                readonly range: {
                                  readonly start: { readonly line: number; readonly character: number }
                                  readonly end: { readonly line: number; readonly character: number }
                                }
                                readonly name: string
                                readonly kind: number
                              }
                            | {
                                readonly text: { readonly value: string; readonly start: number; readonly end: number }
                                readonly type: "resource"
                                readonly clientName: string
                                readonly uri: string
                              }
                          )
                        | undefined
                    }>
                  | undefined
              }
            | {
                readonly status: "error"
                readonly input: { readonly [x: string]: any }
                readonly error: string
                readonly metadata?: { readonly [x: string]: any } | undefined
                readonly time: { readonly start: number; readonly end: number }
              }
          readonly metadata?: { readonly [x: string]: any } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "step-start"
          readonly snapshot?: string | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "step-finish"
          readonly reason: string
          readonly snapshot?: string | undefined
          readonly cost: number
          readonly tokens: {
            readonly total?: number | undefined
            readonly input: number
            readonly output: number
            readonly reasoning: number
            readonly cache: { readonly read: number; readonly write: number }
          }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "snapshot"
          readonly snapshot: string
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "patch"
          readonly hash: string
          readonly files: ReadonlyArray<string>
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "retry"
          readonly attempt: number
          readonly error: {
            readonly name: "APIError"
            readonly data: {
              readonly message: string
              readonly statusCode?: number | undefined
              readonly isRetryable: boolean
              readonly responseHeaders?: { readonly [x: string]: string } | undefined
              readonly responseBody?: string | undefined
              readonly metadata?: { readonly [x: string]: string } | undefined
              readonly classification?: "payload-too-large" | undefined
            }
          }
          readonly time: { readonly created: number }
        }
      | {
          readonly id: string
          readonly sessionID: string
          readonly messageID: string
          readonly type: "compaction"
          readonly auto: boolean
        }
    >
  }["parts"]
}

export type MobileSessionMessageOutput = { accepted: true }

export type MobileSessionAbortInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type MobileSessionAbortOutput = MobileSuccess

export type MobilePermissionRespondInput = {
  readonly sessionID: { readonly sessionID: string; readonly permissionID: string }["sessionID"]
  readonly permissionID: { readonly sessionID: string; readonly permissionID: string }["permissionID"]
  readonly response: { readonly response: string }["response"]
}

export type MobilePermissionRespondOutput = MobileSuccess

export type MobileQuestionRespondInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
  readonly answers: { readonly answers: ReadonlyArray<ReadonlyArray<string>> }["answers"]
}

export type MobileQuestionRespondOutput = MobileSuccess

export type MobileQuestionRejectInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
}

export type MobileQuestionRejectOutput = MobileSuccess

export type MobileSessionPublishInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly title?: {
    readonly title?: string | undefined
    readonly body?: string | undefined
    readonly commitMessage?: string | undefined
  }["title"]
  readonly body?: {
    readonly title?: string | undefined
    readonly body?: string | undefined
    readonly commitMessage?: string | undefined
  }["body"]
  readonly commitMessage?: {
    readonly title?: string | undefined
    readonly body?: string | undefined
    readonly commitMessage?: string | undefined
  }["commitMessage"]
}

export type MobileSessionPublishOutput = MobileGithubPublishResult

export type MobileSessionCleanupInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type MobileSessionCleanupOutput = MobileSuccess

export type MobileSessionStreamInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type MobileSessionStreamOutput = any

export type MobileSessionRenameInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly title: { readonly title: string }["title"]
}

export type MobileSessionRenameOutput = MobileSuccess

export type MobileTeleportUploadBeginOutput = { uploadID: string }

export type MobileTeleportUploadChunkInput = { readonly uploadID: { readonly uploadID: string }["uploadID"] }

export type MobileTeleportUploadChunkOutput = { ok: boolean }

export type MobileTeleportInInput = {
  readonly title?: {
    readonly title?: string | undefined
    readonly name?: string | undefined
    readonly origin?: string | undefined
    readonly permission?: unknown | undefined
    readonly messages: ReadonlyArray<unknown>
    readonly uploadID?: string | undefined
  }["title"]
  readonly name?: {
    readonly title?: string | undefined
    readonly name?: string | undefined
    readonly origin?: string | undefined
    readonly permission?: unknown | undefined
    readonly messages: ReadonlyArray<unknown>
    readonly uploadID?: string | undefined
  }["name"]
  readonly origin?: {
    readonly title?: string | undefined
    readonly name?: string | undefined
    readonly origin?: string | undefined
    readonly permission?: unknown | undefined
    readonly messages: ReadonlyArray<unknown>
    readonly uploadID?: string | undefined
  }["origin"]
  readonly permission?: {
    readonly title?: string | undefined
    readonly name?: string | undefined
    readonly origin?: string | undefined
    readonly permission?: unknown | undefined
    readonly messages: ReadonlyArray<unknown>
    readonly uploadID?: string | undefined
  }["permission"]
  readonly messages: {
    readonly title?: string | undefined
    readonly name?: string | undefined
    readonly origin?: string | undefined
    readonly permission?: unknown | undefined
    readonly messages: ReadonlyArray<unknown>
    readonly uploadID?: string | undefined
  }["messages"]
  readonly uploadID?: {
    readonly title?: string | undefined
    readonly name?: string | undefined
    readonly origin?: string | undefined
    readonly permission?: unknown | undefined
    readonly messages: ReadonlyArray<unknown>
    readonly uploadID?: string | undefined
  }["uploadID"]
}

export type MobileTeleportInOutput = MobileTeleportResult

export type MobileTeleportOutInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly url: {
    readonly url: string
    readonly token: string
    readonly content?: boolean | undefined
    readonly includeGit?: boolean | undefined
  }["url"]
  readonly token: {
    readonly url: string
    readonly token: string
    readonly content?: boolean | undefined
    readonly includeGit?: boolean | undefined
  }["token"]
  readonly content?: {
    readonly url: string
    readonly token: string
    readonly content?: boolean | undefined
    readonly includeGit?: boolean | undefined
  }["content"]
  readonly includeGit?: {
    readonly url: string
    readonly token: string
    readonly content?: boolean | undefined
    readonly includeGit?: boolean | undefined
  }["includeGit"]
}

export type MobileTeleportOutOutput = MobileTeleportResult

export type MobileWorktreeCreateInput = { readonly payload: unknown }

export type MobileWorktreeCreateOutput = ManagedWorktreeInfo

export type MobileWorktreeRemoveInput = { readonly payload: unknown }

export type MobileWorktreeRemoveOutput = MobileSuccess

export type MobileWorktreeResetInput = { readonly payload: unknown }

export type MobileWorktreeResetOutput = MobileSuccess

export type MobileGitStatusOutput = MobileGitStatus

export type MobileGitDiffInput = {
  readonly file?: { readonly file?: string | undefined; readonly staged?: "true" | "false" | undefined }["file"]
  readonly staged?: { readonly file?: string | undefined; readonly staged?: "true" | "false" | undefined }["staged"]
}

export type MobileGitDiffOutput = Array<MobileGitFileDiff>

export type MobileGitCommitsInput = { readonly limit?: { readonly limit?: number | undefined }["limit"] }

export type MobileGitCommitsOutput = Array<MobileGitCommit>

export type MobileGitBranchesOutput = Array<MobileGitBranch>

export type MobileGitCommitInput = {
  readonly message: {
    readonly message: string
    readonly files?: ReadonlyArray<string> | undefined
    readonly amend?: boolean | undefined
    readonly stagedOnly?: boolean | undefined
  }["message"]
  readonly files?: {
    readonly message: string
    readonly files?: ReadonlyArray<string> | undefined
    readonly amend?: boolean | undefined
    readonly stagedOnly?: boolean | undefined
  }["files"]
  readonly amend?: {
    readonly message: string
    readonly files?: ReadonlyArray<string> | undefined
    readonly amend?: boolean | undefined
    readonly stagedOnly?: boolean | undefined
  }["amend"]
  readonly stagedOnly?: {
    readonly message: string
    readonly files?: ReadonlyArray<string> | undefined
    readonly amend?: boolean | undefined
    readonly stagedOnly?: boolean | undefined
  }["stagedOnly"]
}

export type MobileGitCommitOutput = { sha: string; message: string }

export type MobileGitCheckoutInput = {
  readonly branch: { readonly branch: string; readonly create?: boolean | undefined }["branch"]
  readonly create?: { readonly branch: string; readonly create?: boolean | undefined }["create"]
}

export type MobileGitCheckoutOutput = MobileSuccess

export type MobileGitStageInput = { readonly files: { readonly files: ReadonlyArray<string> }["files"] }

export type MobileGitStageOutput = MobileSuccess

export type MobileGitUnstageInput = { readonly files: { readonly files: ReadonlyArray<string> }["files"] }

export type MobileGitUnstageOutput = MobileSuccess

export type MobileGitDiscardInput = { readonly files: { readonly files: ReadonlyArray<string> }["files"] }

export type MobileGitDiscardOutput = MobileSuccess

export type MobileGitPushInput = { readonly upstream?: { readonly upstream?: string | undefined }["upstream"] }

export type MobileGitPushOutput = { success: true; pushed: boolean }

export type MobileGitPullOutput = { success: true; pulled: boolean; conflicts?: Array<string> | undefined }

export type MobileLoopListOutput = { loops: Array<LoopDefinition>; runtimes: Array<MobileLoopRuntime> }

export type MobileLoopCreateInput = { readonly payload: unknown }

export type MobileLoopCreateOutput = LoopDefinition

export type MobileLoopTemplatesOutput = { templates: Array<any> }

export type MobileLoopGenerateInput = {
  readonly description: { readonly description: string; readonly model?: string | undefined }["description"]
  readonly model?: { readonly description: string; readonly model?: string | undefined }["model"]
}

export type MobileLoopGenerateOutput = LoopDefinition

export type MobileLoopRunsRecentInput = { readonly limit?: { readonly limit?: number | undefined }["limit"] }

export type MobileLoopRunsRecentOutput = { runs: Array<LoopRun> }

export type MobileLoopGetInput = { readonly id: { readonly id: string }["id"] }

export type MobileLoopGetOutput = { loop: LoopDefinition; runtime: MobileLoopRuntime }

export type MobileLoopDeleteInput = { readonly id: { readonly id: string }["id"] }

export type MobileLoopDeleteOutput = MobileSuccess

export type MobileLoopUpdateInput = { readonly id: { readonly id: string }["id"]; readonly payload: unknown }

export type MobileLoopUpdateOutput = LoopDefinition

export type MobileLoopRunsInput = {
  readonly id: { readonly id: string }["id"]
  readonly limit?: { readonly limit?: number | undefined }["limit"]
}

export type MobileLoopRunsOutput = { runs: Array<LoopRun> }

export type MobileLoopRunInput = { readonly id: { readonly id: string }["id"] }

export type MobileLoopRunOutput = MobileSuccess

export type MobileLoopAbortInput = { readonly id: { readonly id: string }["id"] }

export type MobileLoopAbortOutput = MobileSuccess

export type MobileLoopToggleInput = {
  readonly id: { readonly id: string }["id"]
  readonly enabled: { readonly enabled: boolean }["enabled"]
}

export type MobileLoopToggleOutput = LoopDefinition

export type MobileLoopPauseInput = { readonly id: { readonly id: string }["id"] }

export type MobileLoopPauseOutput = MobileSuccess

export type MobileLoopResumeInput = { readonly id: { readonly id: string }["id"] }

export type MobileLoopResumeOutput = MobileSuccess

export type MobileRoutineListOutput = Array<Routine>

export type MobileRoutineCreateInput = { readonly payload: unknown }

export type MobileRoutineCreateOutput = Routine

export type MobileRoutineGetInput = { readonly id: { readonly id: string }["id"] }

export type MobileRoutineGetOutput = Routine

export type MobileRoutineDeleteInput = { readonly id: { readonly id: string }["id"] }

export type MobileRoutineDeleteOutput = MobileSuccess

export type MobileRoutineUpdateInput = { readonly id: { readonly id: string }["id"]; readonly payload: unknown }

export type MobileRoutineUpdateOutput = Routine

export type MobileRoutineRunInput = {
  readonly id: { readonly id: string }["id"]
  readonly text?: { readonly text?: string | undefined }["text"]
}

export type MobileRoutineRunOutput = Session

export type MobileRoutinePauseInput = { readonly id: { readonly id: string }["id"] }

export type MobileRoutinePauseOutput = Routine

export type MobileRoutineResumeInput = { readonly id: { readonly id: string }["id"] }

export type MobileRoutineResumeOutput = Routine

export type MobileRoutineTriggerInput = {
  readonly token: { readonly token: string }["token"]
  readonly text?: { readonly text?: string | undefined }["text"]
}

export type MobileRoutineTriggerOutput = Session

export type MobilePtyListOutput = Array<Pty>

export type MobilePtyCreateInput = {
  readonly command?: {
    readonly command?: string | undefined
    readonly args?: ReadonlyArray<string> | undefined
    readonly cwd?: string | undefined
    readonly title?: string | undefined
    readonly env?: { readonly [x: string]: string } | undefined
  }["command"]
  readonly args?: {
    readonly command?: string | undefined
    readonly args?: ReadonlyArray<string> | undefined
    readonly cwd?: string | undefined
    readonly title?: string | undefined
    readonly env?: { readonly [x: string]: string } | undefined
  }["args"]
  readonly cwd?: {
    readonly command?: string | undefined
    readonly args?: ReadonlyArray<string> | undefined
    readonly cwd?: string | undefined
    readonly title?: string | undefined
    readonly env?: { readonly [x: string]: string } | undefined
  }["cwd"]
  readonly title?: {
    readonly command?: string | undefined
    readonly args?: ReadonlyArray<string> | undefined
    readonly cwd?: string | undefined
    readonly title?: string | undefined
    readonly env?: { readonly [x: string]: string } | undefined
  }["title"]
  readonly env?: {
    readonly command?: string | undefined
    readonly args?: ReadonlyArray<string> | undefined
    readonly cwd?: string | undefined
    readonly title?: string | undefined
    readonly env?: { readonly [x: string]: string } | undefined
  }["env"]
}

export type MobilePtyCreateOutput = Pty

export type MobilePtyGetInput = { readonly ptyID: { readonly ptyID: string }["ptyID"] }

export type MobilePtyGetOutput = Pty

export type MobilePtyUpdateInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly title?: {
    readonly title?: string | undefined
    readonly size?: { readonly rows: number; readonly cols: number } | undefined
  }["title"]
  readonly size?: {
    readonly title?: string | undefined
    readonly size?: { readonly rows: number; readonly cols: number } | undefined
  }["size"]
}

export type MobilePtyUpdateOutput = Pty

export type MobilePtyRemoveInput = { readonly ptyID: { readonly ptyID: string }["ptyID"] }

export type MobilePtyRemoveOutput = boolean

export type ProjectListOutput = Array<Project>

export type ProjectCurrentOutput = Project

export type ProjectUpdateInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly name?: {
    readonly name?: string | undefined
    readonly icon?:
      | {
          readonly url?: string | undefined
          readonly override?: string | undefined
          readonly color?: string | undefined
        }
      | undefined
  }["name"]
  readonly icon?: {
    readonly name?: string | undefined
    readonly icon?:
      | {
          readonly url?: string | undefined
          readonly override?: string | undefined
          readonly color?: string | undefined
        }
      | undefined
  }["icon"]
}

export type ProjectUpdateOutput = Project

export type ProjectDirectoryListInput = { readonly projectID: { readonly projectID: string }["projectID"] }

export type ProjectDirectoryListOutput = Array<ProjectDirectory>

export type ProjectCopyCreateInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly strategy: {
    readonly strategy: "git_worktree"
    readonly directory: string
    readonly name?: string | undefined
  }["strategy"]
  readonly directory: {
    readonly strategy: "git_worktree"
    readonly directory: string
    readonly name?: string | undefined
  }["directory"]
  readonly name?: {
    readonly strategy: "git_worktree"
    readonly directory: string
    readonly name?: string | undefined
  }["name"]
}

export type ProjectCopyCreateOutput = ProjectCopy

export type ProjectCopyRemoveInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly directory: { readonly directory: string; readonly force: boolean }["directory"]
  readonly force: { readonly directory: string; readonly force: boolean }["force"]
}

export type ProjectCopyRemoveOutput = void

export type ProjectCopyRefreshInput = { readonly projectID: { readonly projectID: string }["projectID"] }

export type ProjectCopyRefreshOutput = ProjectCopyRefresh

export type ProviderListOutput = ProviderList

export type ProviderAuthOutput = ProviderAuthMethods

export type ProviderApiInput = {
  readonly providerID: { readonly providerID: string }["providerID"]
  readonly key: { readonly key: string }["key"]
}

export type ProviderApiOutput = ProviderMutationSuccess

export type ProviderRemoveAuthInput = { readonly providerID: { readonly providerID: string }["providerID"] }

export type ProviderRemoveAuthOutput = ProviderMutationSuccess

export type ProviderOauthAuthorizeInput = {
  readonly providerID: { readonly providerID: string }["providerID"]
  readonly method: { readonly method: number }["method"]
}

export type ProviderOauthAuthorizeOutput = ProviderOAuthAuthorization | null

export type ProviderOauthCallbackInput = {
  readonly providerID: { readonly providerID: string }["providerID"]
  readonly method: { readonly method: number; readonly code?: string | undefined }["method"]
  readonly code?: { readonly method: number; readonly code?: string | undefined }["code"]
}

export type ProviderOauthCallbackOutput = boolean

export type QuestionListOutput = Array<QuestionRequest>

export type QuestionReplyInput = {
  readonly requestID: { readonly requestID: string }["requestID"]
  readonly answers: { readonly answers: ReadonlyArray<ReadonlyArray<string>> }["answers"]
}

export type QuestionReplyOutput = boolean

export type QuestionRejectInput = { readonly requestID: { readonly requestID: string }["requestID"] }

export type QuestionRejectOutput = boolean

export type PermissionListOutput = Array<PermissionRequest>

export type PermissionReplyInput = {
  readonly requestID: { readonly requestID: string }["requestID"]
  readonly reply: { readonly reply: "once" | "always" | "reject"; readonly message?: string | undefined }["reply"]
  readonly message?: { readonly reply: "once" | "always" | "reject"; readonly message?: string | undefined }["message"]
}

export type PermissionReplyOutput = boolean

export type PtyListOutput = PtyList

export type PtyCreateInput = {
  readonly command?: {
    readonly command?: string | undefined
    readonly args?: ReadonlyArray<string> | undefined
    readonly cwd?: string | undefined
    readonly title?: string | undefined
    readonly env?: { readonly [x: string]: string } | undefined
  }["command"]
  readonly args?: {
    readonly command?: string | undefined
    readonly args?: ReadonlyArray<string> | undefined
    readonly cwd?: string | undefined
    readonly title?: string | undefined
    readonly env?: { readonly [x: string]: string } | undefined
  }["args"]
  readonly cwd?: {
    readonly command?: string | undefined
    readonly args?: ReadonlyArray<string> | undefined
    readonly cwd?: string | undefined
    readonly title?: string | undefined
    readonly env?: { readonly [x: string]: string } | undefined
  }["cwd"]
  readonly title?: {
    readonly command?: string | undefined
    readonly args?: ReadonlyArray<string> | undefined
    readonly cwd?: string | undefined
    readonly title?: string | undefined
    readonly env?: { readonly [x: string]: string } | undefined
  }["title"]
  readonly env?: {
    readonly command?: string | undefined
    readonly args?: ReadonlyArray<string> | undefined
    readonly cwd?: string | undefined
    readonly title?: string | undefined
    readonly env?: { readonly [x: string]: string } | undefined
  }["env"]
}

export type PtyCreateOutput = Pty1

export type PtyGetInput = { readonly ptyID: { readonly ptyID: string }["ptyID"] }

export type PtyGetOutput = Pty1

export type PtyUpdateInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly title?: {
    readonly title?: string | undefined
    readonly size?: { readonly rows: number; readonly cols: number } | undefined
  }["title"]
  readonly size?: {
    readonly title?: string | undefined
    readonly size?: { readonly rows: number; readonly cols: number } | undefined
  }["size"]
}

export type PtyUpdateOutput = Pty1

export type PtyRemoveInput = { readonly ptyID: { readonly ptyID: string }["ptyID"] }

export type PtyRemoveOutput = boolean

export type LoopListOutput = LoopListOutput2

export type LoopTemplatesOutput = LoopTemplatesOutput2

export type LoopGenerateInput = {
  readonly description: {
    readonly description: string
    readonly model?: string | undefined
    readonly agent?: string | undefined
  }["description"]
  readonly model?: {
    readonly description: string
    readonly model?: string | undefined
    readonly agent?: string | undefined
  }["model"]
  readonly agent?: {
    readonly description: string
    readonly model?: string | undefined
    readonly agent?: string | undefined
  }["agent"]
}

export type LoopGenerateOutput = LoopDefinition

export type LoopRecentRunsInput = { readonly limit?: { readonly limit?: number | undefined }["limit"] }

export type LoopRecentRunsOutput = LoopRunsOutput2

export type LoopGetInput = { readonly id: { readonly id: string }["id"] }

export type LoopGetOutput = LoopGetOutput2

export type LoopUpsertInput = { readonly payload: unknown }

export type LoopUpsertOutput = LoopDefinition

export type LoopUpdateInput = { readonly id: { readonly id: string }["id"]; readonly payload: unknown }

export type LoopUpdateOutput = LoopDefinition

export type LoopRemoveInput = { readonly id: { readonly id: string }["id"] }

export type LoopRemoveOutput = LoopBooleanResult

export type LoopToggleInput = {
  readonly id: { readonly id: string }["id"]
  readonly enabled: { readonly enabled: boolean }["enabled"]
}

export type LoopToggleOutput = LoopDefinition

export type LoopRunInput = { readonly id: { readonly id: string }["id"] }

export type LoopRunOutput = LoopBooleanResult

export type LoopAbortInput = { readonly id: { readonly id: string }["id"] }

export type LoopAbortOutput = LoopBooleanResult

export type LoopPauseInput = { readonly id: { readonly id: string }["id"] }

export type LoopPauseOutput = LoopBooleanResult

export type LoopResumeInput = { readonly id: { readonly id: string }["id"] }

export type LoopResumeOutput = LoopBooleanResult

export type LoopRunsInput = {
  readonly id: { readonly id: string }["id"]
  readonly limit?: { readonly limit?: number | undefined }["limit"]
}

export type LoopRunsOutput = LoopRunsOutput2

export type SessionListInput = {
  readonly directory?: {
    readonly directory?: string | undefined
    readonly roots?: boolean | undefined
    readonly start?: number | undefined
    readonly search?: string | undefined
    readonly limit?: number | undefined
  }["directory"]
  readonly roots?: {
    readonly directory?: string | undefined
    readonly roots?: boolean | undefined
    readonly start?: number | undefined
    readonly search?: string | undefined
    readonly limit?: number | undefined
  }["roots"]
  readonly start?: {
    readonly directory?: string | undefined
    readonly roots?: boolean | undefined
    readonly start?: number | undefined
    readonly search?: string | undefined
    readonly limit?: number | undefined
  }["start"]
  readonly search?: {
    readonly directory?: string | undefined
    readonly roots?: boolean | undefined
    readonly start?: number | undefined
    readonly search?: string | undefined
    readonly limit?: number | undefined
  }["search"]
  readonly limit?: {
    readonly directory?: string | undefined
    readonly roots?: boolean | undefined
    readonly start?: number | undefined
    readonly search?: string | undefined
    readonly limit?: number | undefined
  }["limit"]
}

export type SessionListOutput = SessionList

export type SessionCreateInput = {
  readonly parentID?: {
    readonly parentID?: string | undefined
    readonly title?: string | undefined
    readonly permission?: ReadonlyArray<unknown> | undefined
    readonly skills?: ReadonlyArray<string> | undefined
    readonly github?: unknown | undefined
    readonly workspaceID?: string | undefined
  }["parentID"]
  readonly title?: {
    readonly parentID?: string | undefined
    readonly title?: string | undefined
    readonly permission?: ReadonlyArray<unknown> | undefined
    readonly skills?: ReadonlyArray<string> | undefined
    readonly github?: unknown | undefined
    readonly workspaceID?: string | undefined
  }["title"]
  readonly permission?: {
    readonly parentID?: string | undefined
    readonly title?: string | undefined
    readonly permission?: ReadonlyArray<unknown> | undefined
    readonly skills?: ReadonlyArray<string> | undefined
    readonly github?: unknown | undefined
    readonly workspaceID?: string | undefined
  }["permission"]
  readonly skills?: {
    readonly parentID?: string | undefined
    readonly title?: string | undefined
    readonly permission?: ReadonlyArray<unknown> | undefined
    readonly skills?: ReadonlyArray<string> | undefined
    readonly github?: unknown | undefined
    readonly workspaceID?: string | undefined
  }["skills"]
  readonly github?: {
    readonly parentID?: string | undefined
    readonly title?: string | undefined
    readonly permission?: ReadonlyArray<unknown> | undefined
    readonly skills?: ReadonlyArray<string> | undefined
    readonly github?: unknown | undefined
    readonly workspaceID?: string | undefined
  }["github"]
  readonly workspaceID?: {
    readonly parentID?: string | undefined
    readonly title?: string | undefined
    readonly permission?: ReadonlyArray<unknown> | undefined
    readonly skills?: ReadonlyArray<string> | undefined
    readonly github?: unknown | undefined
    readonly workspaceID?: string | undefined
  }["workspaceID"]
}

export type SessionCreateOutput = Session

export type SessionStatusOutput = SessionStatusMap

export type SessionGetInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionGetOutput = Session

export type SessionRemoveInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionRemoveOutput = BooleanResult

export type SessionUpdateInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly title?: {
    readonly title?: string | undefined
    readonly time?: { readonly archived?: number | undefined } | undefined
  }["title"]
  readonly time?: {
    readonly title?: string | undefined
    readonly time?: { readonly archived?: number | undefined } | undefined
  }["time"]
}

export type SessionUpdateOutput = Session

export type SessionForkInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID?: { readonly messageID?: string | undefined }["messageID"]
}

export type SessionForkOutput = Session

export type SessionAbortInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionAbortOutput = BooleanResult

export type SessionRevertInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID: { readonly messageID: string; readonly partID?: string | undefined }["messageID"]
  readonly partID?: { readonly messageID: string; readonly partID?: string | undefined }["partID"]
}

export type SessionRevertOutput = Session

export type SessionUnrevertInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionUnrevertOutput = Session

export type SessionShareInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionShareOutput = Session

export type SessionUnshareInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionUnshareOutput = Session

export type SessionSummarizeInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly providerID: {
    readonly providerID: string
    readonly modelID: string
    readonly auto?: boolean | undefined
  }["providerID"]
  readonly modelID: {
    readonly providerID: string
    readonly modelID: string
    readonly auto?: boolean | undefined
  }["modelID"]
  readonly auto?: { readonly providerID: string; readonly modelID: string; readonly auto?: boolean | undefined }["auto"]
}

export type SessionSummarizeOutput = BooleanResult

export type SessionCommandInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly agent?: string | undefined
    readonly model?: string | undefined
    readonly arguments: string
    readonly command: string
    readonly variant?: string | undefined
    readonly parts?: ReadonlyArray<unknown> | undefined
  }["messageID"]
  readonly delivery?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly agent?: string | undefined
    readonly model?: string | undefined
    readonly arguments: string
    readonly command: string
    readonly variant?: string | undefined
    readonly parts?: ReadonlyArray<unknown> | undefined
  }["delivery"]
  readonly agent?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly agent?: string | undefined
    readonly model?: string | undefined
    readonly arguments: string
    readonly command: string
    readonly variant?: string | undefined
    readonly parts?: ReadonlyArray<unknown> | undefined
  }["agent"]
  readonly model?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly agent?: string | undefined
    readonly model?: string | undefined
    readonly arguments: string
    readonly command: string
    readonly variant?: string | undefined
    readonly parts?: ReadonlyArray<unknown> | undefined
  }["model"]
  readonly arguments: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly agent?: string | undefined
    readonly model?: string | undefined
    readonly arguments: string
    readonly command: string
    readonly variant?: string | undefined
    readonly parts?: ReadonlyArray<unknown> | undefined
  }["arguments"]
  readonly command: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly agent?: string | undefined
    readonly model?: string | undefined
    readonly arguments: string
    readonly command: string
    readonly variant?: string | undefined
    readonly parts?: ReadonlyArray<unknown> | undefined
  }["command"]
  readonly variant?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly agent?: string | undefined
    readonly model?: string | undefined
    readonly arguments: string
    readonly command: string
    readonly variant?: string | undefined
    readonly parts?: ReadonlyArray<unknown> | undefined
  }["variant"]
  readonly parts?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly agent?: string | undefined
    readonly model?: string | undefined
    readonly arguments: string
    readonly command: string
    readonly variant?: string | undefined
    readonly parts?: ReadonlyArray<unknown> | undefined
  }["parts"]
}

export type SessionCommandOutput = MessageWithParts

export type SessionShellInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly agent: {
    readonly agent: string
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly command: string
  }["agent"]
  readonly model?: {
    readonly agent: string
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly command: string
  }["model"]
  readonly command: {
    readonly agent: string
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly command: string
  }["command"]
}

export type SessionShellOutput = MessageWithParts

export type SessionPermissionRespondInput = {
  readonly sessionID: { readonly sessionID: string; readonly permissionID: string }["sessionID"]
  readonly permissionID: { readonly sessionID: string; readonly permissionID: string }["permissionID"]
  readonly response: { readonly response: "once" | "always" | "reject" }["response"]
}

export type SessionPermissionRespondOutput = BooleanResult

export type SessionChildrenInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionChildrenOutput = SessionList

export type SessionTodoInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionTodoOutput = TodoList

export type SessionDiffInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID?: { readonly messageID?: string | undefined }["messageID"]
}

export type SessionDiffOutput = FileDiffList

export type SessionMessagesInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly limit?: { readonly limit?: number | undefined }["limit"]
}

export type SessionMessagesOutput = MessageList

export type SessionPendingInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionPendingOutput = SessionPendingInputList

export type SessionPendingSteerInput = {
  readonly sessionID: { readonly sessionID: string; readonly pendingID: string }["sessionID"]
  readonly pendingID: { readonly sessionID: string; readonly pendingID: string }["pendingID"]
}

export type SessionPendingSteerOutput = SessionPendingInput2

export type SessionMessageInput = {
  readonly sessionID: { readonly sessionID: string; readonly messageID: string }["sessionID"]
  readonly messageID: { readonly sessionID: string; readonly messageID: string }["messageID"]
}

export type SessionMessageOutput = MessageWithParts

export type SessionMessageRemoveInput = {
  readonly sessionID: { readonly sessionID: string; readonly messageID: string }["sessionID"]
  readonly messageID: { readonly sessionID: string; readonly messageID: string }["messageID"]
}

export type SessionMessageRemoveOutput = BooleanResult

export type SessionPartRemoveInput = {
  readonly sessionID: { readonly sessionID: string; readonly messageID: string; readonly partID: string }["sessionID"]
  readonly messageID: { readonly sessionID: string; readonly messageID: string; readonly partID: string }["messageID"]
  readonly partID: { readonly sessionID: string; readonly messageID: string; readonly partID: string }["partID"]
}

export type SessionPartRemoveOutput = BooleanResult

export type SessionPartUpdateInput = {
  readonly sessionID: { readonly sessionID: string; readonly messageID: string; readonly partID: string }["sessionID"]
  readonly messageID: { readonly sessionID: string; readonly messageID: string; readonly partID: string }["messageID"]
  readonly partID: { readonly sessionID: string; readonly messageID: string; readonly partID: string }["partID"]
  readonly payload:
    | {
        readonly id: string
        readonly sessionID: string
        readonly messageID: string
        readonly type: "text"
        readonly text: string
        readonly synthetic?: boolean | undefined
        readonly ignored?: boolean | undefined
        readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
        readonly metadata?: { readonly [x: string]: any } | undefined
      }
    | {
        readonly id: string
        readonly sessionID: string
        readonly messageID: string
        readonly type: "subtask"
        readonly prompt: string
        readonly description: string
        readonly agent: string
        readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
        readonly command?: string | undefined
        readonly background?: boolean | undefined
      }
    | {
        readonly id: string
        readonly sessionID: string
        readonly messageID: string
        readonly type: "reasoning"
        readonly text: string
        readonly metadata?: { readonly [x: string]: any } | undefined
        readonly time: { readonly start: number; readonly end?: number | undefined }
      }
    | {
        readonly id: string
        readonly sessionID: string
        readonly messageID: string
        readonly type: "file"
        readonly mime: string
        readonly filename?: string | undefined
        readonly url: string
        readonly source?:
          | (
              | {
                  readonly text: { readonly value: string; readonly start: number; readonly end: number }
                  readonly type: "file"
                  readonly path: string
                }
              | {
                  readonly text: { readonly value: string; readonly start: number; readonly end: number }
                  readonly type: "symbol"
                  readonly path: string
                  readonly range: {
                    readonly start: { readonly line: number; readonly character: number }
                    readonly end: { readonly line: number; readonly character: number }
                  }
                  readonly name: string
                  readonly kind: number
                }
              | {
                  readonly text: { readonly value: string; readonly start: number; readonly end: number }
                  readonly type: "resource"
                  readonly clientName: string
                  readonly uri: string
                }
            )
          | undefined
      }
    | {
        readonly id: string
        readonly sessionID: string
        readonly messageID: string
        readonly type: "tool"
        readonly callID: string
        readonly tool: string
        readonly state:
          | { readonly status: "pending"; readonly input: { readonly [x: string]: any }; readonly raw: string }
          | {
              readonly status: "running"
              readonly input: { readonly [x: string]: any }
              readonly title?: string | undefined
              readonly metadata?: { readonly [x: string]: any } | undefined
              readonly structured?: { readonly [x: string]: unknown } | undefined
              readonly content?:
                | ReadonlyArray<
                    | { readonly type: "text"; readonly text: string }
                    | {
                        readonly type: "file"
                        readonly data: string
                        readonly mime: string
                        readonly name?: string | undefined
                      }
                  >
                | undefined
              readonly time: { readonly start: number }
            }
          | {
              readonly status: "completed"
              readonly input: { readonly [x: string]: any }
              readonly output: string
              readonly title: string
              readonly metadata: { readonly [x: string]: any }
              readonly time: { readonly start: number; readonly end: number; readonly compacted?: number | undefined }
              readonly attachments?:
                | ReadonlyArray<{
                    readonly id: string
                    readonly sessionID: string
                    readonly messageID: string
                    readonly type: "file"
                    readonly mime: string
                    readonly filename?: string | undefined
                    readonly url: string
                    readonly source?:
                      | (
                          | {
                              readonly text: { readonly value: string; readonly start: number; readonly end: number }
                              readonly type: "file"
                              readonly path: string
                            }
                          | {
                              readonly text: { readonly value: string; readonly start: number; readonly end: number }
                              readonly type: "symbol"
                              readonly path: string
                              readonly range: {
                                readonly start: { readonly line: number; readonly character: number }
                                readonly end: { readonly line: number; readonly character: number }
                              }
                              readonly name: string
                              readonly kind: number
                            }
                          | {
                              readonly text: { readonly value: string; readonly start: number; readonly end: number }
                              readonly type: "resource"
                              readonly clientName: string
                              readonly uri: string
                            }
                        )
                      | undefined
                  }>
                | undefined
            }
          | {
              readonly status: "error"
              readonly input: { readonly [x: string]: any }
              readonly error: string
              readonly metadata?: { readonly [x: string]: any } | undefined
              readonly time: { readonly start: number; readonly end: number }
            }
        readonly metadata?: { readonly [x: string]: any } | undefined
      }
    | {
        readonly id: string
        readonly sessionID: string
        readonly messageID: string
        readonly type: "step-start"
        readonly snapshot?: string | undefined
      }
    | {
        readonly id: string
        readonly sessionID: string
        readonly messageID: string
        readonly type: "step-finish"
        readonly reason: string
        readonly snapshot?: string | undefined
        readonly cost: number
        readonly tokens: {
          readonly total?: number | undefined
          readonly input: number
          readonly output: number
          readonly reasoning: number
          readonly cache: { readonly read: number; readonly write: number }
        }
      }
    | {
        readonly id: string
        readonly sessionID: string
        readonly messageID: string
        readonly type: "snapshot"
        readonly snapshot: string
      }
    | {
        readonly id: string
        readonly sessionID: string
        readonly messageID: string
        readonly type: "patch"
        readonly hash: string
        readonly files: ReadonlyArray<string>
      }
    | {
        readonly id: string
        readonly sessionID: string
        readonly messageID: string
        readonly type: "agent"
        readonly name: string
        readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
      }
    | {
        readonly id: string
        readonly sessionID: string
        readonly messageID: string
        readonly type: "retry"
        readonly attempt: number
        readonly error: {
          readonly name: "APIError"
          readonly data: {
            readonly message: string
            readonly statusCode?: number | undefined
            readonly isRetryable: boolean
            readonly responseHeaders?: { readonly [x: string]: string } | undefined
            readonly responseBody?: string | undefined
            readonly metadata?: { readonly [x: string]: string } | undefined
            readonly classification?: "payload-too-large" | undefined
          }
        }
        readonly time: { readonly created: number }
      }
    | {
        readonly id: string
        readonly sessionID: string
        readonly messageID: string
        readonly type: "compaction"
        readonly auto: boolean
      }
}

export type SessionPartUpdateOutput = Part

export type SessionV2EntriesInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionV2EntriesOutput = SessionV2EntryList

export type SessionV2StateInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionV2StateOutput = SessionV2State

export type SessionV2EventsInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionV2EventsOutput = SessionV2EventList

export type SessionInstructionsInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionInstructionsOutput = SessionInstructionList

export type SessionContextBreakdownInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionContextBreakdownOutput = SessionContextBreakdown

export type SessionContextToggleInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly kind: {
    readonly kind: "mcp" | "skill" | "instruction" | "tool"
    readonly key: string
    readonly enabled: boolean
  }["kind"]
  readonly key: {
    readonly kind: "mcp" | "skill" | "instruction" | "tool"
    readonly key: string
    readonly enabled: boolean
  }["key"]
  readonly enabled: {
    readonly kind: "mcp" | "skill" | "instruction" | "tool"
    readonly key: string
    readonly enabled: boolean
  }["enabled"]
}

export type SessionContextToggleOutput = SessionContextBreakdown

export type SessionGoalInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionGoalOutput = SessionGoalOutput2

export type SessionBackgroundInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionBackgroundOutput = SessionBackgroundOutput2

export type SessionBackgroundInspectInput = {
  readonly sessionID: { readonly sessionID: string; readonly delegationID: string }["sessionID"]
  readonly delegationID: { readonly sessionID: string; readonly delegationID: string }["delegationID"]
}

export type SessionBackgroundInspectOutput = SessionBackgroundInspectOutput2

export type SessionBackgroundReadInput = {
  readonly sessionID: { readonly sessionID: string; readonly delegationID: string }["sessionID"]
  readonly delegationID: { readonly sessionID: string; readonly delegationID: string }["delegationID"]
}

export type SessionBackgroundReadOutput = string

export type SessionBackgroundCancelInput = {
  readonly sessionID: { readonly sessionID: string; readonly delegationID: string }["sessionID"]
  readonly delegationID: { readonly sessionID: string; readonly delegationID: string }["delegationID"]
}

export type SessionBackgroundCancelOutput = boolean

export type SessionMonitorInput = {
  readonly sessionID: { readonly sessionID: string; readonly monitorID: string }["sessionID"]
  readonly monitorID: { readonly sessionID: string; readonly monitorID: string }["monitorID"]
}

export type SessionMonitorOutput = SessionMonitorOutput2

export type SessionMonitorLogInput = {
  readonly sessionID: { readonly sessionID: string; readonly monitorID: string }["sessionID"]
  readonly monitorID: { readonly sessionID: string; readonly monitorID: string }["monitorID"]
  readonly lines?: { readonly lines?: number | undefined }["lines"]
}

export type SessionMonitorLogOutput = SessionMonitorLogOutput2

export type SessionMonitorCancelInput = {
  readonly sessionID: { readonly sessionID: string; readonly monitorID: string }["sessionID"]
  readonly monitorID: { readonly sessionID: string; readonly monitorID: string }["monitorID"]
}

export type SessionMonitorCancelOutput = SessionMonitorOutput2

export type SyncEventInput = {
  readonly event: {
    readonly event: {
      readonly id: string
      readonly projectId: string
      readonly workspaceId?: string | undefined
      readonly aggregate: string
      readonly seq: number
      readonly type: string
      readonly data: unknown
      readonly timestamp: number
      readonly origin?: string | undefined
      readonly originSeq?: number | undefined
    }
    readonly projectID: string
  }["event"]
  readonly projectID: {
    readonly event: {
      readonly id: string
      readonly projectId: string
      readonly workspaceId?: string | undefined
      readonly aggregate: string
      readonly seq: number
      readonly type: string
      readonly data: unknown
      readonly timestamp: number
      readonly origin?: string | undefined
      readonly originSeq?: number | undefined
    }
    readonly projectID: string
  }["projectID"]
}

export type SyncEventOutput = void

export type SyncOutboxInput = {
  readonly projectID: { readonly projectID: string; readonly since?: number | undefined }["projectID"]
  readonly since?: { readonly projectID: string; readonly since?: number | undefined }["since"]
}

export type SyncOutboxOutput = SyncOutboxResponse

export type SyncSnapshotInput = {
  readonly aggregateID: { readonly aggregateID: string }["aggregateID"]
  readonly projectID: { readonly projectID: string }["projectID"]
}

export type SyncSnapshotOutput = SyncSnapshotResponse

export type SyncStreamInput = {
  readonly projectID: { readonly projectID: string; readonly token: string }["projectID"]
  readonly token: { readonly projectID: string; readonly token: string }["token"]
}

export type SyncStreamOutput = any

export type SyncStatsInput = { readonly projectID?: { readonly projectID?: string | undefined }["projectID"] }

export type SyncStatsOutput = SyncStatsOutput2

export type SyncConfigInput = {
  readonly url: {
    readonly url: string
    readonly token?: string | undefined
    readonly autostart?: boolean | undefined
  }["url"]
  readonly token?: {
    readonly url: string
    readonly token?: string | undefined
    readonly autostart?: boolean | undefined
  }["token"]
  readonly autostart?: {
    readonly url: string
    readonly token?: string | undefined
    readonly autostart?: boolean | undefined
  }["autostart"]
}

export type SyncConfigOutput = SyncConfigSetResponse

export type SyncConnectOutput = void

export type SyncDisconnectOutput = void

export type SyncDrainOutput = void

export type TuiAppendPromptInput = { readonly payload: unknown }

export type TuiAppendPromptOutput = TuiBooleanResult

export type TuiOpenHelpOutput = TuiBooleanResult

export type TuiOpenSessionsOutput = TuiBooleanResult

export type TuiOpenThemesOutput = TuiBooleanResult

export type TuiOpenModelsOutput = TuiBooleanResult

export type TuiSubmitPromptOutput = TuiBooleanResult

export type TuiClearPromptOutput = TuiBooleanResult

export type TuiExecuteCommandInput = { readonly payload: unknown }

export type TuiExecuteCommandOutput = TuiBooleanResult

export type TuiShowToastInput = { readonly payload: unknown }

export type TuiShowToastOutput = TuiBooleanResult

export type TuiPublishInput = { readonly payload: unknown }

export type TuiPublishOutput = TuiBooleanResult

export type TuiSelectSessionInput = { readonly payload: unknown }

export type TuiSelectSessionOutput = TuiBooleanResult

export type TuiConfigOutput = TuiConfig

export type TuiControlNextOutput = TuiControlRequest

export type TuiControlResponseInput = { readonly payload: unknown }

export type TuiControlResponseOutput = TuiBooleanResult

export type WorkspaceAdaptorsOutput = Array<WorkspaceAdaptorInfo>

export type WorkspaceSyncListOutput = void

export type WorkspaceStatusOutput = Array<WorkspaceConnectionStatus>

export type WorkspaceCreateInput = {
  readonly id: { readonly id: string }["id"]
  readonly branch: {
    readonly branch: string | null
    readonly config:
      | {
          readonly type: "worktree"
          readonly directory: string
          readonly strategy?: "git" | "cow" | undefined
          readonly eventLimit?: number | undefined
        }
      | {
          readonly type: "container"
          readonly directory: string
          readonly runtime: "docker" | "podman"
          readonly image: string
          readonly containerName: string
          readonly port: number
          readonly serverUrl: string
          readonly eventLimit?: number | undefined
        }
      | {
          readonly type: "branch"
          readonly directory: string
          readonly branch?: string | undefined
          readonly eventLimit?: number | undefined
        }
  }["branch"]
  readonly config: {
    readonly branch: string | null
    readonly config:
      | {
          readonly type: "worktree"
          readonly directory: string
          readonly strategy?: "git" | "cow" | undefined
          readonly eventLimit?: number | undefined
        }
      | {
          readonly type: "container"
          readonly directory: string
          readonly runtime: "docker" | "podman"
          readonly image: string
          readonly containerName: string
          readonly port: number
          readonly serverUrl: string
          readonly eventLimit?: number | undefined
        }
      | {
          readonly type: "branch"
          readonly directory: string
          readonly branch?: string | undefined
          readonly eventLimit?: number | undefined
        }
  }["config"]
}

export type WorkspaceCreateOutput = Workspace1

export type WorkspaceListOutput = Array<Workspace1>

export type WorkspaceRemoveInput = { readonly id: { readonly id: string }["id"] }

export type WorkspaceRemoveOutput = OptionalWorkspace

export type WorkspaceRestoreInput = {
  readonly id: { readonly id: string }["id"]
  readonly timeoutMs?: { readonly timeoutMs?: number | undefined }["timeoutMs"]
}

export type WorkspaceRestoreOutput = WorkspaceRestore

export type WorkspaceSessionRestoreInput = {
  readonly id: { readonly id: string; readonly sessionID: string }["id"]
  readonly sessionID: { readonly id: string; readonly sessionID: string }["sessionID"]
  readonly timeoutMs?: { readonly timeoutMs?: number | undefined }["timeoutMs"]
}

export type WorkspaceSessionRestoreOutput = WorkspaceSessionRestore

export type WorkspaceWarpInput = {
  readonly id: {
    readonly id: string | null
    readonly sessionID: string
    readonly copyChanges?: boolean | undefined
    readonly timeoutMs?: number | undefined
  }["id"]
  readonly sessionID: {
    readonly id: string | null
    readonly sessionID: string
    readonly copyChanges?: boolean | undefined
    readonly timeoutMs?: number | undefined
  }["sessionID"]
  readonly copyChanges?: {
    readonly id: string | null
    readonly sessionID: string
    readonly copyChanges?: boolean | undefined
    readonly timeoutMs?: number | undefined
  }["copyChanges"]
  readonly timeoutMs?: {
    readonly id: string | null
    readonly sessionID: string
    readonly copyChanges?: boolean | undefined
    readonly timeoutMs?: number | undefined
  }["timeoutMs"]
}

export type WorkspaceWarpOutput = void

export type AuthSetInput = {
  readonly providerID: { readonly providerID: string }["providerID"]
  readonly payload:
    | {
        readonly type: "oauth"
        readonly refresh: string
        readonly access: string
        readonly expires: number
        readonly accountId?: string | undefined
        readonly enterpriseUrl?: string | undefined
      }
    | { readonly type: "api"; readonly key: string }
    | { readonly type: "wellknown"; readonly key: string; readonly token: string }
}

export type AuthSetOutput = boolean

export type AuthRemoveInput = { readonly providerID: { readonly providerID: string }["providerID"] }

export type AuthRemoveOutput = boolean

export type ConfigManagementReloadOutput = ConfigReloadResponse

export type ConfigManagementMcpAddInput = {
  readonly name: { readonly name: string; readonly config: unknown }["name"]
  readonly config: { readonly name: string; readonly config: unknown }["config"]
}

export type ConfigManagementMcpAddOutput = SuccessFlag

export type ConfigManagementMcpUpdateInput = {
  readonly name: { readonly name: string }["name"]
  readonly payload: { readonly [x: string]: unknown }
}

export type ConfigManagementMcpUpdateOutput = SuccessFlag

export type ConfigManagementMcpRemoveInput = { readonly name: { readonly name: string }["name"] }

export type ConfigManagementMcpRemoveOutput = SuccessFlag

export type ConfigManagementProfileCreateInput = { readonly name: { readonly name: string }["name"] }

export type ConfigManagementProfileCreateOutput = SuccessFlag

export type ConfigManagementProfileActivateInput = { readonly name: { readonly name: string }["name"] }

export type ConfigManagementProfileActivateOutput = SuccessFlag

export type SessionPromptPromptInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["messageID"]
  readonly delivery?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["delivery"]
  readonly model?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["model"]
  readonly agent?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["agent"]
  readonly noReply?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["noReply"]
  readonly tools?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["tools"]
  readonly format?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["format"]
  readonly system?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["system"]
  readonly variant?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["variant"]
  readonly parts: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["parts"]
}

export type SessionPromptPromptOutput = SessionPromptResponse

export type SessionPromptPromptAsyncInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["messageID"]
  readonly delivery?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["delivery"]
  readonly model?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["model"]
  readonly agent?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["agent"]
  readonly noReply?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["noReply"]
  readonly tools?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["tools"]
  readonly format?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["format"]
  readonly system?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["system"]
  readonly variant?: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["variant"]
  readonly parts: {
    readonly messageID?: string | undefined
    readonly delivery?: "steer" | "queue" | undefined
    readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
    readonly agent?: string | undefined
    readonly noReply?: boolean | undefined
    readonly tools?: { readonly [x: string]: boolean } | undefined
    readonly format?:
      | (
          | { readonly type: "text" }
          | {
              readonly type: "json_schema"
              readonly schema: { readonly [x: string]: any }
              readonly retryCount: number
            }
        )
      | undefined
    readonly system?: string | undefined
    readonly variant?: string | undefined
    readonly parts: ReadonlyArray<
      | {
          readonly type: "text"
          readonly text: string
          readonly synthetic?: boolean | undefined
          readonly ignored?: boolean | undefined
          readonly time?: { readonly start: number; readonly end?: number | undefined } | undefined
          readonly metadata?: { readonly [x: string]: any } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "file"
          readonly mime: string
          readonly filename?: string | undefined
          readonly url: string
          readonly source?:
            | (
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "file"
                    readonly path: string
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "symbol"
                    readonly path: string
                    readonly range: {
                      readonly start: { readonly line: number; readonly character: number }
                      readonly end: { readonly line: number; readonly character: number }
                    }
                    readonly name: string
                    readonly kind: number
                  }
                | {
                    readonly text: { readonly value: string; readonly start: number; readonly end: number }
                    readonly type: "resource"
                    readonly clientName: string
                    readonly uri: string
                  }
              )
            | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "agent"
          readonly name: string
          readonly source?: { readonly value: string; readonly start: number; readonly end: number } | undefined
          readonly id?: string | undefined
        }
      | {
          readonly type: "subtask"
          readonly prompt: string
          readonly description: string
          readonly agent: string
          readonly model?: { readonly providerID: string; readonly modelID: string } | undefined
          readonly command?: string | undefined
          readonly background?: boolean | undefined
          readonly id?: string | undefined
        }
    >
  }["parts"]
}

export type SessionPromptPromptAsyncOutput = void

export type ShareShortInput = { readonly shareID: { readonly shareID: string }["shareID"] }

export type ShareShortOutput = any

export type SharePageInput = { readonly shareID: { readonly shareID: string }["shareID"] }

export type SharePageOutput = ShareData

export type ShareApiInput = { readonly shareID: { readonly shareID: string }["shareID"] }

export type ShareApiOutput = ShareData

export type ShareDataInput = { readonly shareID: { readonly shareID: string }["shareID"] }

export type ShareDataOutput = ShareData

export type EventsSubscribeOutput = Event

export type EventsGlobalOutput = GlobalEvent

export type WorkspaceExtraEventsInput = {
  readonly id: { readonly id: string }["id"]
  readonly from?: { readonly from?: number | undefined }["from"]
}

export type WorkspaceExtraEventsOutput = Array<WorkspaceJournalEvent>

export type WorkspaceExtraSessionWarpInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly workspaceID: {
    readonly workspaceID: string | null
    readonly copyChanges?: boolean | undefined
    readonly timeoutMs?: number | undefined
  }["workspaceID"]
  readonly copyChanges?: {
    readonly workspaceID: string | null
    readonly copyChanges?: boolean | undefined
    readonly timeoutMs?: number | undefined
  }["copyChanges"]
  readonly timeoutMs?: {
    readonly workspaceID: string | null
    readonly copyChanges?: boolean | undefined
    readonly timeoutMs?: number | undefined
  }["timeoutMs"]
}

export type WorkspaceExtraSessionWarpOutput = WorkspaceSessionWarpResponse

export type UsersRegisterInput = {
  readonly username: {
    readonly username: string
    readonly email: string
    readonly password: string
    readonly displayName?: string | undefined
  }["username"]
  readonly email: {
    readonly username: string
    readonly email: string
    readonly password: string
    readonly displayName?: string | undefined
  }["email"]
  readonly password: {
    readonly username: string
    readonly email: string
    readonly password: string
    readonly displayName?: string | undefined
  }["password"]
  readonly displayName?: {
    readonly username: string
    readonly email: string
    readonly password: string
    readonly displayName?: string | undefined
  }["displayName"]
}

export type UsersRegisterOutput = UserSession

export type UsersLoginInput = {
  readonly email: { readonly email: string; readonly password: string }["email"]
  readonly password: { readonly email: string; readonly password: string }["password"]
}

export type UsersLoginOutput = UserSession

export type UsersUpdateInput = {
  readonly id: { readonly id: string }["id"]
  readonly displayName?: {
    readonly displayName?: string | undefined
    readonly password?: string | undefined
    readonly role?: "admin" | "user" | undefined
  }["displayName"]
  readonly password?: {
    readonly displayName?: string | undefined
    readonly password?: string | undefined
    readonly role?: "admin" | "user" | undefined
  }["password"]
  readonly role?: {
    readonly displayName?: string | undefined
    readonly password?: string | undefined
    readonly role?: "admin" | "user" | undefined
  }["role"]
}

export type UsersUpdateOutput = PublicUser
