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

export type SessionList = Array<any>

export type SessionInfo = any

export type SessionStatusMap = { [x: string]: any }

export type BooleanResult = boolean

export type MessageWithParts = any

export type AssistantMessage = any

export type TodoList = Array<any>

export type FileDiffList = Array<any>

export type MessageList = Array<any>

export type MessagePart = any

export type SessionV2EntryList = Array<any>

export type SessionV2State = any

export type SessionV2EventList = Array<any>

export type SessionInstructionList = Array<{ path: string; name: string }>

export type SyncStartResponse = { started: boolean; error?: string | undefined }

export type SyncReplayResponse = { accepted: true }

export type SyncEventRecord = {
  id: string
  projectId: string
  workspaceId?: string | undefined
  aggregate: string
  seq: number
  type: string
  data: any
  timestamp: number
  origin?: string | undefined
  originSeq?: number | undefined
}

export type SyncSnapshotResponse = { lastSeq: number; state: any } | null

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

export type ProviderAuthMethods = { [x: string]: Array<ProviderAuthMethod> }

export type QuestionInfo = {
  question: string
  header: string
  options: Array<QuestionOption>
  multiple?: boolean | undefined
  custom?: boolean | undefined
}

export type PtyList = Array<Pty>

export type SyncHistoryResponse = { events: Array<SyncEventRecord>; hasMore: boolean }

export type Workspace = {
  id: string
  name: string
  timeUsed: number
  branch: string | null
  projectID: string
  config: WorkspaceConfig
}

export type QuestionRequest = {
  id: string
  sessionID: string
  questions: Array<QuestionInfo>
  tool?: { messageID: string; callID: string } | undefined
}

export type OptionalWorkspace = Workspace | null

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

export type SessionCreateOutput = SessionInfo

export type SessionStatusOutput = SessionStatusMap

export type SessionGetInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionGetOutput = SessionInfo

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

export type SessionUpdateOutput = SessionInfo

export type SessionForkInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID?: { readonly messageID?: string | undefined }["messageID"]
}

export type SessionForkOutput = SessionInfo

export type SessionAbortInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionAbortOutput = BooleanResult

export type SessionRevertInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID: { readonly messageID: string; readonly partID?: string | undefined }["messageID"]
  readonly partID?: { readonly messageID: string; readonly partID?: string | undefined }["partID"]
}

export type SessionRevertOutput = SessionInfo

export type SessionUnrevertInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionUnrevertOutput = SessionInfo

export type SessionShareInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionShareOutput = SessionInfo

export type SessionUnshareInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionUnshareOutput = SessionInfo

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

export type SessionShellOutput = AssistantMessage

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

export type SessionPartUpdateInput = {
  readonly sessionID: { readonly sessionID: string; readonly messageID: string; readonly partID: string }["sessionID"]
  readonly messageID: { readonly sessionID: string; readonly messageID: string; readonly partID: string }["messageID"]
  readonly partID: { readonly sessionID: string; readonly messageID: string; readonly partID: string }["partID"]
  readonly payload: unknown
}

export type SessionPartUpdateOutput = MessagePart

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

export type SyncStartInput = {
  readonly url: { readonly url: string; readonly token: string; readonly projectID: string }["url"]
  readonly token: { readonly url: string; readonly token: string; readonly projectID: string }["token"]
  readonly projectID: { readonly url: string; readonly token: string; readonly projectID: string }["projectID"]
}

export type SyncStartOutput = SyncStartResponse

export type SyncReplayInput = {
  readonly projectID: {
    readonly projectID: string
    readonly aggregate: string
    readonly data: unknown
    readonly origin?: string | undefined
  }["projectID"]
  readonly aggregate: {
    readonly projectID: string
    readonly aggregate: string
    readonly data: unknown
    readonly origin?: string | undefined
  }["aggregate"]
  readonly data: {
    readonly projectID: string
    readonly aggregate: string
    readonly data: unknown
    readonly origin?: string | undefined
  }["data"]
  readonly origin?: {
    readonly projectID: string
    readonly aggregate: string
    readonly data: unknown
    readonly origin?: string | undefined
  }["origin"]
}

export type SyncReplayOutput = SyncReplayResponse

export type SyncHistoryInput = {
  readonly projectID: {
    readonly projectID: string
    readonly aggregate: string
    readonly since?: number | undefined
    readonly limit?: number | undefined
  }["projectID"]
  readonly aggregate: {
    readonly projectID: string
    readonly aggregate: string
    readonly since?: number | undefined
    readonly limit?: number | undefined
  }["aggregate"]
  readonly since?: {
    readonly projectID: string
    readonly aggregate: string
    readonly since?: number | undefined
    readonly limit?: number | undefined
  }["since"]
  readonly limit?: {
    readonly projectID: string
    readonly aggregate: string
    readonly since?: number | undefined
    readonly limit?: number | undefined
  }["limit"]
}

export type SyncHistoryOutput = SyncHistoryResponse

export type SyncSnapshotInput = {
  readonly projectID: { readonly projectID: string; readonly aggregate: string }["projectID"]
  readonly aggregate: { readonly projectID: string; readonly aggregate: string }["aggregate"]
}

export type SyncSnapshotOutput = SyncSnapshotResponse

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
