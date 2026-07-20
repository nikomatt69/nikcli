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

export type Config = { [x: string]: any }

export type Provider = {
  id: string
  name: string
  source: "env" | "config" | "custom" | "api"
  env: Array<string>
  key?: string | undefined
  options: { [x: string]: any }
  models: {
    [x: string]: {
      id: string
      providerID?: string | undefined
      name: string
      family?: string | undefined
      cost?: any | undefined
      limit?: any | undefined
      api?: any | undefined
      status?: string | undefined
      options: { [x: string]: any }
      headers: { [x: string]: string }
      release_date: string
      variants?: { [x: string]: any } | undefined
    }
  }
}

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

export type MissionBooleanResult = boolean

export type Project = {
  id: string
  worktree: string
  vcs?: "git" | undefined
  name?: string | undefined
  icon?: { url?: string | undefined; override?: string | undefined; color?: string | undefined } | undefined
  time: { created: number; updated: number; initialized?: number | undefined }
  sandboxes: Array<string>
}

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

export type Pty = {
  id: string
  title: string
  command: string
  args: Array<string>
  cwd: string
  status: "running" | "exited"
  pid: number
}

export type LoopBooleanResult = boolean

export type FileDiff = {
  file: string
  patch: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified" | undefined
  before: string
  after: string
}

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
  worktree: { name: string; branch: string; directory: string; cleanedAt?: number | undefined }
  pullRequest?: { number: number; url: string; title: string } | undefined
  lastCommitSha?: string | undefined
  publishedAt?: number | undefined
  publishError?: string | undefined
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

export type SessionStatus =
  | { type: "idle" }
  | { type: "retry"; attempt: number; message: string; next: number }
  | { type: "busy"; since: number }
  | { type: "busy" }

export type BooleanResult = boolean

export type OutputFormatText = { type: "text" }

export type JSONSchema = { [x: string]: any }

export type ProviderAuthError = { name: "ProviderAuthError"; data: { providerID: string; message: string } }

export type UnknownError = { name: "UnknownError"; data: { message: string } }

export type MessageOutputLengthError = { name: "MessageOutputLengthError"; data: {} }

export type MessageContextOverflowError = {
  name: "MessageContextOverflowError"
  data: { message: string; responseBody?: string | undefined }
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

export type Todo = { content: string; status: string; priority: string; id: string }

export type SessionV2EntryList = Array<any>

export type SessionV2State = any

export type SessionV2EventList = Array<any>

export type SessionInstructionList = Array<{ path: string; name: string }>

export type TuiBooleanResult = boolean

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

export type SyncOutboxResponse = { events: Array<any>; hasMore: boolean }

export type SyncSnapshotResponse = { lastSeq: number; state: any }

export type SyncConfigSetResponse = {
  configured: boolean
  url?: string | undefined
  source?: "env" | "config" | undefined
  started: boolean
  error?: string | undefined
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

export type EventLspClientDiagnostics = {
  type: "lsp.client.diagnostics"
  properties: { serverID: string; path: string }
}

export type EventLspUpdated = { type: "lsp.updated"; properties: {} }

export type EventMessageRemoved = { type: "message.removed"; properties: { sessionID: string; messageID: string } }

export type EventMessagePartRemoved = {
  type: "message.part.removed"
  properties: { sessionID: string; messageID: string; partID: string }
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

export type EventMcpBrowserOpenFailed = {
  type: "mcp.browser.open.failed"
  properties: { mcpName: string; url: string }
}

export type EventCommandExecuted = {
  type: "command.executed"
  properties: { name: string; sessionID: string; arguments: string; messageID: string }
}

export type EventFileWatcherUpdated = {
  type: "file.watcher.updated"
  properties: { file: string; event: "add" | "change" | "unlink" }
}

export type EventInstanceReloadStarted = {
  type: "instance.reload.started"
  properties: { directory: string; files: Array<string> }
}

export type EventInstanceReloaded = {
  type: "instance.reloaded"
  properties: { directory: string; files: Array<string>; durationMs: number }
}

export type EventVcsBranchUpdated = { type: "vcs.branch.updated"; properties: { branch?: string | undefined } }

export type EventSessionIdle = { type: "session.idle"; properties: { sessionID: string } }

export type EventSessionCompacted = { type: "session.compacted"; properties: { sessionID: string } }

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

export type EventIdeInstalled = { type: "ide.installed"; properties: { ide: string } }

export type Pty1 = {
  id: string
  title: string
  command: string
  args: Array<string>
  cwd: string
  status: "running" | "exited"
  pid: number
}

export type EventPtyExited = { type: "pty.exited"; properties: { id: string; exitCode: number } }

export type EventPtyDeleted = { type: "pty.deleted"; properties: { id: string } }

export type EventSessionV2Updated = { type: "session.v2.updated"; properties: { sessionID: string } }

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

export type EventLoopAborted = {
  type: "loop.aborted"
  properties: { loopID: string; runID?: string | undefined; reason: string }
}

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

export type MobileAuthTokenPublic = {
  id: string
  name?: string | undefined
  scope?: string | undefined
  createdAt?: number | undefined
  expiresAt?: number | undefined
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

export type MobileGithubImport = any

export type MobileConfigInfo = any

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

export type MobileProjectInfo = any

export type MobileSessionInfo = any

export type MobileWorktreeInfo = any

export type MobileWorkspaceInfo = any

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

export type MobileLoop = any

export type MobileLoopRuntime = {
  loopID: string
  status: "idle" | "running" | "paused" | "error" | "cancelling"
  runs: number
  lastRunAt?: number | undefined
  lastError?: string | undefined
  sessionID?: string | undefined
}

export type MobileLoopRun = any

export type MobileRoutine = any

export type MobilePtyInfo = any

export type ConfigProviders = { providers: Array<Provider>; default: { [x: string]: string } }

export type ProviderList = { all: Array<Provider>; default: { [x: string]: string }; connected: Array<string> }

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

export type EventProjectUpdated = { type: "project.updated"; properties: Project }

export type ProviderAuthMethods = { [x: string]: Array<ProviderAuthMethod> }

export type QuestionInfo = {
  question: string
  header: string
  options: Array<QuestionOption>
  multiple?: boolean | undefined
  custom?: boolean | undefined
}

export type PtyList = Array<Pty>

export type FileDiffList = Array<FileDiff>

export type EventSessionDiff = { type: "session.diff"; properties: { sessionID: string; diff: Array<FileDiff> } }

export type PermissionRule = { permission: string; pattern: string; action: PermissionAction }

export type SessionStatusMap = { [x: string]: SessionStatus }

export type EventSessionStatus = { type: "session.status"; properties: { sessionID: string; status: SessionStatus } }

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

export type TodoList = Array<Todo>

export type EventTodoUpdated = {
  type: "todo.updated"
  properties: { sessionID: string; todos: Array<Todo>; diff: { added: Array<Todo>; completed: Array<Todo> } }
}

export type Workspace = {
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

export type EventSessionGoal = {
  type: "session.goal"
  properties: { sessionID: string; goal: SessionGoalState | null }
}

export type EventPtyCreated = { type: "pty.created"; properties: { info: Pty1 } }

export type EventPtyUpdated = { type: "pty.updated"; properties: { info: Pty1 } }

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

export type MobileSessionSummary = { info: MobileSessionInfo; status?: any | undefined }

export type MobileSessionDetail = {
  info: MobileSessionInfo
  status?: any | undefined
  messages: Array<any>
  artifacts: Array<any>
  permissions: Array<any>
  questions: Array<any>
}

export type MobileGithubSessionCreateResult = {
  session: MobileSessionInfo
  worktree: MobileWorktreeInfo
  project: MobileProjectInfo
  workspace?: MobileWorkspaceInfo | undefined
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

export type QuestionRequest = {
  id: string
  sessionID: string
  questions: Array<QuestionInfo>
  tool?: { messageID: string; callID: string } | undefined
}

export type PermissionRuleset = Array<PermissionRule>

export type OutputFormat = OutputFormatText | OutputFormatJsonSchema

export type FilePartSource = FileSource | SymbolSource | ResourceSource

export type OptionalWorkspace = Workspace | null

export type QuestionRequest1 = {
  id: string
  sessionID: string
  questions: Array<QuestionInfo1>
  tool?: { messageID: string; callID: string } | undefined
}

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

export type EventQuestionAsked = { type: "question.asked"; properties: QuestionRequest1 }

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

export type EventMessageUpdated = { type: "message.updated"; properties: { info: Message } }

export type ToolState = ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError

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

export type MessageWithParts = { info: Message; parts: Array<Part> }

export type MessageList = Array<{ info: Message; parts: Array<Part> }>

export type SessionPromptResponse = { info: Message; parts: Array<Part> }

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
  | EventLspClientDiagnostics
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
  | EventTuiPromptAppend
  | EventTuiCommandExecute
  | EventTuiToastShow
  | EventTuiSessionSelect
  | EventMcpToolsChanged
  | EventMcpBrowserOpenFailed
  | EventCommandExecuted
  | EventFileWatcherUpdated
  | EventInstanceReloadStarted
  | EventInstanceReloaded
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
  | EventLoopAborted
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

export type AnalyticsGlobalOutput = any

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

export type AnalyticsDailyOutput = any

export type AnalyticsSessionInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type AnalyticsSessionOutput = any

export type AnalyticsSessionsOutput = any

export type AnalyticsLeaderboardOutput = any

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

export type ConfigGetOutput = Config

export type ConfigUpdateInput = { readonly payload: { readonly [x: string]: unknown } }

export type ConfigUpdateOutput = Config

export type ConfigProvidersOutput = ConfigProviders

export type ConnectorsStatusOutput = any

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

export type MissionListOutput = any

export type MissionTemplatesOutput = any

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

export type MissionGenerateOutput = any

export type MissionRecentExecsInput = { readonly limit?: { readonly limit?: number | undefined }["limit"] }

export type MissionRecentExecsOutput = any

export type MissionGetInput = { readonly id: { readonly id: string }["id"] }

export type MissionGetOutput = any

export type MissionUpsertInput = { readonly payload: unknown }

export type MissionUpsertOutput = any

export type MissionUpdateInput = { readonly id: { readonly id: string }["id"]; readonly payload: unknown }

export type MissionUpdateOutput = any

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

export type MissionFeatureMutateOutput = any

export type MissionExecsInput = {
  readonly id: { readonly id: string }["id"]
  readonly limit?: { readonly limit?: number | undefined }["limit"]
}

export type MissionExecsOutput = any

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

export type PtyCreateOutput = Pty

export type PtyGetInput = { readonly ptyID: { readonly ptyID: string }["ptyID"] }

export type PtyGetOutput = Pty

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

export type PtyUpdateOutput = Pty

export type PtyRemoveInput = { readonly ptyID: { readonly ptyID: string }["ptyID"] }

export type PtyRemoveOutput = boolean

export type LoopListOutput = any

export type LoopTemplatesOutput = any

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

export type LoopGenerateOutput = any

export type LoopRecentRunsInput = { readonly limit?: { readonly limit?: number | undefined }["limit"] }

export type LoopRecentRunsOutput = any

export type LoopGetInput = { readonly id: { readonly id: string }["id"] }

export type LoopGetOutput = any

export type LoopUpsertInput = { readonly payload: unknown }

export type LoopUpsertOutput = any

export type LoopUpdateInput = { readonly id: { readonly id: string }["id"]; readonly payload: unknown }

export type LoopUpdateOutput = any

export type LoopRemoveInput = { readonly id: { readonly id: string }["id"] }

export type LoopRemoveOutput = LoopBooleanResult

export type LoopToggleInput = {
  readonly id: { readonly id: string }["id"]
  readonly enabled: { readonly enabled: boolean }["enabled"]
}

export type LoopToggleOutput = any

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

export type LoopRunsOutput = any

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
    readonly agent?: string | undefined
    readonly model?: string | undefined
    readonly arguments: string
    readonly command: string
    readonly variant?: string | undefined
    readonly parts?: ReadonlyArray<unknown> | undefined
  }["messageID"]
  readonly agent?: {
    readonly messageID?: string | undefined
    readonly agent?: string | undefined
    readonly model?: string | undefined
    readonly arguments: string
    readonly command: string
    readonly variant?: string | undefined
    readonly parts?: ReadonlyArray<unknown> | undefined
  }["agent"]
  readonly model?: {
    readonly messageID?: string | undefined
    readonly agent?: string | undefined
    readonly model?: string | undefined
    readonly arguments: string
    readonly command: string
    readonly variant?: string | undefined
    readonly parts?: ReadonlyArray<unknown> | undefined
  }["model"]
  readonly arguments: {
    readonly messageID?: string | undefined
    readonly agent?: string | undefined
    readonly model?: string | undefined
    readonly arguments: string
    readonly command: string
    readonly variant?: string | undefined
    readonly parts?: ReadonlyArray<unknown> | undefined
  }["arguments"]
  readonly command: {
    readonly messageID?: string | undefined
    readonly agent?: string | undefined
    readonly model?: string | undefined
    readonly arguments: string
    readonly command: string
    readonly variant?: string | undefined
    readonly parts?: ReadonlyArray<unknown> | undefined
  }["command"]
  readonly variant?: {
    readonly messageID?: string | undefined
    readonly agent?: string | undefined
    readonly model?: string | undefined
    readonly arguments: string
    readonly command: string
    readonly variant?: string | undefined
    readonly parts?: ReadonlyArray<unknown> | undefined
  }["variant"]
  readonly parts?: {
    readonly messageID?: string | undefined
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

export type SessionV2EntriesInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionV2EntriesOutput = SessionV2EntryList

export type SessionV2StateInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionV2StateOutput = SessionV2State

export type SessionV2EventsInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionV2EventsOutput = SessionV2EventList

export type SessionInstructionsInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionInstructionsOutput = SessionInstructionList

export type SessionContextBreakdownInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionContextBreakdownOutput = any

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

export type SessionContextToggleOutput = any

export type SessionGoalInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionGoalOutput = any

export type SessionBackgroundInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionBackgroundOutput = any

export type SessionBackgroundInspectInput = {
  readonly sessionID: { readonly sessionID: string; readonly delegationID: string }["sessionID"]
  readonly delegationID: { readonly sessionID: string; readonly delegationID: string }["delegationID"]
}

export type SessionBackgroundInspectOutput = any

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

export type SessionMonitorOutput = any

export type SessionMonitorLogInput = {
  readonly sessionID: { readonly sessionID: string; readonly monitorID: string }["sessionID"]
  readonly monitorID: { readonly sessionID: string; readonly monitorID: string }["monitorID"]
  readonly lines?: { readonly lines?: number | undefined }["lines"]
}

export type SessionMonitorLogOutput = any

export type SessionMonitorCancelInput = {
  readonly sessionID: { readonly sessionID: string; readonly monitorID: string }["sessionID"]
  readonly monitorID: { readonly sessionID: string; readonly monitorID: string }["monitorID"]
}

export type SessionMonitorCancelOutput = any

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

export type WorkspaceCreateOutput = Workspace

export type WorkspaceListOutput = Array<Workspace>

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

export type SyncStatsOutput = any

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
  readonly model?: {
    readonly messageID?: string | undefined
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
  readonly model?: {
    readonly messageID?: string | undefined
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

export type SharePageOutput = any

export type ShareApiInput = { readonly shareID: { readonly shareID: string }["shareID"] }

export type ShareApiOutput = any

export type ShareDataInput = { readonly shareID: { readonly shareID: string }["shareID"] }

export type ShareDataOutput = any

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

export type UsersRegisterOutput = any

export type UsersLoginInput = {
  readonly email: { readonly email: string; readonly password: string }["email"]
  readonly password: { readonly email: string; readonly password: string }["password"]
}

export type UsersLoginOutput = any

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

export type UsersUpdateOutput = any

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

export type MobileGithubImportOutput = { import: MobileGithubImport; project: MobileProjectInfo }

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

export type MobileSessionCreateOutput = MobileSessionInfo

export type MobileSessionDetailInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type MobileSessionDetailOutput = MobileSessionDetail

export type MobileSessionDeleteInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type MobileSessionDeleteOutput = MobileSuccess

export type MobileSessionDiffInput = {
  readonly sessionID: { readonly sessionID: string; readonly messageID: string }["sessionID"]
  readonly messageID: { readonly sessionID: string; readonly messageID: string }["messageID"]
}

export type MobileSessionDiffOutput = Array<any>

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

export type MobileSessionCommandOutput = { info: any; parts: Array<any> }

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
    readonly parts: ReadonlyArray<unknown>
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
    readonly parts: ReadonlyArray<unknown>
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
    readonly parts: ReadonlyArray<unknown>
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
    readonly parts: ReadonlyArray<unknown>
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
    readonly parts: ReadonlyArray<unknown>
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
    readonly parts: ReadonlyArray<unknown>
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
    readonly parts: ReadonlyArray<unknown>
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
    readonly parts: ReadonlyArray<unknown>
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
    readonly parts: ReadonlyArray<unknown>
  }["parts"]
}

export type MobileSessionMessageOutput = any

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

export type MobileWorktreeCreateOutput = MobileWorktreeInfo

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

export type MobileLoopListOutput = { loops: Array<MobileLoop>; runtimes: Array<MobileLoopRuntime> }

export type MobileLoopCreateInput = { readonly payload: unknown }

export type MobileLoopCreateOutput = MobileLoop

export type MobileLoopTemplatesOutput = { templates: Array<any> }

export type MobileLoopGenerateInput = {
  readonly description: { readonly description: string; readonly model?: string | undefined }["description"]
  readonly model?: { readonly description: string; readonly model?: string | undefined }["model"]
}

export type MobileLoopGenerateOutput = MobileLoop

export type MobileLoopRunsRecentInput = { readonly limit?: { readonly limit?: number | undefined }["limit"] }

export type MobileLoopRunsRecentOutput = { runs: Array<MobileLoopRun> }

export type MobileLoopGetInput = { readonly id: { readonly id: string }["id"] }

export type MobileLoopGetOutput = { loop: MobileLoop; runtime: MobileLoopRuntime }

export type MobileLoopDeleteInput = { readonly id: { readonly id: string }["id"] }

export type MobileLoopDeleteOutput = MobileSuccess

export type MobileLoopUpdateInput = { readonly id: { readonly id: string }["id"]; readonly payload: unknown }

export type MobileLoopUpdateOutput = MobileLoop

export type MobileLoopRunsInput = {
  readonly id: { readonly id: string }["id"]
  readonly limit?: { readonly limit?: number | undefined }["limit"]
}

export type MobileLoopRunsOutput = { runs: Array<MobileLoopRun> }

export type MobileLoopRunInput = { readonly id: { readonly id: string }["id"] }

export type MobileLoopRunOutput = MobileSuccess

export type MobileLoopAbortInput = { readonly id: { readonly id: string }["id"] }

export type MobileLoopAbortOutput = MobileSuccess

export type MobileLoopToggleInput = {
  readonly id: { readonly id: string }["id"]
  readonly enabled: { readonly enabled: boolean }["enabled"]
}

export type MobileLoopToggleOutput = MobileLoop

export type MobileLoopPauseInput = { readonly id: { readonly id: string }["id"] }

export type MobileLoopPauseOutput = MobileSuccess

export type MobileLoopResumeInput = { readonly id: { readonly id: string }["id"] }

export type MobileLoopResumeOutput = MobileSuccess

export type MobileRoutineListOutput = Array<MobileRoutine>

export type MobileRoutineCreateInput = { readonly payload: unknown }

export type MobileRoutineCreateOutput = MobileRoutine

export type MobileRoutineGetInput = { readonly id: { readonly id: string }["id"] }

export type MobileRoutineGetOutput = MobileRoutine

export type MobileRoutineDeleteInput = { readonly id: { readonly id: string }["id"] }

export type MobileRoutineDeleteOutput = MobileSuccess

export type MobileRoutineUpdateInput = { readonly id: { readonly id: string }["id"]; readonly payload: unknown }

export type MobileRoutineUpdateOutput = MobileRoutine

export type MobileRoutineRunInput = {
  readonly id: { readonly id: string }["id"]
  readonly text?: { readonly text?: string | undefined }["text"]
}

export type MobileRoutineRunOutput = MobileSessionInfo

export type MobileRoutinePauseInput = { readonly id: { readonly id: string }["id"] }

export type MobileRoutinePauseOutput = MobileRoutine

export type MobileRoutineResumeInput = { readonly id: { readonly id: string }["id"] }

export type MobileRoutineResumeOutput = MobileRoutine

export type MobileRoutineTriggerInput = {
  readonly token: { readonly token: string }["token"]
  readonly text?: { readonly text?: string | undefined }["text"]
}

export type MobileRoutineTriggerOutput = MobileSessionInfo

export type MobilePtyListOutput = Array<MobilePtyInfo>

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

export type MobilePtyCreateOutput = MobilePtyInfo

export type MobilePtyGetInput = { readonly ptyID: { readonly ptyID: string }["ptyID"] }

export type MobilePtyGetOutput = MobilePtyInfo

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

export type MobilePtyUpdateOutput = MobilePtyInfo

export type MobilePtyRemoveInput = { readonly ptyID: { readonly ptyID: string }["ptyID"] }

export type MobilePtyRemoveOutput = boolean
